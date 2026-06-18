import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { initSchema, STEP_ORDER } from './schema.js';
import { generateRunId } from './ids.js';
import { NotFoundError } from '../types.js';
import type { WorkflowManager, RunRecord, WorkflowState, StepRecord } from '../types.js';

const RUNS_DIR = join(process.cwd(), '.sentinel', 'runs');

function nowIso() { return new Date().toISOString(); }

export class WorkflowManagerImpl implements WorkflowManager {
  db: Database.Database;
  private runId: string;

  private constructor(db: Database.Database, runId: string) {
    this.db = db; this.runId = runId;
  }

  static open(runId: string): WorkflowManagerImpl {
    const path = join(RUNS_DIR, `${runId}.db`);
    if (!existsSync(path)) throw new NotFoundError(`Run ${runId} not found`);
    const db = new Database(path);
    initSchema(db);
    return new WorkflowManagerImpl(db, runId);
  }

  static create(): WorkflowManagerImpl {
    mkdirSync(RUNS_DIR, { recursive: true });
    const runId = generateRunId();
    const db = new Database(join(RUNS_DIR, `${runId}.db`));
    initSchema(db);
    return new WorkflowManagerImpl(db, runId);
  }

  // For tests: in-memory DB with a fixed run id.
  static memory(runId = 'test-run'): WorkflowManagerImpl {
    const db = new Database(':memory:');
    initSchema(db);
    return new WorkflowManagerImpl(db, runId);
  }

  createRun(input: { prNumber: number; repo: string; model?: string; guidance?: string }): RunRecord {
    const ts = nowIso();
    this.db.prepare(
      `INSERT INTO run (id, pr_number, repo, model, guidance, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INIT', ?, ?)`
    ).run(this.runId, input.prNumber, input.repo, input.model ?? null, input.guidance ?? null, ts, ts);

    const stepStmt = this.db.prepare(
      `INSERT INTO workflow_step (run_id, ordinal, name, status, updated_at) VALUES (?, ?, ?, 'pending', ?)`
    );
    STEP_ORDER.forEach((name, i) => stepStmt.run(this.runId, i + 1, name, ts));
    return this.loadRun(this.runId);
  }

  loadRun(runId: string): RunRecord {
    const row: any = this.db.prepare(`SELECT * FROM run WHERE id = ?`).get(runId);
    if (!row) throw new NotFoundError(`Run ${runId} not found`);
    return {
      id: row.id, prNumber: row.pr_number, repo: row.repo, headSha: row.head_sha ?? undefined,
      model: row.model ?? undefined, guidance: row.guidance ?? undefined, state: row.state,
      error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  markStep(runId: string, name: WorkflowState, status: StepRecord['status'], detail?: string): void {
    this.db.prepare(
      `UPDATE workflow_step SET status = ?, detail = ?, updated_at = ? WHERE run_id = ? AND name = ?`
    ).run(status, detail ?? null, nowIso(), runId, name);
  }

  getNextStep(runId: string): WorkflowState {
    const row: any = this.db.prepare(
      `SELECT name FROM workflow_step WHERE run_id = ? AND status != 'done' ORDER BY ordinal LIMIT 1`
    ).get(runId);
    return (row?.name ?? 'DONE') as WorkflowState;
  }

  setRunState(runId: string, state: WorkflowState): void {
    this.db.prepare(`UPDATE run SET state = ?, updated_at = ? WHERE id = ?`).run(state, nowIso(), runId);
  }

  recordError(runId: string, message: string): void {
    this.db.prepare(`UPDATE run SET error = ?, state = 'FAILED', updated_at = ? WHERE id = ?`)
      .run(message, nowIso(), runId);
  }

  // Static: scan all run DBs for `runs` command.
  static listRuns(limit = 20): Array<RunRecord & { ageLabel: string }> {
    if (!existsSync(RUNS_DIR)) return [];
    const files = readdirSync(RUNS_DIR).filter(f => f.endsWith('.db'));
    const rows: Array<RunRecord & { ageLabel: string }> = [];
    for (const f of files) {
      const db = new Database(join(RUNS_DIR, f), { readonly: true });
      try {
        const r: any = db.prepare(`SELECT * FROM run LIMIT 1`).get();
        if (r) rows.push({
          id: r.id, prNumber: r.pr_number, repo: r.repo, headSha: r.head_sha ?? undefined,
          model: r.model ?? undefined, guidance: r.guidance ?? undefined, state: r.state,
          error: r.error ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
          ageLabel: ageLabel(r.updated_at),
        });
      } finally { db.close(); }
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  // Instance method to satisfy interface; delegates to static.
  listRuns(limit = 20) { return WorkflowManagerImpl.listRuns(limit); }

  // Delete a single run's DB file. Returns true if it existed and was removed.
  static deleteRun(runId: string): boolean {
    const path = join(RUNS_DIR, `${runId}.db`);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  // Prune runs. By default removes only finished runs (DONE/FAILED);
  // pass { all: true } to remove every run. Returns the deleted run ids.
  static pruneRuns(opts: { all?: boolean } = {}): string[] {
    const runs = WorkflowManagerImpl.listRuns(Number.MAX_SAFE_INTEGER);
    const targets = opts.all
      ? runs
      : runs.filter(r => r.state === 'DONE' || r.state === 'FAILED');
    const deleted: string[] = [];
    for (const r of targets) {
      if (WorkflowManagerImpl.deleteRun(r.id)) deleted.push(r.id);
    }
    return deleted;
  }
}


function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
