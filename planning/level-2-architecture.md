# Level 2 — Architecture & Contracts

> Living document. Iterate until architecture is locked.

---

## Checklist

- [x] System architecture diagram
- [x] All components defined with boundaries and ownership
- [x] Data model complete
- [x] Interface contracts specified with full types
- [x] Key data flows documented step by step
- [x] UI component architecture defined (CLI reporter)
- [x] Error handling strategy defined
- [x] Coverage: every L1 feature maps to components
- [x] All open questions resolved
- [x] **Architect confirms: Level 2 complete**

---

## System Architecture

```
                          ┌─────────────────────────────────────┐
                          │            CLI (commander)           │
                          │  review <pr> · --resume · runs · -h  │
                          └──────────────────┬──────────────────┘
                                             │ parsed args (ReviewOptions)
                                             ▼
                          ┌─────────────────────────────────────┐
                          │          Orchestrator                │
                          │  drives workflow, runs agentic loop, │
                          │  enforces step order, owns run loop   │
                          └───┬─────────┬─────────┬─────────┬────┘
                              │         │         │         │
            ┌─────────────────┘         │         │         └──────────────────┐
            ▼                           ▼         ▼                            ▼
  ┌──────────────────┐      ┌──────────────────┐ ┌──────────────────┐  ┌──────────────────┐
  │  WorkflowManager │      │  KnowledgeBase   │ │   AIProvider     │  │   GitHubClient   │
  │  run lifecycle,  │      │  store/query     │ │  Anthropic now;  │  │  wraps `gh` via  │
  │  states, resume  │◀────▶│  rules; KB tool  │ │  swappable iface;│  │  child_process   │
  │                  │      │  for agent       │ │  tool-use loop   │  │                  │
  └────────┬─────────┘      └────────┬─────────┘ └──────────────────┘  └────────┬─────────┘
           │ read/write              │ read/write                               │ shell exec
           ▼                         ▼                                          ▼
  ┌─────────────────────────────────────────────┐                   ┌──────────────────┐
  │      SQLite DB (better-sqlite3)              │                   │     `gh` CLI     │
  │   .sentinel/runs/<run-id>.db                 │                   │  (GitHub API)    │
  │   tables: run, workflow_step, kb_entry,      │                   └──────────────────┘
  │           review, review_issue               │
  └─────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │  Cross-cutting:  Reporter (ora, chalk, boxen, prompts)  ←  used by CLI + Orchestrator │
  └─────────────────────────────────────────────────────────────────────────────────────┘

Arrows:
  CLI → Orchestrator            : parsed ReviewOptions
  Orchestrator → WorkflowManager: advance/read step state, create run
  Orchestrator → GitHubClient   : fetch PR, list/post/edit comments
  Orchestrator → KnowledgeBase  : store extracted entries; expose query tool
  Orchestrator → AIProvider     : run agentic generation w/ KB tool
  AIProvider  → KnowledgeBase   : (via tool callback) query KB entries
  WorkflowManager/KB → SQLite   : persistence (better-sqlite3, synchronous)
  GitHubClient → gh CLI         : child_process exec, JSON out
  All → Reporter                : progress, panels, prompts
```

---

## Components

### CLI

| Property | Value |
|----------|-------|
| Responsibility | Parse args/commands, validate inputs, dispatch to Orchestrator or `runs` lister, render `--help` |
| Source of truth for | Command-line interface surface, flags |
| Depends on | Orchestrator, WorkflowManager (for `runs`), Reporter |
| Depended on by | — (entry point, `bin`) |
| Exposes | `review <pr>`, `review --resume <id>`, `runs`, `--help`, `--version`; flags `--yes`, `--guidance`, `--no-guidance`, `--model` |

### Orchestrator

| Property | Value |
|----------|-------|
| Responsibility | Execute the review workflow step-by-step; enforce ordering; run the agentic AI loop; coordinate all components |
| Source of truth for | The run's in-flight control flow (which step is executing) |
| Depends on | WorkflowManager, GitHubClient, KnowledgeBase, AIProvider, Reporter |
| Depended on by | CLI |
| Exposes | `run(options: ReviewOptions): Promise<RunResult>` |

