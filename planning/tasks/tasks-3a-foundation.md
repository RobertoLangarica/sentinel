# Tasks — 3a Foundation (Persistence, GitHub, AI)

> Generated from `level-3a-foundation.md`
> Each task is a self-contained unit of work for an implementation agent.

## Execution Order

Tasks numbered. T1 must come first (shared types + project setup).
T2–T4 (db), T5 (github), T6 (ai) can run in parallel after T1.
Tests (T7) come last within this domain.

---

### T1 — Create project scaffold and shared types

**Do:**
- Create `package.json` per the spec in `level-3b-app.md` (deps, `"type":"module"`, `bin`, scripts). It's shared across domains; create it here.
- Create `tsconfig.json` per spec (`NodeNext`, `strict`, `outDir: dist`, `rootDir: src`).
- Create `src/types.ts` containing ALL interfaces from L2/3a "Exposes" block: `WorkflowState`, `RunRecord`, `StepRecord`, `WorkflowManager`, `KBCategory`, `KBEntry`, `KBQuery`, `KnowledgeBase`, `PullRequest`, `ChangedFile`, `IssueComment`, `GitHubClient`, `AgentTool`, `ReviewIssue`, `GenerateReviewInput`, `GeneratedReview`, `Provider`, `ProviderTurn`, `AIProvider`, `ReviewOptions`, `RunResult`, `ApprovalChoice`, `Reporter`.
- Append the 8 error classes: `ValidationError`, `NotFoundError`, `DBError`, `GitHubAuthError`, `GitHubExecError`, `ProviderAuthError`, `ProviderError`, `ProviderLoopError`.
- Run `npm install`.

**Files:** `package.json`, `tsconfig.json`, `src/types.ts`

**Acceptance:** `npm run build` compiles with zero errors; `src/types.ts` exports every interface and error class.

**Depends on:** nothing

---

### T2 — Create SQLite schema and run-id generator

**Do:**
- Create `src/db/schema.ts` with `SCHEMA_SQL` (5 tables exactly as in 3a: `run`, `workflow_step`, `kb_entry`, `review`, `review_issue` + the two indexes), `initSchema(db)`, and `STEP_ORDER` const array.
- Create `src/db/ids.ts` with `generateRunId()` returning `<hex>-<adj>-<noun>` using `node:crypto` (no external deps).

**Files:** `src/db/schema.ts`, `src/db/ids.ts`

**Acceptance:** Calling `initSchema(new Database(':memory:'))` creates all 5 tables (verify via `sqlite_master`); `generateRunId()` matches `/^[0-9a-f]{4}-[a-z]+-[a-z]+$/`.

**Depends on:** T1

---

### T3 — Implement WorkflowManager

**Do:**
- Create `src/db/workflow.ts` with `WorkflowManagerImpl` implementing `WorkflowManager` exactly as in 3a.
- Include static `create()` (new run-id + DB under `.sentinel/runs/`), static `open(runId)` (throws `NotFoundError` if missing), static + instance `listRuns(limit)` scanning `.sentinel/runs/*.db`.
- Implement `createRun` (insert run + seed 7 `workflow_step` rows), `loadRun`, `markStep`, `getNextStep` (first non-`done`), `setRunState`, `recordError`, and the `ageLabel` helper.

**Files:** `src/db/workflow.ts`

**Acceptance:** Unit test: `create()` then `createRun({prNumber:1,repo:'a/b'})` yields a `RunRecord` with `state:'INIT'` and 7 pending steps; `markStep(id,'INIT','done')` then `getNextStep(id)` returns `'FETCH_PR'`.

**Depends on:** T2

---

### T4 — Implement KnowledgeBase + query tool

**Do:**
- Create `src/db/knowledge.ts` with `KnowledgeBaseImpl` implementing `KnowledgeBase` exactly as in 3a.
- Implement `addEntry`, `addEntries` (in a transaction), `reinforce` (increment weight on category+content match, else insert), `query` (category + keyword LIKE, validate category, order by weight, default limit 20), `all`, and `getQueryTool(runId)` returning the `query_knowledge_base` AgentTool with the specified schema + handler.

**Files:** `src/db/knowledge.ts`

**Acceptance:** Unit test: add 3 entries (2 constraint, 1 rule), `query(runId,{category:'constraint'})` returns 2; `reinforce` same content twice → 1 row with `weight:2`; the tool handler returns a formatted bullet list.

**Depends on:** T2

---

### T5 — Implement GitHubClient + comment helpers

**Do:**
- Create `src/github/comment.ts` with `MARKER = '<!-- sentinel-review:v1 -->'`, `buildCommentBody(markdown, sha, issues)` (embeds base64 `sentinel-meta` + SHA footer), `parseCommentBody(body)` (decodes meta, returns null if absent), `hasMarker(body)`.
- Create `src/github/client.ts` with `GitHubClientImpl` implementing `GitHubClient` over `gh` via `child_process.execFile`, with an injectable `Runner` (default execs `gh`, 20MB maxBuffer). Map auth/not-found/exec errors to the right error classes. Implement all 6 methods exactly as in 3a (`getPR`, `getDiff`, `getChangedFiles`, `findSentinelComment`, `createComment`, `updateComment`).

**Files:** `src/github/comment.ts`, `src/github/client.ts`

**Acceptance:** Unit test with an injected fake `Runner`: `getPR` parses `gh` JSON into `PullRequest`; `findSentinelComment` returns the marked comment; `buildCommentBody`→`parseCommentBody` round-trips issues + sha.

**Depends on:** T1

---

### T6 — Implement AIProvider (Anthropic + agentic loop)

**Do:**
- Create `src/ai/provider.ts` with `DEFAULT_MODEL`, `AnthropicProvider implements Provider` (throws `ProviderAuthError` if no key; `complete()` maps Anthropic content blocks to `ProviderTurn` toolCalls/text; wraps errors in `ProviderError`).
- Create `src/ai/agent.ts` with `AIProviderImpl implements AIProvider`, the `SYSTEM` prompt, `MAX_TURNS=8` tool-use loop (echo assistant `tool_use`, feed `tool_result`, parse final JSON via `extractJson`), and throw `ProviderLoopError` if no JSON within the cap.

**Files:** `src/ai/provider.ts`, `src/ai/agent.ts`

**Acceptance:** Unit test with a `FakeProvider`: first turn returns one tool call (handler invoked), second returns JSON → `generateReview` returns a `GeneratedReview` with parsed issues; a provider that never returns JSON throws `ProviderLoopError`.

**Depends on:** T1

---

### T7 — Write foundation unit tests

**Do:**
- Add tests using Node's built-in `node:test` + `:memory:` SQLite (no extra deps) covering the Testing table in 3a: schema init, step seeding, getNextStep, resume load, KB query/keyword/reinforce, comment build/parse, findSentinelComment, github runner parsing, agent loop tool-use + runaway.

**Files:** `src/**/*.test.ts` (colocated) or `test/`

**Acceptance:** `npm run build && npm test` passes all foundation tests green.

**Depends on:** T3, T4, T5, T6

---

## Task Quality Checklist

- [x] Each task starts with a verb
- [x] Every task has exact file paths
- [x] Every task has acceptance criteria
- [x] Instructions are precise — no design decisions left to the agent
- [x] Tasks are small — one coherent change, reviewable in isolation
- [x] No task says "implement" without specifying what the implementation does
