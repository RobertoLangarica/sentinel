import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderImpl, extractJson } from './agent.js';
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

test('agent loop throws ProviderLoopError when no JSON ever returned', async () => {
  const provider: Provider = { name: 'fake', complete: async () => ({ text: 'still thinking' }) };
  const ai = new AIProviderImpl(provider);
  await assert.rejects(() => ai.generateReview(input([])), ProviderLoopError);
});