### WorkflowManager

| Property | Value |
|----------|-------|
| Responsibility | Create runs, open/own the SQLite DB, persist & advance workflow step states, support resume, list runs |
| Source of truth for | Run metadata and workflow step states |
| Depends on | SQLite (better-sqlite3) |
| Depended on by | Orchestrator, CLI (`runs`) |
| Exposes | `createRun`, `loadRun`, `listRuns`, `markStep`, `getNextStep`, `recordError` |

### KnowledgeBase

| Property | Value |
|----------|-------|
| Responsibility | Store categorized KB entries (rules/patterns/constraints/goals); provide keyword/category query; expose the agent-facing query tool |
| Source of truth for | The learned knowledge for the run |
| Depends on | SQLite (better-sqlite3), WorkflowManager (shares DB handle) |
| Depended on by | Orchestrator, AIProvider (via tool callback) |
| Exposes | `addEntry`, `addEntries`, `query`, `all`, `getQueryTool()` (tool definition + handler) |

### AIProvider

| Property | Value |
|----------|-------|
| Responsibility | Abstract the LLM; run an agentic tool-use loop to produce the review; classify prior issues on re-review |
| Source of truth for | Prompt construction, model invocation |
| Depends on | A concrete provider (Anthropic SDK), KB query tool (injected) |
| Depended on by | Orchestrator |
| Exposes | `generateReview(input): Promise<GeneratedReview>` ; `Provider` interface for swapping backends |

### GitHubClient

| Property | Value |
|----------|-------|
| Responsibility | All GitHub interaction via `gh` CLI: fetch PR metadata/diff/files, list comments, create/update the Sentinel comment |
| Source of truth for | GitHub state access (read + the Sentinel comment write) |
| Depends on | `gh` CLI (child_process) |
| Depended on by | Orchestrator |
| Exposes | `getPR`, `getDiff`, `getChangedFiles`, `findSentinelComment`, `createComment`, `updateComment` |

### Reporter (CLI UI)

| Property | Value |
|----------|-------|
| Responsibility | All terminal output: spinners, step checkmarks, boxed panels, review preview, interactive prompts |
| Source of truth for | Terminal presentation |
| Depends on | ora, chalk, boxen, prompts |
| Depended on by | CLI, Orchestrator |
| Exposes | `header`, `step`, `succeed/fail`, `panel`, `previewReview`, `promptGuidance`, `promptApproval`, `openInEditor`, `result` |

---

## UI Architecture (CLI Reporter)

> This is a CLI tool — "UI" = the terminal experience owned by the Reporter.

### Output Tree (per run)

```
Run output
├── header()                  banner + run id + PR title
├── step(...) × N             spinner → ✓/✗ per workflow step
│   └── sub-items             (e.g., files read during extraction)
├── panel("Learned Rules")    boxed KB summary
├── promptGuidance()          free-text prompt (unless --yes/--no-guidance)
├── previewReview(md)         rendered markdown review
├── promptApproval()          [a]pprove / [e]dit / [r]egenerate / [c]ancel
│   └── openInEditor()        on [e]
└── result()                  posted/updated link + commit SHA
```

### State Management

| State Domain | Owned By | Persistence | Notes |
|--------------|----------|-------------|-------|
| Run + step state | WorkflowManager | SQLite | Enables resume |
| KB entries | KnowledgeBase | SQLite | Per-run, queried via tool |
| Generated review + issues | Orchestrator → SQLite (via review tables) | SQLite | Survives resume; reused on approval |
| Spinner/active step | Reporter | In-memory | Transient terminal state |

### Design Tokens

| Category | Approach |
|----------|----------|
| Color | chalk — green ✓, red ✗, cyan headings, dim sub-items |
| Symbols | ✓ done, ✗ failed, ⠋ spinner (ora), 🛡️ brand |
| Panels | boxen rounded borders for KB summary & review preview |
| Prompts | prompts — text + select |

---

## Data Model

