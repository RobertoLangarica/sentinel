# Level 3b — Application (CLI, Orchestrator, Reporter)

> **Agent brief:** Self-contained implementation plan for the glue + UX layer.
> Wires the foundation (3a) into the interactive workflow. Owns CLI parsing,
> the step-by-step Orchestrator, knowledge extraction, and the terminal Reporter.
> **Build after 3a** (or stub its modules — see Stubs).

---

## Checklist

- [ ] Modify `package.json` (deps, `bin`, scripts) + add `tsconfig.json`
- [ ] Create `src/reporter.ts` (`Reporter` — ora/chalk/boxen/prompts)
- [ ] Create `src/extract.ts` (repo doc + PR → KBEntry[])
- [ ] Create `src/orchestrator.ts` (`Orchestrator.run` workflow state machine)
- [ ] Create `src/cli.ts` (commander: `review`, `runs`, flags, `--help`)
- [ ] Create `bin/sentinel.js` (shebang entry → imports compiled cli)
- [ ] Create `.gitignore` entry for `.sentinel/`
- [ ] Create `README.md` (setup + usage)
- [ ] All contracts match L2 spec
- [ ] Tests pass; end-to-end smoke run works

---

## Context (decisions that affect this domain)

- **D5** Interactive by default; `--yes` skips prompts; **guidance prompt is default-on**, disabled by `--no-guidance` or `--yes`.
- **D6** `--resume <run-id>` continues from the first non-`done` step (3a `getNextStep`).
- **D7 / OQ-1** On POST, find existing Sentinel comment by marker → edit; else create. Include commit SHA.
- **OQ-2** On re-review, pass prior issues (from parsed comment meta) into `generateReview`.
- **F12** Each workflow step is marked `running`→`done`/`failed`; visible via Reporter.
- CLI UX libs: `ora`, `chalk`, `boxen`, `prompts`. No GitHub write before approval (unless `--yes`).

---

## Contracts This Domain Touches

### Exposes (others depend on this):

```typescript
// === CLI → Orchestrator (src/orchestrator.ts) ===
interface ReviewOptions {
  prNumber?: number;        // required for new review; absent when resuming
  resumeRunId?: string;     // present when --resume <id>
  guidance?: string;        // --guidance "..."
  interactive: boolean;     // false when --yes
  promptGuidance: boolean;  // false when --no-guidance or --yes
  model?: string;           // --model override
}
interface RunResult {
  runId: string;
  state: WorkflowState;     // 'DONE' | 'FAILED'
  commentUrl?: string;
  reviewedSha?: string;
  error?: string;
}

// === Reporter (src/reporter.ts) ===
type ApprovalChoice = 'approve' | 'edit' | 'regenerate' | 'cancel';
interface Reporter {
  header(runId: string, prTitle?: string): void;
  step(label: string): { succeed(msg?: string): void; fail(msg?: string): void };
  panel(title: string, body: string): void;
  previewReview(markdown: string): void;
  promptGuidance(): Promise<string | undefined>;
  promptApproval(): Promise<ApprovalChoice>;
  openInEditor(markdown: string): Promise<string>;
  result(opts: { url?: string; sha?: string; failed?: boolean; message?: string }): void;
}
```

### Consumes (depends on these — copied from 3a / L2; stub if not built yet):

```typescript
// From 3a — full types live in src/types.ts:
//   WorkflowManager (createRun/loadRun/listRuns/markStep/getNextStep/setRunState/recordError, .db)
//   KnowledgeBase   (addEntries/reinforce/all/getQueryTool)
//   GitHubClient    (getPR/getDiff/getChangedFiles/findSentinelComment/createComment/updateComment)
//   AIProvider      (generateReview)
//   AnthropicProvider, AIProviderImpl, WorkflowManagerImpl (static open/create), KnowledgeBaseImpl
//   buildCommentBody/parseCommentBody from src/github/comment.ts
// Stub: see Stubs section — fake impls returning canned data.
```

---

## Files to Create / Modify

| File Path (from project root) | Action | Purpose |
|-------------------------------|--------|---------|
| `package.json` | Modify | deps, `"bin": { "sentinel": "bin/sentinel.js" }`, scripts |
| `tsconfig.json` | Create | strict, `module: NodeNext`, `outDir: dist` |
| `src/reporter.ts` | Create | Terminal UX implementation |
| `src/extract.ts` | Create | Build `KBEntry[]` from repo docs + PR body |
| `src/orchestrator.ts` | Create | Workflow state machine `run(options)` |
| `src/cli.ts` | Create | commander wiring + help text |
| `bin/sentinel.js` | Create | `#!/usr/bin/env node` → `import('../dist/cli.js')` |
| `.gitignore` | Modify | add `.sentinel/`, `dist/`, `node_modules/` |
| `README.md` | Create | setup + usage + flow |

