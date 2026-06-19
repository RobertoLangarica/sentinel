import { WorkflowManagerImpl } from './db/workflow.js';
import { KnowledgeBaseImpl } from './db/knowledge.js';
import { GitHubClientImpl } from './github/client.js';
import { buildCommentBody, parseCommentBody } from './github/comment.js';
import { AnthropicProvider, DEFAULT_MODEL } from './ai/provider.js';
import { AIProviderImpl } from './ai/agent.js';
import { ConsoleReporter } from './reporter.js';
import { extractRepoEntries, extractPrGoal, getRepoHeadSha } from './extract.js';
import { getConfiguredModel } from './config.js';
import { ValidationError } from './types.js';

import type {
  ReviewOptions, RunResult, GitHubClient, AIProvider, Reporter, ReviewIssue,
} from './types.js';

// Dependencies are injectable for testing.
export interface Deps {
  github?: GitHubClient;
  ai?: AIProvider;
  reporter?: Reporter;
}

export class Orchestrator {
  private github: GitHubClient;
  private ai: AIProvider;
  private reporter: Reporter;

  constructor(deps: Deps = {}) {
    this.github = deps.github ?? new GitHubClientImpl();
    this.reporter = deps.reporter ?? new ConsoleReporter();
    // Lazily construct the AI provider only if not injected (avoids requiring the
    // API key for tests / commands that never generate).
    this.ai = deps.ai ?? new AIProviderImpl(new AnthropicProvider());
  }

