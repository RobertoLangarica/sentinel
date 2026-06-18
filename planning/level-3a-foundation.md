# Level 3a — Foundation (Persistence, GitHub, AI)

> **Agent brief:** Self-contained implementation plan for the leaf modules that sit
> behind contracts: WorkflowManager + KnowledgeBase (SQLite), GitHubClient (`gh`),
> and AIProvider (Anthropic + provider interface). The app layer (3b) consumes these.

---

## Checklist

- [ ] Create `src/types.ts` (shared contract types + error classes)
- [ ] Create `src/db/schema.ts` (DDL constant + `initSchema(db)`)
- [ ] Create `src/db/workflow.ts` (`WorkflowManager` + run-id generation)
- [ ] Create `src/db/knowledge.ts` (`KnowledgeBase` + KB query tool)
- [ ] Create `src/github/client.ts` (`GitHubClient` over `gh`)
- [ ] Create `src/github/comment.ts` (marker constant + body build/parse/merge)
- [ ] Create `src/ai/provider.ts` (`Provider` interface + `AnthropicProvider`)
- [ ] Create `src/ai/agent.ts` (`AIProvider.generateReview` agentic loop)
- [ ] All contracts match L2 spec
- [ ] Tests pass

---

## Context (decisions that affect this domain)

- **D1** TypeScript on Node; **D4** SQLite via `better-sqlite3` (synchronous).
- **D3** Anthropic default, behind a `Provider` interface (swappable later — S1).
- **D2** GitHub access via `gh` CLI child process (no Octokit, no PAT).
- **OQ-1** Sentinel comment identified by hidden marker `<!-- sentinel-review:v1 -->`.
- **OQ-2** On re-review, AI classifies prior issues resolved/unresolved/new.
- **OQ-3** Review generation is an **agentic tool-use loop** (model calls KB tool on demand).
- **OQ-4** KB entries are categorized rows; query by category and/or keyword (SQL LIKE).
- One SQLite DB **per run** at `.sentinel/runs/<run-id>.db`; run-id = `<short-id>-<alias>`.

---

## Contracts This Domain Touches

### Exposes (others depend on this):

```typescript
// === WorkflowManager (src/db/workflow.ts) ===
type WorkflowState =
  | 'INIT' | 'FETCH_PR' | 'EXTRACT' | 'GUIDANCE'
  | 'GENERATE' | 'APPROVE' | 'POST' | 'DONE' | 'FAILED';

interface RunRecord {
  id: string;
  prNumber: number;
  repo: string;            // "owner/name"
  headSha?: string;
  model?: string;
  guidance?: string;
  state: WorkflowState;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface StepRecord {
  ordinal: number;
  name: WorkflowState;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

interface WorkflowManager {
  createRun(input: { prNumber: number; repo: string; model?: string; guidance?: string }): RunRecord;
  loadRun(runId: string): RunRecord;                 // throws NotFoundError if missing
  listRuns(limit?: number): Array<RunRecord & { ageLabel: string }>;
  markStep(runId: string, name: WorkflowState, status: StepRecord['status'], detail?: string): void;
  getNextStep(runId: string): WorkflowState;         // first non-'done' step
  setRunState(runId: string, state: WorkflowState): void;
  recordError(runId: string, message: string): void;
  db: import('better-sqlite3').Database;             // shared handle for KB/review tables
}

// === KnowledgeBase (src/db/knowledge.ts) ===
type KBCategory = 'constraint' | 'pattern' | 'rule' | 'goal';

interface KBEntry {
  id?: number;
  category: KBCategory;
  subject?: string;
  content: string;
  source?: string;
  weight?: number;          // default 1; increment to strengthen (F5)
}

interface KBQuery {
  category?: KBCategory;
  keyword?: string;         // matched against subject + content via LIKE
  limit?: number;           // default 20
}

interface KnowledgeBase {
  addEntry(runId: string, entry: KBEntry): void;
  addEntries(runId: string, entries: KBEntry[]): void;
  reinforce(runId: string, entry: KBEntry): void;     // strengthen or insert
  query(runId: string, q: KBQuery): KBEntry[];
  all(runId: string): KBEntry[];
  getQueryTool(runId: string): AgentTool;             // tool given to the agent
}

// === GitHubClient (src/github/client.ts) ===
interface PullRequest {
  number: number; repo: string; title: string; body: string;
  headSha: string; baseRef: string; author: string; url: string;
}
interface ChangedFile { path: string; additions: number; deletions: number; status: string; }
interface IssueComment { id: number; body: string; author: string; url: string; }

interface GitHubClient {
  getPR(prNumber: number): Promise<PullRequest>;
  getDiff(prNumber: number): Promise<string>;
  getChangedFiles(prNumber: number): Promise<ChangedFile[]>;
  findSentinelComment(prNumber: number): Promise<IssueComment | null>;
  createComment(prNumber: number, body: string): Promise<IssueComment>;
  updateComment(commentId: number, body: string): Promise<IssueComment>;
}

// === AIProvider (src/ai/agent.ts) ===
interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;   // JSON schema
  handler: (input: any) => Promise<string> | string;
}
interface ReviewIssue {
  severity: 'blocking' | 'warning' | 'suggestion' | 'note';
  category?: string; file?: string; location?: string;
  message: string; status: 'open' | 'resolved';
}
interface GenerateReviewInput {
  pr: PullRequest; diff: string; changedFiles: ChangedFile[];
  tools: AgentTool[]; model?: string;
  priorIssues?: ReviewIssue[]; priorReviewedSha?: string;
}
interface GeneratedReview { markdown: string; summary: string; issues: ReviewIssue[]; }
interface Provider {
  name: string;
  complete(messages: any[], tools: AgentTool[], model?: string): Promise<ProviderTurn>;
}
interface ProviderTurn { toolCalls?: Array<{ id: string; name: string; input: any }>; text?: string; }
interface AIProvider { generateReview(input: GenerateReviewInput): Promise<GeneratedReview>; }
```

