import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitHubAuthError, GitHubExecError, NotFoundError } from '../types.js';
import { hasMarker } from './comment.js';
import type { GitHubClient, PullRequest, ChangedFile, IssueComment } from '../types.js';

const exec = promisify(execFile);

// Injectable runner makes this testable without the real `gh`.
export type Runner = (args: string[]) => Promise<string>;

// Enabled by the `--debug` flag (sets SENTINEL_DEBUG) or the env var directly.
function debugEnabled(): boolean {
  return process.env.SENTINEL_DEBUG === '1' || process.env.SENTINEL_DEBUG === 'true';
}

async function defaultRunner(args: string[]): Promise<string> {
  const debug = debugEnabled();
  if (debug) process.stderr.write(`[debug] gh ${args.join(' ')}\n`);
  try {
    const { stdout } = await exec('gh', args, { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? '');
    if (debug) {
      process.stderr.write(`[debug] gh ${args.join(' ')} failed (exit ${err?.code ?? '?'}):\n`);
      process.stderr.write(stderr.trim() + '\n');
    }
    if (/not logged|authentication|gh auth/i.test(stderr)) {
      throw new GitHubAuthError('GitHub CLI not authenticated. Run `gh auth login`.');
    }
    if (/not found|Could not resolve/i.test(stderr)) {
      // Surface the failing `gh` command so the 404 is actionable.
      throw new NotFoundError(`${stderr.trim()} (while running: gh ${args.join(' ')})`);
    }
    throw new GitHubExecError(stderr.trim() || 'gh command failed');
  }
}

export class GitHubClientImpl implements GitHubClient {
  constructor(private run: Runner = defaultRunner) {}

  async getPR(prNumber: number): Promise<PullRequest> {
    const out = await this.run([
      'pr', 'view', String(prNumber), '--json',
      'number,title,body,headRefOid,baseRefName,author,url,headRepository,headRepositoryOwner',
    ]);
    const j = JSON.parse(out);
    const repo = `${j.headRepositoryOwner?.login ?? ''}/${j.headRepository?.name ?? ''}`;
    return {
      number: j.number, repo, title: j.title, body: j.body ?? '',
      headSha: j.headRefOid, baseRef: j.baseRefName, author: j.author?.login ?? '', url: j.url,
    };
  }

  async getDiff(prNumber: number): Promise<string> {
    return this.run(['pr', 'diff', String(prNumber)]);
  }

  async getChangedFiles(prNumber: number): Promise<ChangedFile[]> {
    const out = await this.run(['pr', 'view', String(prNumber), '--json', 'files']);
    const j = JSON.parse(out);
    return (j.files ?? []).map((f: any) => ({
      path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0, status: f.status ?? 'modified',
    }));
  }

  async findSentinelComment(prNumber: number): Promise<IssueComment | null> {
    const out = await this.run(['pr', 'view', String(prNumber), '--json', 'comments']);
    const j = JSON.parse(out);
    const comments: any[] = j.comments ?? [];
    // Most recent comment carrying our marker wins.
    const match = [...comments].reverse().find(c => hasMarker(c.body ?? ''));
    if (!match) return null;
    // `gh pr view --json comments` returns a GraphQL *node* id (e.g.
    // "IC_kwDO...") in `id`, but the REST endpoint used by updateComment needs
    // the numeric database id. That numeric id lives at the end of the comment
    // URL (".../#issuecomment-4747104134"), so derive it from there.
    const url: string = match.url ?? '';
    const id = numericCommentId(url, match.id);
    return { id, body: match.body, author: match.author?.login ?? '', url };
  }


  async createComment(prNumber: number, body: string): Promise<IssueComment> {
    const out = await this.run(['pr', 'comment', String(prNumber), '--body', body]);
    // `gh pr comment` prints the comment URL; we re-fetch to get the id.
    const url = out.trim();
    const found = await this.findSentinelComment(prNumber);
    return found ?? { id: 0, body, author: '', url };
  }

  async updateComment(commentId: number, body: string): Promise<IssueComment> {
    // gh api edits an issue comment by id (PR comments are issue comments).
    const repoOut = await this.run(['repo', 'view', '--json', 'nameWithOwner']);
    const { nameWithOwner } = JSON.parse(repoOut);
    const out = await this.run([
      'api', '--method', 'PATCH', `/repos/${nameWithOwner}/issues/comments/${commentId}`,
      '-f', `body=${body}`,
    ]);
    const j = JSON.parse(out);
    return { id: j.id, body: j.body, author: j.user?.login ?? '', url: j.html_url };
  }
}

// Extract the numeric REST comment id from a comment URL such as
// "https://github.com/owner/repo/pull/83#issuecomment-4747104134".
// Falls back to the supplied value if no numeric id can be parsed (which
// preserves the previous behaviour rather than silently breaking).
export function numericCommentId(url: string, fallback: unknown): number {
  const m = /#issuecomment-(\d+)/.exec(url ?? '');
  if (m) return Number(m[1]);
  // Some sources already give a numeric id (string or number).
  const n = Number(fallback);
  return Number.isFinite(n) ? n : (fallback as number);
}

