import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { generateRunId } from './ids.js';
import { WorkflowManagerImpl } from './workflow.js';
import { KnowledgeBaseImpl } from './knowledge.js';
import { ValidationError } from '../types.js';

test('initSchema creates all 5 tables', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[])
    .map(r => r.name).sort();
  for (const t of ['kb_entry', 'review', 'review_issue', 'run', 'workflow_step']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('generateRunId matches the expected shape', () => {
  assert.match(generateRunId(), /^[0-9a-f]{4}-[a-z]+-[a-z]+$/);
});

test('createRun seeds 7 pending steps and INIT state', () => {
  const wm = WorkflowManagerImpl.memory('r1');
  const run = wm.createRun({ prNumber: 1, repo: 'a/b' });
  assert.equal(run.state, 'INIT');
  const steps = wm.db.prepare(`SELECT * FROM workflow_step WHERE run_id = ?`).all('r1') as any[];
  assert.equal(steps.length, 7);
  assert.ok(steps.every(s => s.status === 'pending'));
});

test('getNextStep advances after marking a step done', () => {
  const wm = WorkflowManagerImpl.memory('r2');
  wm.createRun({ prNumber: 2, repo: 'a/b' });
  assert.equal(wm.getNextStep('r2'), 'INIT');
  wm.markStep('r2', 'INIT', 'done');
  assert.equal(wm.getNextStep('r2'), 'FETCH_PR');
});

test('loadRun returns the persisted record', () => {
  const wm = WorkflowManagerImpl.memory('r3');
  wm.createRun({ prNumber: 7, repo: 'o/n' });
  const r = wm.loadRun('r3');
  assert.equal(r.prNumber, 7);
  assert.equal(r.repo, 'o/n');
  // model is intentionally NOT persisted (resolved live at run time)
  assert.equal(r.model, undefined);
});

test('KB query by category filters correctly', () => {
  const wm = WorkflowManagerImpl.memory('k1');
  wm.createRun({ prNumber: 1, repo: 'a/b' });
  const kb = new KnowledgeBaseImpl(wm.db);
  kb.addEntries('k1', [
    { category: 'constraint', content: 'no secrets' },
    { category: 'constraint', content: 'add tests' },
    { category: 'rule', content: 'use zod' },
  ]);
  assert.equal(kb.query('k1', { category: 'constraint' }).length, 2);
  assert.equal(kb.query('k1', { category: 'rule' }).length, 1);
});

test('KB query by keyword matches subject/content', () => {
  const wm = WorkflowManagerImpl.memory('k2');
  wm.createRun({ prNumber: 1, repo: 'a/b' });
  const kb = new KnowledgeBaseImpl(wm.db);
  kb.addEntries('k2', [
    { category: 'constraint', subject: 'auth', content: 'tokens must rotate' },
    { category: 'rule', content: 'unrelated' },
  ]);
  assert.equal(kb.query('k2', { keyword: 'auth' }).length, 1);
  assert.equal(kb.query('k2', { keyword: 'rotate' }).length, 1);
});

test('KB reinforce increments weight without duplicating', () => {
  const wm = WorkflowManagerImpl.memory('k3');
  wm.createRun({ prNumber: 1, repo: 'a/b' });
  const kb = new KnowledgeBaseImpl(wm.db);
  kb.reinforce('k3', { category: 'constraint', content: 'same' });
  kb.reinforce('k3', { category: 'constraint', content: 'same' });
  const rows = kb.query('k3', { category: 'constraint' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].weight, 2);
});

test('KB query rejects an invalid category', () => {
  const wm = WorkflowManagerImpl.memory('k4');
  wm.createRun({ prNumber: 1, repo: 'a/b' });
  const kb = new KnowledgeBaseImpl(wm.db);
  assert.throws(() => kb.query('k4', { category: 'bogus' as any }), ValidationError);
});

test('KB tool handler returns a formatted list', async () => {
  const wm = WorkflowManagerImpl.memory('k5');
  wm.createRun({ prNumber: 1, repo: 'a/b' });
  const kb = new KnowledgeBaseImpl(wm.db);
  kb.addEntry('k5', { category: 'constraint', subject: 'cfg', content: 'no edits' });
  const tool = kb.getQueryTool('k5');
  const out = await tool.handler({ category: 'constraint' });
  assert.match(out, /\[constraint:cfg\] no edits/);
});