  async run(options: ReviewOptions): Promise<RunResult> {
    if (options.prNumber == null && !options.resumeRunId) {
      throw new ValidationError('Provide a PR number or --resume <run-id>.');
    }

    // Open or create the run + DB.
    const wm = options.resumeRunId
      ? WorkflowManagerImpl.open(options.resumeRunId)
      : WorkflowManagerImpl.create();
    const kb = new KnowledgeBaseImpl(wm.db);

    let run = options.resumeRunId
      ? wm.loadRun(options.resumeRunId)
      : wm.createRun({
          prNumber: options.prNumber!, repo: 'pending', guidance: options.guidance,
        });

    this.reporter.header(run.id);

    try {
      // ─── Resume reconciliation ──────────────────────────────────────────
      // On resume, redo any work that's gone stale:
      //   1) KB drift — the repo's docs changed since we extracted → re-extract
      //      and re-review (the rules driving the review may have changed).
      //   2) DONE run — re-check the PR: if it has new commits (or the KB drifted)
      //      re-review and update the comment; if the same commit was already
      //      reviewed and the KB is current, there's nothing to do.
      if (options.resumeRunId) {
        const currentRepoSha = getRepoHeadSha();
        // Missing kbExtractedSha (old runs) is treated as stale so we refresh it.
        const kbStale = currentRepoSha != null && run.kbExtractedSha !== currentRepoSha;

        if (kbStale) {
          this.reporter.panel(
            'KB refresh',
            `Repo changed since the knowledge base was extracted` +
            `${run.kbExtractedSha ? ` (${run.kbExtractedSha.slice(0, 7)} → ${currentRepoSha!.slice(0, 7)})` : ''}.` +
            ` Re-extracting and re-reviewing.`,
          );
          for (const step of ['EXTRACT', 'GENERATE', 'APPROVE', 'POST'] as const) {
            wm.markStep(run.id, step, 'pending');
          }
        }

        if (run.state === 'DONE') {
          const pr = await this.github.getPR(run.prNumber);
          const reviewedRow: any = wm.db.prepare(`SELECT reviewed_sha FROM review WHERE run_id = ?`).get(run.id);
          const reviewedSha: string | undefined = reviewedRow?.reviewed_sha;

          if (!kbStale && reviewedSha && reviewedSha === pr.headSha) {
            this.reporter.panel(
              'Up to date',
              `PR #${pr.number} is unchanged since the last review (commit ${pr.headSha.slice(0, 7)}). Nothing to do.`,
            );
            return { runId: run.id, state: 'DONE', reviewedSha };
          }
          // New commits (or stale KB) → re-review and update the existing comment.
          for (const step of ['GENERATE', 'APPROVE', 'POST'] as const) {
            wm.markStep(run.id, step, 'pending');
          }
        }
      }

      let next = wm.getNextStep(run.id);
      // Optional calibration message supplied when the user chooses "Regenerate".
      // Combined with the run's stored guidance and fed to the next generation.
      let calibration: string | undefined;

      while (next !== 'DONE') {
        wm.setRunState(run.id, next);
        wm.markStep(run.id, next, 'running');

        switch (next) {
          case 'INIT': {
            wm.markStep(run.id, 'INIT', 'done');
            break;
          }
          case 'FETCH_PR': {
            const s = this.reporter.step('Fetching PR…');
            const pr = await this.github.getPR(run.prNumber);
            wm.db.prepare(`UPDATE run SET repo = ?, head_sha = ? WHERE id = ?`)
              .run(pr.repo, pr.headSha, run.id);
            s.succeed(`Fetched PR #${pr.number}: ${pr.title}`);
            wm.markStep(run.id, 'FETCH_PR', 'done');
            break;
          }
          case 'EXTRACT': {
            const s = this.reporter.step('Extracting repo knowledge…');
            const pr = await this.github.getPR(run.prNumber);
            // Idempotent: wipe any prior KB so a re-extract (e.g. on resume after the
            // repo's docs changed) fully replaces it rather than duplicating entries.
            wm.db.prepare(`DELETE FROM kb_entry WHERE run_id = ?`).run(run.id);
            const { entries, filesRead } = extractRepoEntries();
            kb.addEntries(run.id, entries);
            kb.addEntry(run.id, extractPrGoal(pr));
            // Keep stored user-guidance in the KB even after a wipe.
            if (run.guidance) {
              kb.reinforce(run.id, { category: 'constraint', subject: 'user-guidance', content: run.guidance, source: 'user-guidance' });
            }
            // Record the repo commit this KB was extracted from, for drift detection.
            const repoSha = getRepoHeadSha();
            wm.db.prepare(`UPDATE run SET kb_extracted_sha = ? WHERE id = ?`).run(repoSha, run.id);
            s.succeed(`Knowledge extracted (${entries.length} entries from ${filesRead.length} files${repoSha ? ` @ ${repoSha.slice(0, 7)}` : ''})`);
            this.reporter.panel('Learned Rules', summarizeKb(kb.all(run.id)));
            wm.markStep(run.id, 'EXTRACT', 'done');
            break;
          }
          case 'GUIDANCE': {
            let guidance = options.guidance ?? run.guidance;
            if (options.promptGuidance) {
              const extra = await this.reporter.promptGuidance();
              guidance = [guidance, extra].filter(Boolean).join('\n');
            }
            if (guidance) {
              kb.reinforce(run.id, { category: 'constraint', subject: 'user-guidance', content: guidance, source: 'user-guidance' });
              wm.db.prepare(`UPDATE run SET guidance = ? WHERE id = ?`).run(guidance, run.id);
            }
            wm.markStep(run.id, 'GUIDANCE', 'done');
            break;
          }
          case 'GENERATE': {
            const s = this.reporter.step('Generating review…');
            const pr = await this.github.getPR(run.prNumber);
            const diff = await this.github.getDiff(run.prNumber);
            const files = await this.github.getChangedFiles(run.prNumber);

            // Re-review support: recover prior issues from existing comment (OQ-2).
            const existing = await this.github.findSentinelComment(run.prNumber);
            const priorMeta = existing ? parseCommentBody(existing.body) : null;

            // Resolve the model at run time so the current config/flag always wins —
            // never frozen to whatever was persisted when the run was created.
            // Order: --model flag → live config → built-in default.
            // NOTE: we intentionally do NOT fall back to run.model — a resumed run
            // must use the *current* default, not a value baked in when it was created.
            const model = options.model ?? getConfiguredModel() ?? DEFAULT_MODEL;

            // Combine the run's stored guidance with any regenerate calibration message.
            const combinedGuidance = [run.guidance, calibration].filter(Boolean).join('\n') || undefined;

            const review = await this.ai.generateReview({
              pr, diff, changedFiles: files,
              tools: [kb.getQueryTool(run.id)],
              model,
              priorIssues: priorMeta?.issues,
              priorReviewedSha: priorMeta?.reviewedSha,
              guidance: combinedGuidance,
            });

            // Persist review + issues.
            wm.db.prepare(
              `INSERT OR REPLACE INTO review (run_id, markdown, reviewed_sha, summary, generated_at)
               VALUES (?, ?, ?, ?, ?)`
            ).run(run.id, review.markdown, pr.headSha, review.summary, new Date().toISOString());
            wm.db.prepare(`DELETE FROM review_issue WHERE run_id = ?`).run(run.id);
            const issStmt = wm.db.prepare(
              `INSERT INTO review_issue (run_id, severity, category, file, location, message, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            for (const i of review.issues) {
              issStmt.run(run.id, i.severity, i.category ?? null, i.file ?? null, i.location ?? null, i.message, i.status);
            }
            s.succeed('Review generated');
            wm.markStep(run.id, 'GENERATE', 'done');
            break;
          }
          case 'APPROVE': {
            const r: any = wm.db.prepare(`SELECT * FROM review WHERE run_id = ?`).get(run.id);
            let markdown = r.markdown as string;

            if (!options.interactive) {
              wm.markStep(run.id, 'APPROVE', 'done');
              break;
            }
            // Loop on edit/regenerate.
            let decided = false;
            while (!decided) {
              this.reporter.previewReview(markdown);
              const choice = await this.reporter.promptApproval();
              if (choice === 'approve') { decided = true; }
              else if (choice === 'edit') {
                markdown = await this.reporter.openInEditor(markdown);
                wm.db.prepare(`UPDATE review SET markdown = ? WHERE run_id = ?`).run(markdown, run.id);
              } else if (choice === 'regenerate') {
                // Let the user calibrate the next attempt with a short message.
                const msg = await this.reporter.promptRegenerateMessage();
                if (msg) {
                  // Interactive calibration: ask the model what it understood and
                  // which rules it will enforce/ignore, then show it to the user.
                  const pr = await this.github.getPR(run.prNumber);
                  const priorIssues: ReviewIssue[] = (wm.db
                    .prepare(`SELECT * FROM review_issue WHERE run_id = ?`).all(run.id) as any[])
                    .map(x => ({ severity: x.severity, category: x.category ?? undefined,
                      file: x.file ?? undefined, location: x.location ?? undefined,
                      message: x.message, status: x.status }));
                  const cs = this.reporter.step('Calibrating…');
                  let result;
                  try {
                    result = await this.ai.calibrate({
                      pr,
                      message: msg,
                      rules: kb.all(run.id).filter(e =>
                        e.category === 'constraint' || e.category === 'rule' || e.category === 'goal'),
                      priorIssues,
                      model: options.model ?? getConfiguredModel() ?? DEFAULT_MODEL,
                    });
                    cs.succeed('Calibrated');
                  } catch (e: any) {
                    cs.fail('Calibration failed — using your note as plain guidance');
                    result = undefined;
                  }

                  if (result) {
                    this.reporter.showCalibration(result);
                    const ok = await this.reporter.confirmCalibration();
                    if (!ok) {
                      // User rejected the calibration — back to the preview menu.
                      continue;
                    }
                    // Persist the effective rules as durable, high-weight constraints
                    // so they survive re-extraction and outweigh repo-derived rules.
                    for (const r of result.rules) {
                      const content = r.directive === 'ignore'
                        ? `IGNORE / do not flag: ${r.rule}`
                        : `ENFORCE: ${r.rule}`;
                      kb.reinforce(run.id, {
                        category: 'constraint', subject: 'user-guidance',
                        content, source: 'user-guidance', weight: 100,
                      });
                    }
                    // Feed the explicit directives into the next generation as guidance.
                    const directiveText = result.rules
                      .map(r => r.directive === 'ignore' ? `Do NOT flag: ${r.rule}` : `Enforce: ${r.rule}`)
                      .join('\n');
                    calibration = [calibration, msg, directiveText].filter(Boolean).join('\n');
                  } else {
                    calibration = [calibration, msg].filter(Boolean).join('\n');
                  }
                }
                // Reset GENERATE + APPROVE to pending and break out to re-run loop.
                wm.markStep(run.id, 'GENERATE', 'pending');
                wm.markStep(run.id, 'APPROVE', 'pending');
                decided = true;
              } else { // cancel

                this.reporter.result({ failed: true, message: `Cancelled — resume with: sentinel review --resume ${run.id}` });
                return { runId: run.id, state: 'FAILED', error: 'cancelled' };
              }
            }
            if (wm.getNextStep(run.id) === 'GENERATE') { next = 'GENERATE'; continue; } // regenerate path
            wm.markStep(run.id, 'APPROVE', 'done');
            break;
          }
          case 'POST': {
            const s = this.reporter.step('Posting to GitHub…');
            const r: any = wm.db.prepare(`SELECT * FROM review WHERE run_id = ?`).get(run.id);
            const issues: ReviewIssue[] = (wm.db.prepare(`SELECT * FROM review_issue WHERE run_id = ?`).all(run.id) as any[])
              .map(x => ({ severity: x.severity, category: x.category ?? undefined, file: x.file ?? undefined,
                location: x.location ?? undefined, message: x.message, status: x.status }));
            const body = buildCommentBody(r.markdown, r.reviewed_sha, issues);

            const existing = await this.github.findSentinelComment(run.prNumber);
            const posted = existing
              ? await this.github.updateComment(existing.id, body)
              : await this.github.createComment(run.prNumber, body);
            s.succeed(existing ? 'Updated existing Sentinel comment' : 'Posted new Sentinel comment');
            wm.markStep(run.id, 'POST', 'done');
            wm.setRunState(run.id, 'DONE');
            this.reporter.result({ url: posted.url, sha: r.reviewed_sha });
            return { runId: run.id, state: 'DONE', commentUrl: posted.url, reviewedSha: r.reviewed_sha };
          }
        }
        next = wm.getNextStep(run.id);
        run = wm.loadRun(run.id);
      }

      wm.setRunState(run.id, 'DONE');
      return { runId: run.id, state: 'DONE' };
    } catch (err: any) {
      wm.recordError(run.id, err?.message ?? String(err));
      this.reporter.result({ failed: true, message: `${err?.message} — resume: sentinel review --resume ${run.id}` });
      return { runId: run.id, state: 'FAILED', error: err?.message };
    }
  }
}

function summarizeKb(entries: { category: string; content: string }[]): string {
  const lines = entries
    .filter(e => e.category === 'constraint' || e.category === 'goal')
    .slice(0, 12)
    .map((e, i) => `${i + 1}. [${e.category}] ${e.content.split('\n')[0].slice(0, 80)}`);
  return lines.length ? lines.join('\n') : 'No explicit constraints found (AI will use full docs via KB tool).';
}