```sql
-- One SQLite DB per run at .sentinel/runs/<run-id>.db
-- run-id format: <short-id>-<alias>  e.g. "a3f2-security-check"

CREATE TABLE run (
  id            TEXT PRIMARY KEY,          -- "<short-id>-<alias>"
  pr_number     INTEGER NOT NULL,          -- PR being reviewed
  repo          TEXT NOT NULL,             -- "owner/name" (from gh)
  head_sha      TEXT,                      -- PR HEAD commit at review time
  model         TEXT,                      -- AI model used
  guidance      TEXT,                      -- extra user guidance (nullable)
  state         TEXT NOT NULL,             -- current workflow state (see enum below)
  error         TEXT,                      -- last error message (nullable)
  created_at    TEXT NOT NULL,             -- ISO timestamp
  updated_at    TEXT NOT NULL              -- ISO timestamp
);

-- Ordered workflow steps for visibility + resume.
-- status: 'pending' | 'running' | 'done' | 'failed'
CREATE TABLE workflow_step (
  run_id     TEXT NOT NULL REFERENCES run(id),
  ordinal    INTEGER NOT NULL,             -- step order 1..N
  name       TEXT NOT NULL,                -- 'INIT' | 'FETCH_PR' | 'EXTRACT' | ...
  status     TEXT NOT NULL DEFAULT 'pending',
  detail     TEXT,                         -- optional note/error
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, ordinal)
);

-- Categorized knowledge entries; queried by category and/or keyword (LIKE).
CREATE TABLE kb_entry (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT NOT NULL REFERENCES run(id),
  category  TEXT NOT NULL,                 -- 'constraint'|'pattern'|'rule'|'goal'
  subject   TEXT,                          -- short topic/tag, e.g. "auth", "config/secrets.yaml"
  content   TEXT NOT NULL,                 -- the actual rule/constraint text
  source    TEXT,                          -- 'README'|'AGENTS'|'PR'|'user-guidance'|...
  weight    INTEGER NOT NULL DEFAULT 1     -- strengthened when user reinforces (F5)
);
CREATE INDEX idx_kb_run_cat ON kb_entry(run_id, category);

-- The generated review (one current review per run; regenerate overwrites).
CREATE TABLE review (
  run_id        TEXT PRIMARY KEY REFERENCES run(id),
  markdown      TEXT NOT NULL,             -- the final rendered review body (sans marker)
  reviewed_sha  TEXT NOT NULL,             -- commit SHA this review pertains to
  summary       TEXT,                      -- one-line summary
  generated_at  TEXT NOT NULL
);

-- Individual issues, so re-reviews can classify resolved/unresolved/new (OQ-2).
CREATE TABLE review_issue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT NOT NULL REFERENCES run(id),
  severity  TEXT NOT NULL,                 -- 'blocking'|'warning'|'suggestion'|'note'
  category  TEXT,                          -- e.g. 'security'|'pattern'|'style'
  file      TEXT,                          -- path the issue refers to (nullable)
  location  TEXT,                          -- e.g. "auth.ts:42" (nullable)
  message   TEXT NOT NULL,                 -- issue description
  status    TEXT NOT NULL DEFAULT 'open'   -- 'open'|'resolved' (resolved set on re-review)
);
CREATE INDEX idx_issue_run ON review_issue(run_id);
```

**Workflow states (`run.state` / `workflow_step.name`):**
`INIT → FETCH_PR → EXTRACT → GUIDANCE → GENERATE → APPROVE → POST → DONE` (or `FAILED`).

---

## Interface Contracts

> These contracts are the coordination layer. They get copied into Level 3 files verbatim.

### Contract: CLI → Orchestrator

```typescript
// Direction: CLI → Orchestrator
// Protocol: function call

interface ReviewOptions {
  prNumber?: number;        // required for new review; absent when resuming
  resumeRunId?: string;     // present when --resume <id>
  guidance?: string;        // --guidance "..."
  interactive: boolean;     // false when --yes or --no-guidance disables prompts
  promptGuidance: boolean;  // false when --no-guidance or --yes
  model?: string;           // --model override; default applied in AIProvider
}

interface RunResult {
  runId: string;
  state: WorkflowState;     // terminal state: 'DONE' | 'FAILED'
  commentUrl?: string;      // present when posted/updated
  reviewedSha?: string;
  error?: string;
}

// Error cases:
// - prNumber and resumeRunId both missing → throw ValidationError
// - resume target not found → throw NotFoundError
```

