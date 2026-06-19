import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Orchestrator } from './orchestrator.js';
import { buildCommentBody } from './github/comment.js';
import type {
  GitHubClient, AIProvider, Reporter, PullRequest, IssueComment, GeneratedReview, ReviewOptions,
  CalibrationInput, CalibrationResult,
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
  headSha = pr.headSha;          // mutable so tests can simulate new commits
  constructor(private existing: IssueComment | null = null) {}
  async getPR() { return { ...pr, headSha: this.headSha }; }
  async getDiff() { return 'diff'; }
  async getChangedFiles() { return []; }
  async findSentinelComment() { return this.existing; }
  async createComment(_n: number, body: string) {
    this.created.push(body);
    // Persist it so subsequent findSentinelComment() returns it (like real GitHub).
    this.existing = { id: 9, body, author: 's', url: 'newurl' };
    return this.existing;
  }
  async updateComment(id: number, body: string) {
    this.updated.push({ id, body });
    this.existing = { id, body, author: 's', url: 'editurl' };
    return this.existing;
  }
}

class FakeAI implements AIProvider {
  lastInput: any;
  lastCalibration: CalibrationInput | undefined;
  calibrationResult: CalibrationResult = {
    acknowledgement: 'Got it — I will stop flagging that.',
    rules: [{ directive: 'ignore', rule: 'the thing you asked to ignore' }],
  };
  async generateReview(input: any) { this.lastInput = input; return review; }
  async calibrate(input: CalibrationInput): Promise<CalibrationResult> {
    this.lastCalibration = input;
    return this.calibrationResult;
  }
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
  lastCalibrationShown: CalibrationResult | undefined;
  confirmCalibrationReturn = true;
  showCalibration(result: CalibrationResult) { this.lastCalibrationShown = result; }
  async confirmCalibration() { return this.confirmCalibrationReturn; }
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

test('regenerate calibrates: shows rules, persists ignore directive, feeds it to next generation', async () => {
  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  ai.calibrationResult = {
    acknowledgement: 'Understood — I will stop flagging the legacy logger import.',
    rules: [{ directive: 'ignore', rule: 'legacy logger import' }],
  };
  const reporter = new HeadlessReporter(['regenerate', 'approve']);
  reporter.regenMessage = 'stop flagging the legacy logger import';
  const res = await new Orchestrator({ github, ai, reporter }).run({ ...baseOpts, interactive: true });
  assert.equal(res.state, 'DONE');
  // The model was asked to calibrate with the user's message.
  assert.equal(ai.lastCalibration?.message, 'stop flagging the legacy logger import');
  // The calibration result was surfaced to the user.
  assert.equal(reporter.lastCalibrationShown?.rules[0].directive, 'ignore');
  // The ignore directive was fed into the regenerated review's guidance.
  assert.match(ai.lastInput.guidance ?? '', /Do NOT flag: legacy logger import/);
  cleanup();
});

test('rejecting the calibration returns to the menu and does not regenerate', async () => {
  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  // regenerate → (reject calibration) → approve.
  const reporter = new HeadlessReporter(['regenerate', 'approve']);
  reporter.confirmCalibrationReturn = false;
  const res = await new Orchestrator({ github, ai, reporter }).run({ ...baseOpts, interactive: true });
  assert.equal(res.state, 'DONE');
  // Only the initial generation ran — no calibration guidance applied.
  assert.equal(ai.lastInput.guidance ?? '', '');
  cleanup();
});

test('resuming a DONE run with no new commits does nothing', async () => {

  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  // First review → DONE, creates a comment.
  const first = await new Orchestrator({ github, ai, reporter: new HeadlessReporter() }).run(baseOpts);
  assert.equal(first.state, 'DONE');
  assert.equal(github.created.length, 1);

  // Resume the same run; PR head unchanged → no re-review, no new post.
  const resumed = await new Orchestrator({ github, ai, reporter: new HeadlessReporter() })
    .run({ resumeRunId: first.runId, interactive: false, promptGuidance: false });
  assert.equal(resumed.state, 'DONE');
  assert.equal(github.created.length, 1);   // unchanged
  assert.equal(github.updated.length, 0);   // nothing posted
  cleanup();
});

test('resuming a DONE run after new commits re-reviews and updates the comment', async () => {
  cleanup();
  const github = new FakeGitHub(null);
  const ai = new FakeAI();
  const first = await new Orchestrator({ github, ai, reporter: new HeadlessReporter() }).run(baseOpts);
  assert.equal(first.state, 'DONE');

  // Simulate a new commit pushed to the PR.
  github.headSha = 'newsha789';
  const resumed = await new Orchestrator({ github, ai, reporter: new HeadlessReporter() })
    .run({ resumeRunId: first.runId, interactive: false, promptGuidance: false });
  assert.equal(resumed.state, 'DONE');
  assert.equal(resumed.reviewedSha, 'newsha789');   // reviewed the new commit
  assert.equal(github.updated.length, 1);           // existing comment updated
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