---

## Implementation Detail

### package.json (additions)

```jsonc
{
  "name": "sentinel",
  "version": "0.1.0",
  "type": "module",
  "bin": { "sentinel": "bin/sentinel.js" },
  "scripts": {
    "build": "tsc",
    "test": "node --test",
    "start": "node bin/sentinel.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "better-sqlite3": "^11.0.0",
    "boxen": "^7.1.1",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "ora": "^8.0.1",
    "prompts": "^2.4.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "@types/prompts": "^2.4.0",
    "typescript": "^5.4.0"
  }
}
```

### tsconfig.json

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false
  },
  "include": ["src/**/*"]
}
```

### Reporter (`src/reporter.ts`)

```typescript
import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';
import prompts from 'prompts';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Reporter, ApprovalChoice } from './types.js';

export class ConsoleReporter implements Reporter {
  header(runId: string, prTitle?: string): void {
    console.log(chalk.bold.cyan('\n🛡️  Sentinel PR Review'));
    console.log(chalk.dim('━'.repeat(50)));
    console.log(`${chalk.dim('Run ID:')} ${chalk.bold(runId)}`);
    if (prTitle) console.log(`${chalk.dim('PR:')} ${prTitle}`);
    console.log('');
  }

  step(label: string) {
    const spinner = ora(label).start();
    return {
      succeed: (msg?: string) => spinner.succeed(msg ?? label),
      fail: (msg?: string) => spinner.fail(msg ?? label),
    };
  }

  panel(title: string, body: string): void {
    console.log(boxen(body, { title, padding: 1, borderStyle: 'round', borderColor: 'cyan' }));
  }

  previewReview(markdown: string): void {
    console.log(boxen(markdown, { title: '📝 Review Preview', padding: 1, borderStyle: 'round', borderColor: 'yellow' }));
  }

  async promptGuidance(): Promise<string | undefined> {
    const { text } = await prompts({
      type: 'text', name: 'text',
      message: 'Additional guidance/constraints (Enter to skip):',
    });
    return text?.trim() ? text.trim() : undefined;
  }

  async promptApproval(): Promise<ApprovalChoice> {
    const { choice } = await prompts({
      type: 'select', name: 'choice', message: 'What next?',
      choices: [
        { title: 'Approve and post to GitHub', value: 'approve' },
        { title: 'Edit review in $EDITOR', value: 'edit' },
        { title: 'Regenerate review', value: 'regenerate' },
        { title: 'Cancel', value: 'cancel' },
      ],
    });
    return (choice ?? 'cancel') as ApprovalChoice;
  }

  async openInEditor(markdown: string): Promise<string> {
    const editor = process.env.EDITOR;
    if (!editor) {
      console.log(chalk.yellow('⚠️  $EDITOR not set — keeping review unedited.'));
      return markdown;
    }
    const file = join(tmpdir(), `sentinel-review-${Date.now()}.md`);
    writeFileSync(file, markdown, 'utf8');
    spawnSync(editor, [file], { stdio: 'inherit' });
    const edited = readFileSync(file, 'utf8');
    try { unlinkSync(file); } catch { /* ignore */ }
    return edited;
  }

  result(opts: { url?: string; sha?: string; failed?: boolean; message?: string }): void {
    console.log(chalk.dim('━'.repeat(50)));
    if (opts.failed) {
      console.log(chalk.red(`✗ ${opts.message ?? 'Run failed.'}`));
    } else {
      console.log(chalk.green('✅ Review complete!'));
      if (opts.url) console.log(`   ${chalk.dim('View:')} ${opts.url}`);
      if (opts.sha) console.log(`   ${chalk.dim('Commit:')} ${opts.sha.slice(0, 7)}`);
    }
  }
}
```

### Knowledge extraction (`src/extract.ts`)

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { KBEntry, PullRequest } from './types.js';

const DOC_FILES = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', '.sentinel/rules.md'];

// MVP heuristic extraction: capture explicit constraint-like lines + always
// store full docs as 'rule' context. The AI refines via the KB tool at review time.
export function extractRepoEntries(root = process.cwd()): { entries: KBEntry[]; filesRead: string[] } {
  const entries: KBEntry[] = [];
  const filesRead: string[] = [];

  for (const rel of DOC_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    filesRead.push(rel);

    // Whole-doc context entry (rule).
    entries.push({ category: 'rule', subject: rel, content: truncate(text, 4000), source: rel });

    // Explicit constraint patterns: lines screaming "do not", "never", "must not", "don't touch".
    for (const line of text.split('\n')) {
      if (/\b(do not|don'?t|never|must not|forbidden|do not touch|read[- ]?only)\b/i.test(line)) {
        const clean = line.replace(/^[#>*\-\s]+/, '').trim();
        if (clean.length > 8) entries.push({ category: 'constraint', subject: rel, content: clean, source: rel });
      }
    }
  }
  return { entries, filesRead };
}

// PR goal → 'goal' entry ("reason to be").
export function extractPrGoal(pr: PullRequest): KBEntry {
  const content = `Title: ${pr.title}\n\n${pr.body || '(no description provided)'}`;
  return { category: 'goal', subject: 'pr-intent', content: truncate(content, 3000), source: 'PR' };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
}
```