### Contract: Orchestrator → WorkflowManager

```typescript
// Direction: Orchestrator → WorkflowManager
// Protocol: function call (synchronous, better-sqlite3)

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

// Error cases:
// - DB file missing on resume → NotFoundError
// - write failure → DBError (bubbles up, run marked FAILED)
```

### Contract: Orchestrator → GitHubClient

```typescript
// Direction: Orchestrator → GitHubClient
// Protocol: function call → child_process exec of `gh`

interface PullRequest {
  number: number;
  repo: string;            // "owner/name"
  title: string;
  body: string;            // PR description (used to derive "reason to be")
  headSha: string;         // current HEAD commit
  baseRef: string;
  author: string;
  url: string;
}

interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;          // 'added'|'modified'|'removed'|...
}

interface IssueComment {
  id: number;              // GitHub comment id
  body: string;
  author: string;
  url: string;
}

interface GitHubClient {
  getPR(prNumber: number): Promise<PullRequest>;
  getDiff(prNumber: number): Promise<string>;                 // unified diff text
  getChangedFiles(prNumber: number): Promise<ChangedFile[]>;
  // Finds the Sentinel comment via hidden marker (OQ-1: '<!-- sentinel-review:v1 -->')
  findSentinelComment(prNumber: number): Promise<IssueComment | null>;
  createComment(prNumber: number, body: string): Promise<IssueComment>;
  updateComment(commentId: number, body: string): Promise<IssueComment>;
}

// Error cases:
// - `gh` not installed / not authed → GitHubAuthError (actionable message)
// - PR not found → NotFoundError
// - non-zero exit → GitHubExecError(stderr)
```

### Contract: Orchestrator → KnowledgeBase (+ agent tool)

```typescript
// Direction: Orchestrator → KnowledgeBase; AIProvider → KB (via tool callback)
// Protocol: function call (sync) + tool definition consumed by AIProvider

type KBCategory = 'constraint' | 'pattern' | 'rule' | 'goal';

interface KBEntry {
  id?: number;
  category: KBCategory;
  subject?: string;        // tag/topic e.g. "auth"
  content: string;
  source?: string;         // 'README'|'AGENTS'|'PR'|'user-guidance'
  weight?: number;         // default 1; increment to strengthen (F5)
}

interface KBQuery {
  category?: KBCategory;
  keyword?: string;        // matched against subject + content via LIKE
  limit?: number;          // default 20
}

interface KnowledgeBase {
  addEntry(runId: string, entry: KBEntry): void;
  addEntries(runId: string, entries: KBEntry[]): void;
  // Strengthen existing or insert (used when user guidance reinforces a rule)
  reinforce(runId: string, entry: KBEntry): void;
  query(runId: string, q: KBQuery): KBEntry[];
  all(runId: string): KBEntry[];
  // Tool exposed to the agent (OQ-3/OQ-4):
  getQueryTool(runId: string): AgentTool;
}

// AgentTool is the provider-agnostic tool shape (see AIProvider contract).
// KB query tool schema:
//   name: "query_knowledge_base"
//   description: "Query learned repo rules/constraints/patterns/goals."
//   input: { category?: KBCategory; keyword?: string }
//   output (string): formatted list of matching entries

// Error cases:
// - unknown category in query → ValidationError
```

### Contract: Orchestrator → AIProvider