### Consumes (depends on these — stub if not built yet):

```typescript
// AIProvider consumes AgentTool[] (includes the KB query tool from KnowledgeBase).
// Stub: a no-op tool returning "" is fine for AI unit tests.
// GitHubClient consumes the `gh` binary. Stub: inject an `exec` function in tests.
```

---

## Files to Create / Modify

| File Path (from project root) | Action | Purpose |
|-------------------------------|--------|---------|
| `src/types.ts` | Create | All shared interfaces (above) + error classes |
| `src/db/schema.ts` | Create | SQL DDL string + `initSchema(db)` |
| `src/db/ids.ts` | Create | `generateRunId()` → `<short-id>-<alias>` |
| `src/db/workflow.ts` | Create | `WorkflowManagerImpl` (run + steps, resume, list) |
| `src/db/knowledge.ts` | Create | `KnowledgeBaseImpl` + `getQueryTool` |
| `src/github/client.ts` | Create | `GitHubClientImpl` over `gh` via child_process |
| `src/github/comment.ts` | Create | `MARKER`, `buildCommentBody`, `parseCommentBody` |
| `src/ai/provider.ts` | Create | `Provider` iface + `AnthropicProvider` |
| `src/ai/agent.ts` | Create | `AIProviderImpl.generateReview` (tool-use loop) |
| `package.json` | Modify | deps + `bin` + scripts (shared with 3b) |
| `tsconfig.json` | Create | strict TS config |

---

## Implementation Detail

### Error classes (`src/types.ts`, appended after interfaces)

```typescript
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class DBError extends Error {}
export class GitHubAuthError extends Error {}
export class GitHubExecError extends Error {}
export class ProviderAuthError extends Error {}
export class ProviderError extends Error {}
export class ProviderLoopError extends Error {}
```

### Schema (`src/db/schema.ts`)

```typescript
import type Database from 'better-sqlite3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY, pr_number INTEGER NOT NULL, repo TEXT NOT NULL,
  head_sha TEXT, model TEXT, guidance TEXT, state TEXT NOT NULL,
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
  summary TEXT, generated_at TEXT NOT NULL
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
}

// Ordered workflow steps (used to seed workflow_step on createRun).
export const STEP_ORDER = [
  'INIT', 'FETCH_PR', 'EXTRACT', 'GUIDANCE', 'GENERATE', 'APPROVE', 'POST',
] as const;
```

### Run-id generation (`src/db/ids.ts`)