### Orchestrator (`src/orchestrator.ts`)

```typescript
import { WorkflowManagerImpl } from './db/workflow.js';
import { KnowledgeBaseImpl } from './db/knowledge.js';
import { GitHubClientImpl } from './github/client.js';
import { buildCommentBody, parseCommentBody } from './github/comment.js';
import { AnthropicProvider, DEFAULT_MODEL } from './ai/provider.js';
import { AIProviderImpl } from './ai/agent.js';
import { ConsoleReporter } from './reporter.js';
import { extractRepoEntries, extractPrGoal } from './extract.js';
import { ValidationError } from './types.js';
import type {
  ReviewOptions, RunResult, WorkflowState, GitHubClient, AIProvider, Reporter, ReviewIssue,
} from './types.js';

// Dependencies are injectable for testing.
interface Deps {
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
          prNumber: options.prNumber!, repo: 'pending',
          model: options.model ?? DEFAULT_MODEL, guidance: options.guidance,
        });

    this.reporter.header(run.id);

    try {
      let next = wm.getNextStep(run.id);
      // Cache fetched artefacts between steps within a single process run.
      let prTitle: string | undefined;

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
            prTitle = pr.title;
            // persist repo + head_sha on the run record
            wm.db.prepare(`UPDATE run SET repo = ?, head_sha = ? WHERE id = ?`)
              .run(pr.repo, pr.headSha, run.id);
            s.succeed(`Fetched PR #${pr.number}: ${pr.title}`);
            wm.markStep(run.id, 'FETCH_PR', 'done');
            break;
          }
          case 'EXTRACT': {
            const s = this.reporter.step('Extracting repo knowledge…');
            const pr = await this.github.getPR(run.prNumber);
            const { entries, filesRead } = extractRepoEntries();
            kb.addEntries(run.id, entries);
            kb.addEntry(run.id, extractPrGoal(pr));
            s.succeed(`Knowledge extracted (${entries.length} entries from ${filesRead.length} files)`);
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

            const review = await this.ai.generateReview({
              pr, diff, changedFiles: files,
              tools: [kb.getQueryTool(run.id)],
              model: run.model,
              priorIssues: priorMeta?.issues,
              priorReviewedSha: priorMeta?.reviewedSha,
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
```

### CLI (`src/cli.ts`)

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import { Orchestrator } from './orchestrator.js';
import { WorkflowManagerImpl } from './db/workflow.js';
import type { ReviewOptions } from './types.js';

const program = new Command();

program
  .name('sentinel')
  .description('🛡️  Sentinel — AI-powered PR reviewer')
  .version('0.1.0');

program
  .command('review')
  .argument('[pr-number]', 'PR number to review', (v) => parseInt(v, 10))
  .option('--resume <run-id>', 'Resume an interrupted run')
  .option('--guidance <text>', 'Add specific guidance/constraints')
  .option('--no-guidance', 'Skip the interactive guidance prompt')
  .option('-y, --yes', 'Skip all interactive prompts (automation)')
  .option('--model <name>', 'Override AI model')
  .action(async (prNumber: number | undefined, opts: any) => {
    const options: ReviewOptions = {
      prNumber: Number.isNaN(prNumber as number) ? undefined : prNumber,
      resumeRunId: opts.resume,
      guidance: opts.guidance,
      interactive: !opts.yes,
      promptGuidance: opts.guidance === false ? false : !opts.yes, // --no-guidance sets opts.guidance to false in commander
      model: opts.model,
    };
    const res = await new Orchestrator().run(options);
    process.exit(res.state === 'DONE' ? 0 : 1);
  });

program
  .command('runs')
  .description('List recent review runs')
  .option('--limit <n>', 'Max runs to show', (v) => parseInt(v, 10), 20)
  .action((opts: { limit: number }) => {
    const runs = WorkflowManagerImpl.listRuns(opts.limit);
    if (!runs.length) { console.log(chalk.dim('No runs yet.')); return; }
    console.log(chalk.bold('\nRecent review runs:\n'));
    for (const r of runs) {
      console.log(`  ${chalk.cyan(r.id.padEnd(24))} PR #${String(r.prNumber).padEnd(6)} ${stateColor(r.state)} ${chalk.dim(r.ageLabel)}`);
    }
    console.log(chalk.dim("\nUse 'sentinel review --resume <run-id>' to continue.\n"));
  });