```typescript
// Direction: Orchestrator → AIProvider
// Protocol: function call (async); internally runs agentic tool-use loop

// Provider-agnostic tool shape (works for Anthropic now, others later)
interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;          // JSON schema
  handler: (input: any) => Promise<string> | string;
}

interface GenerateReviewInput {
  pr: PullRequest;
  diff: string;
  changedFiles: ChangedFile[];
  tools: AgentTool[];               // includes KB query tool
  model?: string;
  // Re-review support (OQ-2): prior issues to classify against the new diff
  priorIssues?: ReviewIssue[];
  priorReviewedSha?: string;
}

interface ReviewIssue {
  severity: 'blocking' | 'warning' | 'suggestion' | 'note';
  category?: string;
  file?: string;
  location?: string;        // "auth.ts:42"
  message: string;
  status: 'open' | 'resolved';
}

interface GeneratedReview {
  markdown: string;         // body WITHOUT the hidden marker (added at post time)
  summary: string;          // one-line summary
  issues: ReviewIssue[];    // structured issues (current); resolved ones flagged
}

interface Provider {        // the swappable backend
  name: string;
  complete(messages: any[], tools: AgentTool[], model?: string): Promise<ProviderTurn>;
}

interface ProviderTurn {
  toolCalls?: Array<{ id: string; name: string; input: any }>;
  text?: string;            // final assistant text when no tool calls
}

interface AIProvider {
  generateReview(input: GenerateReviewInput): Promise<GeneratedReview>;
}

// Error cases:
// - missing API key → ProviderAuthError
// - model error / rate limit → ProviderError (run marked FAILED, resumable)
// - tool loop exceeds max turns → ProviderLoopError
```

### Contract: Orchestrator/CLI → Reporter

```typescript
// Direction: any → Reporter
// Protocol: function call

type ApprovalChoice = 'approve' | 'edit' | 'regenerate' | 'cancel';

interface Reporter {
  header(runId: string, prTitle?: string): void;
  step(label: string): { succeed(msg?: string): void; fail(msg?: string): void };
  panel(title: string, body: string): void;
  previewReview(markdown: string): void;
  promptGuidance(): Promise<string | undefined>;     // skipped when non-interactive
  promptApproval(): Promise<ApprovalChoice>;
  openInEditor(markdown: string): Promise<string>;    // returns edited markdown
  result(opts: { url?: string; sha?: string; failed?: boolean; message?: string }): void;
}

// Error cases:
// - $EDITOR unset for openInEditor → fall back to keeping current markdown + warn
```

---

## Key Data Flows

### Flow 1 — First review (`sentinel review 123`)

```
1. CLI parses args → ReviewOptions{ prNumber:123, interactive:true, promptGuidance:true }
2. Orchestrator → WorkflowManager.createRun → new run-id + .sentinel/runs/<id>.db, state INIT
3. Reporter.header(runId, ...)
4. Step FETCH_PR: GitHubClient.getPR/getDiff/getChangedFiles → store head_sha on run
5. Step EXTRACT: read README/AGENTS/CONTRIBUTING/.sentinel/rules.md + PR body
     → derive entries (rules/patterns/constraints/goal) → KB.addEntries
     → Reporter.panel("Learned Rules", summary)
6. Step GUIDANCE: Reporter.promptGuidance() (default on) → KB.reinforce(user-guidance)
7. Step GENERATE: AIProvider.generateReview({pr,diff,files,tools:[KB tool]})
     → agentic loop: model may call query_knowledge_base repeatedly
     → returns GeneratedReview → persist review + review_issue rows
8. Step APPROVE: Reporter.previewReview → promptApproval
     → [e] openInEditor → update markdown; [r] back to step 7; [c] → state FAILED/cancel
9. Step POST: GitHubClient.findSentinelComment(123)
     → none found → createComment(body + marker + sha)
10. state DONE → Reporter.result({url, sha})
```

### Flow 2 — Re-review after new commits (idempotent edit, OQ-1 + OQ-2)

```
1. CLI review 123 again → new run-id (cold start)
2. FETCH_PR → new head_sha (e.g. def456)
3. POST-detection happens earlier here: GitHubClient.findSentinelComment(123) → FOUND
     → parse prior reviewed_sha + prior issues from comment marker block
4. EXTRACT + GUIDANCE as before
5. GENERATE: pass priorIssues + priorReviewedSha into generateReview
     → AI classifies each prior issue resolved/unresolved + finds new issues
6. APPROVE (preview shows ✅ resolved + current)
7. POST: GitHubClient.updateComment(existingId, mergedBody + new sha)
     → resolved items struck-through; nothing deleted
8. DONE → result(updated url, new sha)
```

### Flow 3 — Resume (`sentinel review --resume a3f2-...`)

