import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowManagerImpl } from './workflow.js';

const RUNS_DIR = join(process.cwd(), '.sentinel', 'runs');
function cleanup() {
  try { rmSync(join(process.cwd(), '.sentinel'), { recursive: true, force: true }); } catch { /* ignore */ }
}

// Create a real on-disk run in a given terminal state.
function makeRun(state: 'DONE' | 'FAILED' | 'GENERATE'): string {
  const wm = WorkflowManagerImpl.create();
  const run = wm.createRun({ prNumber: 1, repo: 'a/b' });
  wm.setRunState(run.id, state);
  wm.db.close();
  return run.id;
}

test('deleteRun removes the run file and returns true', () => {
  cleanup();
  const id = makeRun('DONE');
  assert.ok(existsSync(join(RUNS_DIR, `${id}.db`)));
  assert.equal(WorkflowManagerImpl.deleteRun(id), true);
  assert.equal(existsSync(join(RUNS_DIR, `${id}.db`)), false);
  assert.equal(WorkflowManagerImpl.deleteRun(id), false); // already gone
  cleanup();
});

test('pruneRuns removes only finished runs by default', () => {
  cleanup();
  const done = makeRun('DONE');
  const failed = makeRun('FAILED');
  const active = makeRun('GENERATE');
  const deleted = WorkflowManagerImpl.pruneRuns();
  assert.ok(deleted.includes(done));
  assert.ok(deleted.includes(failed));
  assert.ok(!deleted.includes(active));
  // active survives
  assert.ok(existsSync(join(RUNS_DIR, `${active}.db`)));
  cleanup();
});

test('pruneRuns --all removes everything', () => {
  cleanup();
  makeRun('DONE');
  makeRun('GENERATE');
  const deleted = WorkflowManagerImpl.pruneRuns({ all: true });
  assert.equal(deleted.length, 2);
  assert.equal(WorkflowManagerImpl.listRuns().length, 0);
  cleanup();
});
