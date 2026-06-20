import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderImpl, extractJson, salvagePartial } from './agent.js';
import { ProviderLoopError } from '../types.js';
import type { Provider, ProviderTurn, AgentTool, PullRequest } from '../types.js';


const pr: PullRequest = {
  number: 1, repo: 'a/b', title: 'T', body: 'goal', headSha: 'sha', baseRef: 'main', author: 'me', url: 'u',
};

function input(tools: AgentTool[]) {
  return { pr, diff: 'diff', changedFiles: [], tools };
}

test('extractJson handles fenced and bare JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"b":2} suffix'), { b: 2 });
  assert.equal(extractJson('no json here'), null);
});

test('agent loop calls a tool then returns parsed review', async () => {
  let toolCalled = false;
  const tool: AgentTool = {
    name: 'query_knowledge_base', description: 'd', inputSchema: {},
    handler: () => { toolCalled = true; return 'rules'; },
  };
  const turns: ProviderTurn[] = [
    { toolCalls: [{ id: 't1', name: 'query_knowledge_base', input: {} }] },
    { text: '{"summary":"ok","markdown":"# R","issues":[{"severity":"note","message":"m","status":"open"}]}' },
  ];
  let i = 0;
  const provider: Provider = { name: 'fake', complete: async () => turns[i++] };
  const ai = new AIProviderImpl(provider);
  const review = await ai.generateReview(input([tool]));
  assert.ok(toolCalled);
  assert.equal(review.summary, 'ok');
  assert.equal(review.issues.length, 1);
});

test('agent loop salvages a partial review when it never returns valid JSON', async () => {
  // The model keeps producing prose; at the turn limit we salvage it as a draft.
  const provider: Provider = { name: 'fake', complete: async () => ({ text: 'partial analysis so far' }) };
  const ai = new AIProviderImpl(provider);
  const review = await ai.generateReview(input([]));
  assert.equal(review.partial, true);
  assert.match(review.markdown, /partial analysis so far/);
});

test('agent loop throws ProviderLoopError when there is nothing to salvage', async () => {
  // No text ever produced → nothing to salvage → throw.
  const provider: Provider = { name: 'fake', complete: async () => ({}) };
  const ai = new AIProviderImpl(provider);
  await assert.rejects(() => ai.generateReview(input([])), ProviderLoopError);
});

test('salvagePartial prefers parseable JSON, falls back to raw prose, null on empty', () => {
  const fromJson = salvagePartial('{"summary":"s","markdown":"# body","issues":[]}');
  assert.equal(fromJson?.markdown, '# body');
  assert.equal(fromJson?.summary, 's');
  const fromProse = salvagePartial('just some notes');
  assert.equal(fromProse?.markdown, 'just some notes');
  assert.equal(salvagePartial(''), null);
  assert.equal(salvagePartial(undefined), null);
});

test('edit mode withholds the KB tool when rules are pre-loaded', async () => {
  // preloadedKB present → the agent must NOT receive/charge turns on the tool.
  let sawTool = false;
  const tool: AgentTool = {
    name: 'query_knowledge_base', description: 'd', inputSchema: {},
    handler: () => { sawTool = true; return 'rules'; },
  };
  const provider: Provider = {
    name: 'fake',
    complete: async (_messages, tools) => {
      if (tools.length) sawTool = true; // tool offered at all counts as a failure
      return { text: '{"summary":"ok","markdown":"# edited","issues":[]}' };
    },
  };
  const ai = new AIProviderImpl(provider);
  const review = await ai.generateReview({
    ...input([tool]),
    priorReview: '# old review',
    preloadedKB: '- [constraint] do not flag X',
  });
  assert.equal(sawTool, false);
  assert.equal(review.markdown, '# edited');
});