function stateColor(state: string): string {
  if (state === 'DONE') return chalk.green(state.padEnd(10));
  if (state === 'FAILED') return chalk.red(state.padEnd(10));
  return chalk.yellow(state.padEnd(10));
}

program.parseAsync().catch((err) => {
  console.error(chalk.red(`✗ ${err?.message ?? err}`));
  process.exit(2);
});
```

### bin entry (`bin/sentinel.js`)

```javascript
#!/usr/bin/env node
import('../dist/cli.js');
```

### .gitignore additions

```
node_modules/
dist/
.sentinel/
```

### README.md (skeleton)

```markdown
# 🛡️ Sentinel

AI-powered PR reviewer. Learns your repo's rules, reviews a PR, you approve, it posts.

## Setup
- `gh auth login` (Sentinel uses the GitHub CLI)
- `export ANTHROPIC_API_KEY=...`
- `npm install && npm run build && npm link`

## Usage
- `sentinel review 123`            Interactive review
- `sentinel review 123 --yes`      No prompts (automation)
- `sentinel review --resume <id>`  Continue an interrupted run
- `sentinel runs`                  List recent runs
- `sentinel --help`                Full help
```

---

## Testing

| Test | Input | Expected |
|------|-------|----------|
| ReviewOptions mapping | `review 123` | `{prNumber:123, interactive:true, promptGuidance:true}` |
| `--yes` disables prompts | `review 123 --yes` | `interactive:false, promptGuidance:false` |
| `--no-guidance` | `review 123 --no-guidance` | `promptGuidance:false`, still interactive approval |
| Orchestrator happy path | fake github+ai+reporter, no existing comment | calls `createComment`, returns `DONE` |
| Orchestrator re-review | fake github returns marked comment | passes `priorIssues`, calls `updateComment` |
| Orchestrator cancel | reporter.promptApproval → 'cancel' | returns `FAILED`, no post |
| Orchestrator resume | pre-seeded run at GENERATE | continues from GENERATE |
| extract constraints | README with "Do not touch X" | yields a `constraint` entry |
| runs list | seed 2 run DBs | prints both, newest first |

```bash
npm run build && npm test
# Smoke (needs gh auth + ANTHROPIC_API_KEY):
node bin/sentinel.js review <pr> --no-guidance
```

---

## Stubs (for missing dependencies)

| Dependency | Stub Approach |
|-----------|--------------|
| `GitHubClient` | Fake object implementing the 6 methods with canned `PullRequest`/diff/comment |
| `AIProvider` | Fake `generateReview` returning a fixed `GeneratedReview` |
| `Reporter` | Headless reporter: no-op spinners, `promptApproval` returns `'approve'`, `promptGuidance` returns `undefined` |
| 3a not built yet | Implement against the interfaces in `src/types.ts`; swap real impls in last |

---

## Pitfalls

- **commander `--no-guidance`:** with a `--no-X` flag, commander sets `opts.guidance = false`. Handle both the boolean-false (flag) and string (`--guidance "text"`) cases — see CLI mapping.
- **`--yes` implies `promptGuidance:false`** AND `interactive:false` (skips approval). Don't post without approval unless `--yes` is explicitly set.
- **Regenerate loop:** resetting GENERATE+APPROVE to `pending` then `continue` re-enters the state machine cleanly — don't recurse.
- **getPR called multiple times:** acceptable for MVP; could cache in-process if slow.
- **Re-review meta source:** prior issues come from `parseCommentBody(existing.body)`, NOT the local DB (cold start each run).
- **Exit codes:** `DONE`→0, `FAILED`/cancel→1, arg/validation error→2.
- **`.sentinel/` must be gitignored** — verify before first run so run DBs aren't committed.

---

## Dependencies

| Depends on | Blocking? | Stub available? |
|-----------|-----------|-----------------|
| 3a `WorkflowManagerImpl`, `KnowledgeBaseImpl` | Yes | Yes — implement interfaces |
| 3a `GitHubClientImpl` | Yes | Yes — fake GitHubClient |
| 3a `AIProviderImpl` + `AnthropicProvider` | Yes | Yes — fake AIProvider |
| 3a `comment.ts` (build/parse) | Yes | Yes — trivial fakes |
| `commander`, `ora`, `chalk`, `boxen`, `prompts` | Yes | n/a (real) |

| Unblocks |
|----------|
| End-to-end CLI — the shippable MVP |