```typescript
import { randomBytes } from 'node:crypto';

// Short hex id + human alias. No external deps.
const ADJ = ['brave', 'calm', 'swift', 'sharp', 'keen', 'bold', 'wise', 'lucid'];
const NOUN = ['hawk', 'review', 'check', 'scan', 'audit', 'lint', 'guard', 'probe'];

export function generateRunId(): string {
  const short = randomBytes(2).toString('hex');           // e.g. "a3f2"
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${short}-${a}-${n}`;                            // "a3f2-keen-check"
}
```

### WorkflowManager (`src/db/workflow.ts`)

```typescript
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
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
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

### KnowledgeBase (`src/db/knowledge.ts`)

```typescript
import type Database from 'better-sqlite3';
import type { KnowledgeBase, KBEntry, KBQuery, KBCategory, AgentTool } from '../types.js';
import { ValidationError } from '../types.js';

const CATEGORIES: KBCategory[] = ['constraint', 'pattern', 'rule', 'goal'];

export class KnowledgeBaseImpl implements KnowledgeBase {
  constructor(private db: Database.Database) {}

  addEntry(runId: string, e: KBEntry): void {
    this.db.prepare(
      `INSERT INTO kb_entry (run_id, category, subject, content, source, weight)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(runId, e.category, e.subject ?? null, e.content, e.source ?? null, e.weight ?? 1);
  }

  addEntries(runId: string, entries: KBEntry[]): void {
    const tx = this.db.transaction((rows: KBEntry[]) => rows.forEach(r => this.addEntry(runId, r)));
    tx(entries);
  }

  // Strengthen an existing matching entry (same category+content) or insert.
  reinforce(runId: string, e: KBEntry): void {
    const existing: any = this.db.prepare(
      `SELECT id, weight FROM kb_entry WHERE run_id = ? AND category = ? AND content = ?`
    ).get(runId, e.category, e.content);
    if (existing) {
      this.db.prepare(`UPDATE kb_entry SET weight = weight + 1 WHERE id = ?`).run(existing.id);
    } else {
      this.addEntry(runId, { ...e, source: e.source ?? 'user-guidance' });
    }
  }

  query(runId: string, q: KBQuery): KBEntry[] {
    if (q.category && !CATEGORIES.includes(q.category)) throw new ValidationError(`Bad category ${q.category}`);
    const clauses = ['run_id = ?']; const params: any[] = [runId];
    if (q.category) { clauses.push('category = ?'); params.push(q.category); }
    if (q.keyword) {
      clauses.push('(subject LIKE ? OR content LIKE ?)');
      params.push(`%${q.keyword}%`, `%${q.keyword}%`);
    }
    const rows: any[] = this.db.prepare(
      `SELECT * FROM kb_entry WHERE ${clauses.join(' AND ')} ORDER BY weight DESC LIMIT ?`
    ).all(...params, q.limit ?? 20);
    return rows.map(toEntry);
  }

  all(runId: string): KBEntry[] {
    return (this.db.prepare(`SELECT * FROM kb_entry WHERE run_id = ? ORDER BY category, weight DESC`)
      .all(runId) as any[]).map(toEntry);
  }

  getQueryTool(runId: string): AgentTool {
    return {
      name: 'query_knowledge_base',
      description:
        'Query the learned repository knowledge (rules, constraints, patterns, goals). ' +
        'Use this to check repo-specific constraints before commenting on the diff.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES, description: 'Optional category filter' },
          keyword: { type: 'string', description: 'Optional keyword to match subject/content' },
        },
      },
      handler: (input: { category?: KBCategory; keyword?: string }) => {
        const results = this.query(runId, { category: input?.category, keyword: input?.keyword });
        if (results.length === 0) return 'No matching knowledge entries.';
        return results.map(r => `- [${r.category}${r.subject ? `:${r.subject}` : ''}] ${r.content}`).join('\n');
      },
    };
  }
}

function toEntry(r: any): KBEntry {
  return { id: r.id, category: r.category, subject: r.subject ?? undefined,
    content: r.content, source: r.source ?? undefined, weight: r.weight };
}
```

### GitHub comment helpers (`src/github/comment.ts`)

```typescript
import type { ReviewIssue } from '../types.js';

export const MARKER = '<!-- sentinel-review:v1 -->';

