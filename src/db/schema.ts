import type Database from 'better-sqlite3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY, pr_number INTEGER NOT NULL, repo TEXT NOT NULL,
  head_sha TEXT, kb_extracted_sha TEXT, model TEXT, guidance TEXT, state TEXT NOT NULL,
  error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_step (
  run_id TEXT NOT NULL, ordinal INTEGER NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', detail TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, ordinal)
);
CREATE TABLE IF NOT EXISTS kb_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
  category TEXT NOT NULL, subject TEXT, content TEXT NOT NULL,
  source TEXT, weight INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_kb_run_cat ON kb_entry(run_id, category);
CREATE TABLE IF NOT EXISTS review (
  run_id TEXT PRIMARY KEY, markdown TEXT NOT NULL, reviewed_sha TEXT NOT NULL,
  summary TEXT, generated_at TEXT NOT NULL, partial INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS review_issue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
  severity TEXT NOT NULL, category TEXT, file TEXT, location TEXT,
  message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_issue_run ON review_issue(run_id);
`;

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  migrate(db);
}

// Idempotent, additive migrations for run DBs created before a column existed.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check PRAGMA table_info first.
function migrate(db: Database.Database): void {
  const runCols = new Set(
    (db.prepare(`PRAGMA table_info(run)`).all() as any[]).map(c => c.name),
  );
  if (!runCols.has('kb_extracted_sha')) {
    db.exec(`ALTER TABLE run ADD COLUMN kb_extracted_sha TEXT`);
  }
  const reviewCols = new Set(
    (db.prepare(`PRAGMA table_info(review)`).all() as any[]).map(c => c.name),
  );
  if (!reviewCols.has('partial')) {
    db.exec(`ALTER TABLE review ADD COLUMN partial INTEGER NOT NULL DEFAULT 0`);
  }
}


// Ordered workflow steps (used to seed workflow_step on createRun).
export const STEP_ORDER = [
  'INIT', 'FETCH_PR', 'EXTRACT', 'GUIDANCE', 'GENERATE', 'APPROVE', 'POST',
] as const;
