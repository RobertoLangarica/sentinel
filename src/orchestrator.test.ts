import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Orchestrator } from './orchestrator.js';
import { buildCommentBody } from './github/comment.js';
import type {
  GitHubClient, AIProvider, Reporter, PullRequest, IssueComment, GeneratedReview, ReviewOptions,
} from './types.js';

function cleanup() {
  try { rmSync(join(process.cwd(), '.sentinel'), { recursive: true, force: true }); } catch { /* ignore */ }
}

const pr: PullRequest = {
  number: 1, repo: 'a/b', title: 'T', body: 'goal', headSha: 'def456', baseRef: 'main', author: 'me', url: 'u',
};

const review: GeneratedReview = {
  markdown: '## Review body', summary: 'ok',
  issues: [{ severity: 'warning', message: 'watch out', status: 'open' }],
};

class FakeGitHub implements GitHubClient {
  created: string[] = [];
  updated: Array<{ id: number; body: string }> = [];
  constructor(private existing: IssueComment | null = null) {}
  async getPR() { return pr; }
  async getDiff() { return 'diff'; }
  async getChangedFiles() { return []; }
  async findSentinelComment() { return this.existing; }
  async createComment(_n: number, body: string) { this.created.push(body); return { id: 9, body, author: 's', url: 'newurl' }; }
  async updateComment(id: number, body: string) { this.updated.push({ id, body }); return { id, body, author: 's', url: 'editurl' }; }
}

class FakeAI implements AIProvider {
  lastInput: any;
  async generateReview(input: any) { this.lastInput = input; return review; }
}

class HeadlessReporter implements Reporter {
  // approvals: a queue of choices; the last one repeats. Default: always approve.
  private i = 0;
  constructor(private approvals: Array<'approve' | 'cancel' | 'regenerate'> = ['approve']) {}
  regenMessage: string | undefined = 'be stricter on security';
  header() {}
  step() { return { succeed() {}, fail() {} }; }
  panel() {}
  previewReview() {}
  async promptGuidance() { return undefined; }
  async promptApproval() {
    const c = this.approvals[Math.min(this.i, this.approvals.length - 1)];
    this.i++;
    return c;
  }
  async promptRegenerateMessage() { return this.regenMessage; }
  async openInEditor(md: string) { return md; }
  result() {}
}

const baseOpts: ReviewOptions = { prNumber: 1, interactive: false, promptGuidance: false };

test('happy path creates a new comment and returns DONE', async () => {
  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  const res = await new Orchestrator({ github, ai, reporter: new HeadlessReporter() }).run(baseOpts);
  assert.equal(res.state, 'DONE');
  assert.equal(github.created.length, 1);
  assert.equal(github.updated.length, 0);
  cleanup();
});

test('re-review edits existing comment and passes prior issues', async () => {
  cleanup();
  const priorBody = buildCommentBody('old', 'abc1234', [{ severity: 'blocking', message: 'old issue', status: 'open' }]);
  const existing: IssueComment = { id: 42, body: priorBody, author: 's', url: 'u' };
  const github = new FakeGitHub(existing);
  const ai = new FakeAI();
  const res = await new Orchestrator({ github, ai, reporter: new HeadlessReporter() }).run(baseOpts);
  assert.equal(res.state, 'DONE');
  assert.equal(github.updated.length, 1);
  assert.equal(github.updated[0].id, 42);
  assert.equal(ai.lastInput.priorIssues.length, 1);
  assert.equal(ai.lastInput.priorReviewedSha, 'abc1234');
  cleanup();
});

test('cancel at approval returns FAILED with no post', async () => {
  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  const res = await new Orchestrator({ github, ai, reporter: new HeadlessReporter(['cancel']) })
    .run({ ...baseOpts, interactive: true });
  assert.equal(res.state, 'FAILED');
  assert.equal(github.created.length, 0);
  cleanup();
});

test('regenerate calibration message is passed as guidance on the next generation', async () => {
  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  // First approval = regenerate (with a calibration message), second = approve.
  const reporter = new HeadlessReporter(['regenerate', 'approve']);
  reporter.regenMessage = 'focus on error handling';
  const res = await new Orchestrator({ github, ai, reporter }).run({ ...baseOpts, interactive: true });
  assert.equal(res.state, 'DONE');
  // The second generation should have received the calibration as guidance.
  assert.match(ai.lastInput.guidance ?? '', /focus on error handling/);
  cleanup();
});

test('missing pr and resume id throws validation', async () => {
  cleanup();
  await assert.rejects(
    () => new Orchestrator({ github: new FakeGitHub(), ai: new FakeAI(), reporter: new HeadlessReporter() })
      .run({ interactive: false, promptGuidance: false }),
    /PR number or --resume/,
  );
  cleanup();
});