// Machine-readable block embedded in the comment so re-reviews can recover
// prior issues + the last reviewed SHA (OQ-1 + OQ-2). Hidden inside HTML comment.
interface CommentMeta { reviewedSha: string; issues: ReviewIssue[]; }

export function buildCommentBody(markdown: string, reviewedSha: string, issues: ReviewIssue[]): string {
  const meta: CommentMeta = { reviewedSha, issues };
  const metaBlock = `<!-- sentinel-meta:${Buffer.from(JSON.stringify(meta)).toString('base64')} -->`;
  return `${MARKER}\n${markdown}\n\n---\n*Reviewed by Sentinel · commit \`${reviewedSha.slice(0, 7)}\`*\n${metaBlock}`;
}

export function parseCommentBody(body: string): CommentMeta | null {
  const m = body.match(/<!-- sentinel-meta:([A-Za-z0-9+/=]+) -->/);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); }
  catch { return null; }
}

export function hasMarker(body: string): boolean {
  return body.includes(MARKER);
}
```

### GitHubClient (`src/github/client.ts`)

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitHubAuthError, GitHubExecError, NotFoundError } from '../types.js';
import { hasMarker } from './comment.js';
import type { GitHubClient, PullRequest, ChangedFile, IssueComment } from '../types.js';

const exec = promisify(execFile);

// Injectable runner makes this testable without the real `gh`.
type Runner = (args: string[]) => Promise<string>;

async function defaultRunner(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('gh', args, { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? '');
    if (/not logged|authentication|gh auth/i.test(stderr)) {
      throw new GitHubAuthError('GitHub CLI not authenticated. Run `gh auth login`.');
    }
    if (/not found|Could not resolve/i.test(stderr)) throw new NotFoundError(stderr.trim());
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
    return { id: match.id, body: match.body, author: match.author?.login ?? '', url: match.url ?? '' };
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
```

### Provider interface + Anthropic (`src/ai/provider.ts`)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { ProviderAuthError, ProviderError } from '../types.js';
import type { Provider, ProviderTurn, AgentTool } from '../types.js';

export const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new ProviderAuthError('Set ANTHROPIC_API_KEY to use the Anthropic provider.');
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: any[], tools: AgentTool[], model = DEFAULT_MODEL): Promise<ProviderTurn> {
    try {
      const resp = await this.client.messages.create({
        model, max_tokens: 4096, messages,
        tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as any })),
      });
      const toolCalls = resp.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      return { toolCalls: toolCalls.length ? toolCalls : undefined, text: text || undefined };
    } catch (err: any) {
      throw new ProviderError(err?.message ?? 'Anthropic request failed');
    }
  }
}
```

### AIProvider agentic loop (`src/ai/agent.ts`)

```typescript
import { ProviderLoopError } from '../types.js';
import type { AIProvider, Provider, GenerateReviewInput, GeneratedReview, ReviewIssue } from '../types.js';

const MAX_TURNS = 8;

const SYSTEM = `You are Sentinel, a concise senior code reviewer.
Use the query_knowledge_base tool to check repo-specific rules/constraints before judging the diff.
Be terse and high-signal. Output ONLY a JSON object when done (no prose), matching:
{ "summary": string, "markdown": string, "issues": [ { "severity": "blocking"|"warning"|"suggestion"|"note",
  "category"?: string, "file"?: string, "location"?: string, "message": string, "status": "open"|"resolved" } ] }
"markdown" is the human-facing review body. On re-review, set status:"resolved" for prior issues that the new diff fixes.`;

export class AIProviderImpl implements AIProvider {
  constructor(private provider: Provider) {}

