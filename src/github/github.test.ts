import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommentBody, parseCommentBody, hasMarker, MARKER } from './comment.js';
import { GitHubClientImpl, numericCommentId } from './client.js';
import type { ReviewIssue } from '../types.js';


const issues: ReviewIssue[] = [
  { severity: 'blocking', message: 'hardcoded secret', file: 'auth.ts', location: 'auth.ts:42', status: 'open' },
];

test('buildCommentBody embeds marker + sha and round-trips meta', () => {
  const body = buildCommentBody('## Review', 'abc1234def', issues);
  assert.ok(hasMarker(body));
  assert.match(body, /abc1234/);
  const meta = parseCommentBody(body);
  assert.ok(meta);
  assert.equal(meta!.reviewedSha, 'abc1234def');
  assert.equal(meta!.issues.length, 1);
  assert.equal(meta!.issues[0].message, 'hardcoded secret');
});

test('parseCommentBody returns null when no meta present', () => {
  assert.equal(parseCommentBody('just a normal comment'), null);
});

test('getPR parses gh JSON into PullRequest', async () => {
  const fakeRunner = async () => JSON.stringify({
    number: 5, title: 'Add auth', body: 'goal', headRefOid: 'sha123', baseRefName: 'main',
    author: { login: 'me' }, url: 'http://x', headRepository: { name: 'repo' },
    headRepositoryOwner: { login: 'owner' },
  });
  const gh = new GitHubClientImpl(fakeRunner);
  const pr = await gh.getPR(5);
  assert.equal(pr.number, 5);
  assert.equal(pr.repo, 'owner/repo');
  assert.equal(pr.headSha, 'sha123');
});

test('findSentinelComment returns the marked comment', async () => {
  const fakeRunner = async () => JSON.stringify({
    comments: [
      { id: 1, body: 'hi', author: { login: 'a' }, url: 'u1' },
      { id: 2, body: `${MARKER}\nreview`, author: { login: 'b' }, url: 'u2' },
    ],
  });
  const gh = new GitHubClientImpl(fakeRunner);
  const found = await gh.findSentinelComment(5);
  assert.ok(found);
  assert.equal(found!.id, 2);
});

test('findSentinelComment returns null when no marker', async () => {
  const fakeRunner = async () => JSON.stringify({ comments: [{ id: 1, body: 'hi' }] });
  const gh = new GitHubClientImpl(fakeRunner);
  assert.equal(await gh.findSentinelComment(5), null);
});

test('numericCommentId extracts the REST id from a comment URL', () => {
  assert.equal(
    numericCommentId('https://github.com/MirificAI/mirific/pull/83#issuecomment-4747104134', 'IC_kwDOSugZa88AAAABGvMPhg'),
    4747104134,
  );
});

test('numericCommentId falls back to a numeric value when URL has no id', () => {
  assert.equal(numericCommentId('', 42), 42);
});

test('findSentinelComment derives numeric id from the comment URL (not the node id)', async () => {
  // `gh pr view --json comments` gives a GraphQL node id + a URL with the numeric id.
  const fakeRunner = async () => JSON.stringify({
    comments: [
      {
        id: 'IC_kwDOSugZa88AAAABGvMPhg',
        body: `${MARKER}\nreview`,
        author: { login: 'b' },
        url: 'https://github.com/MirificAI/mirific/pull/83#issuecomment-4747104134',
      },
    ],
  });
  const gh = new GitHubClientImpl(fakeRunner);
  const found = await gh.findSentinelComment(83);
  assert.ok(found);
  assert.equal(found!.id, 4747104134);
});