```
1. CLI → ReviewOptions{ resumeRunId }
2. WorkflowManager.loadRun → existing DB + state; getNextStep → first non-'done' step
3. Orchestrator continues from that step, reusing persisted KB/review rows
4. Proceeds to DONE (or fails again → still resumable)
```

### Flow 4 — List runs (`sentinel runs`)

```
1. CLI → WorkflowManager.listRuns(limit)
2. Reads all .sentinel/runs/*.db (or an index) → rows {id, pr, state, age}
3. Reporter prints table; hints `--resume <id>`
```

---

## Error Handling Strategy

| Category | Approach | User Experience (CLI) |
|----------|----------|------------------------|
| Validation (bad args) | Throw `ValidationError` before any run | Red message + usage hint; exit 2 |
| `gh` missing/unauth | `GitHubAuthError` at FETCH_PR | "Run `gh auth login` — Sentinel uses gh for GitHub access" |
| PR not found | `NotFoundError` | "PR #N not found in <repo>" |
| Provider auth (no API key) | `ProviderAuthError` at GENERATE | "Set ANTHROPIC_API_KEY" |
| Provider/rate error | `ProviderError`; mark step+run FAILED, persist | "Generation failed — resume with `sentinel review --resume <id>`" |
| Tool loop runaway | `ProviderLoopError` (max turns cap) | "Agent exceeded max steps; try `--guidance` to focus" |
| Network/transient | Surface error, persist state | Always suggest `--resume <id>` |
| User cancels at approval | Clean exit, run left at APPROVE | "Cancelled — resume anytime with `--resume <id>`" |
| $EDITOR unset on edit | Fallback: keep current markdown | Warn, continue with unedited review |

**Principle:** every failure persists workflow state so the run is always resumable; no GitHub write occurs before explicit approval (unless `--yes`).

---

## Feature → Component Coverage

| Feature ID | Feature | Components Involved |
|-----------|---------|--------------------|
| F1 | CLI entry & arg parsing | CLI, Reporter |
| F2 | Run lifecycle + SQLite state | WorkflowManager, SQLite |
| F3 | GitHub access via `gh` | GitHubClient |
| F4 | Knowledge extraction | Orchestrator, GitHubClient, KnowledgeBase |
| F5 | Interactive guidance | Reporter, Orchestrator, KnowledgeBase (reinforce) |
| F6 | KB query tool (agent tool) | KnowledgeBase (getQueryTool), AIProvider |
| F7 | Provider-agnostic AI layer | AIProvider (Provider interface) |
| F8 | Review generation | Orchestrator, AIProvider, KnowledgeBase |
| F9 | Human-in-the-loop approval | Reporter, Orchestrator |
| F10 | Idempotent comment posting | GitHubClient, Orchestrator (marker + merge) |
| F11 | Resume | WorkflowManager, Orchestrator, CLI |
| F12 | Workflow step enforcement | WorkflowManager, Orchestrator, Reporter |

**Gaps:** none — every L1 core feature maps to at least one component.

---

## Open Questions (continuing from L1)

**OQ-3 — How should the AI generate the review and use the KB?**
**Resolved → Option A:** Agentic tool-use loop; the model calls `query_knowledge_base` on demand until it emits the final review. Matches "consult at will."

**OQ-4 — How should the KB store entries for querying?**
**Resolved → Option A:** Categorized text entries (`category/subject/content/source/weight`) with keyword/category LIKE search. Zero extra deps.

---

## Decision Log

| OQ | Decision | Rationale | Date |
|----|----------|-----------|------|
| OQ-1 (L1) | Hidden HTML marker for comment identity | Robust, invisible, survives cold-start runs | 2026-06-18 |
| OQ-2 (L1) | AI re-evaluates prior issues vs new diff | Accurate resolved-detection | 2026-06-18 |
| OQ-3 | Agentic tool-use loop for review generation | "Consult at will", avoids context bloat | 2026-06-18 |
| OQ-4 | Categorized entries + keyword search | Thin, no extra deps, queryable | 2026-06-18 |

## Iteration Log

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-06-18 | Initial architecture: diagram, 6 components, data model, contracts, flows, coverage; OQ-3/OQ-4 resolved |