  async generateReview(input: GenerateReviewInput): Promise<GeneratedReview> {
    const userParts = [
      `PR #${input.pr.number}: ${input.pr.title}`,
      `Goal (from description):\n${input.pr.body || '(none)'}`,
      input.priorIssues?.length
        ? `Prior issues (reviewed at ${input.priorReviewedSha?.slice(0, 7)}); classify each resolved/open:\n${JSON.stringify(input.priorIssues, null, 2)}`
        : '',
      `Changed files: ${input.changedFiles.map(f => f.path).join(', ')}`,
      `Unified diff:\n${input.diff}`,
    ].filter(Boolean).join('\n\n');

    const messages: any[] = [
      { role: 'user', content: `${SYSTEM}\n\n${userParts}` },
    ];

    const toolByName = new Map(input.tools.map(t => [t.name, t]));

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await this.provider.complete(messages, input.tools, input.model);

      if (res.toolCalls?.length) {
        // Echo assistant tool_use turn, then provide tool results.
        messages.push({ role: 'assistant', content: res.toolCalls.map(tc => ({
          type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })) });
        const results = [];
        for (const tc of res.toolCalls) {
          const tool = toolByName.get(tc.name);
          const out = tool ? await tool.handler(tc.input) : `Unknown tool ${tc.name}`;
          results.push({ type: 'tool_result', tool_use_id: tc.id, content: String(out) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      // No tool calls → expect final JSON.
      const parsed = extractJson(res.text ?? '');
      if (parsed) {
        return {
          markdown: parsed.markdown ?? '(no review body)',
          summary: parsed.summary ?? '',
          issues: (parsed.issues ?? []) as ReviewIssue[],
        };
      }
      // If not valid JSON, nudge once more by asking for JSON.
      messages.push({ role: 'user', content: 'Respond ONLY with the JSON object described.' });
    }
    throw new ProviderLoopError(`Agent exceeded ${MAX_TURNS} turns without producing a review.`);
  }
}

function extractJson(text: string): any | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}
```

---

## Testing

| Test | Input | Expected |
|------|-------|----------|
| schema init | fresh db | all 5 tables exist (`sqlite_master`) |
| createRun seeds steps | new run | 7 `workflow_step` rows, all `pending` |
| getNextStep | mark INIT done | returns `FETCH_PR` |
| resume load | open existing run id | returns persisted `RunRecord` |
| KB query by category | add 3 entries, query `constraint` | only constraints returned |
| KB query keyword | entries w/ "auth" | matches subject/content LIKE |
| KB reinforce | reinforce same content twice | weight increments, no dup row |
| comment build/parse | issues + sha | `parseCommentBody` round-trips meta |
| findSentinelComment | comments w/ marker | returns the marked one |
| github runner | injected fake runner | parses `gh` JSON correctly |
| agent loop tool-use | fake Provider emitting one tool call then JSON | calls KB handler, returns GeneratedReview |
| agent loop runaway | Provider that never returns JSON | throws `ProviderLoopError` |

```bash
npm run build && npm test
```

Use Node's built-in test runner (`node:test`) + an in-memory SQLite (`new Database(':memory:')`) — no extra test deps.

---

## Stubs (for missing dependencies)

| Dependency | Stub Approach |
|-----------|--------------|
| `gh` binary | Inject a fake `Runner` returning canned JSON strings into `GitHubClientImpl` |
| Anthropic API | Implement a `FakeProvider` with scripted `complete()` turns (tool call → JSON) |
| KB tool (in AI tests) | Pass a simple `AgentTool` whose handler returns a fixed string |

---

## Pitfalls

- **ESM imports:** project is ESM (`"type":"module"`) → use `.js` extensions in relative imports.
- **better-sqlite3 is synchronous** — don't `await` its calls; wrap multi-row writes in `db.transaction`.
- **`gh pr comment` doesn't return JSON** — re-fetch via `findSentinelComment` to get the id (handled above).
- **Anthropic tool loop:** must echo the assistant `tool_use` block before sending `tool_result`, or the API errors.
- **Marker vs meta:** `MARKER` is for detection; `sentinel-meta` base64 block carries prior issues — keep both.
- **maxBuffer:** large diffs can exceed default child_process buffer; we set 20MB.
- **Re-review SHA:** the *prior* reviewed SHA comes from `parseCommentBody`, not the DB (cold start).

---

## Dependencies

| Depends on | Blocking? | Stub available? |
|-----------|-----------|-----------------|
| `better-sqlite3` | Yes | n/a (real, embedded) |
| `@anthropic-ai/sdk` | For AnthropicProvider only | Yes — `FakeProvider` |
| `gh` CLI | Runtime only | Yes — injected `Runner` |

| Unblocks |
|----------|
| `src/orchestrator.ts` (3b) — consumes WorkflowManager, KnowledgeBase, GitHubClient, AIProvider |
| `src/cli.ts` (3b) |
