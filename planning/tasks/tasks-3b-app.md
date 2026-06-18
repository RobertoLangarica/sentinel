# Tasks — 3b Application (CLI, Orchestrator, Reporter)

> Generated from `level-3b-app.md`
> Each task is a self-contained unit of work for an implementation agent.
> **Depends on 3a** (foundation). Stub 3a interfaces if building in parallel.

## Execution Order

T1 (Reporter) and T2 (extract) are independent leaves — parallel.
T3 (Orchestrator) depends on 3a + T1 + T2.
T4 (CLI + bin) depends on T3. T5 (project meta) any time. T6 (tests) last.

---

### T1 — Implement the Reporter (terminal UX)

**Do:**
- Create `src/reporter.ts` with `ConsoleReporter implements Reporter` exactly as in 3b.
- Implement `header` (banner + run id + PR title), `step` (ora spinner returning `succeed`/`fail`), `panel` (boxen cyan), `previewReview` (boxen yellow), `promptGuidance` (prompts text, returns undefined on empty), `promptApproval` (prompts select → `approve|edit|regenerate|cancel`), `openInEditor` (write temp md, spawn `$EDITOR`, read back; warn + return unchanged if `$EDITOR` unset), `result`.

**Files:** `src/reporter.ts`

**Acceptance:** `npm run build` compiles; manual: instantiating and calling `header`/`panel`/`result` renders styled output without throwing.

**Depends on:** 3a-T1 (types)

---

### T2 — Implement knowledge extraction

**Do:**
- Create `src/extract.ts` with `extractRepoEntries(root?)` reading `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.sentinel/rules.md` (skip missing): push a whole-doc `rule` entry (truncated 4000) per file and a `constraint` entry per line matching the constraint regex (`do not|don't|never|must not|forbidden|read-only`).
- Add `extractPrGoal(pr)` returning a `goal` entry from PR title + body (truncated 3000). Include the `truncate` helper.

**Files:** `src/extract.ts`

**Acceptance:** Unit test: a README containing "Do not touch config/secrets.yaml" yields ≥1 `constraint` entry with that content; missing files are skipped without error.

**Depends on:** 3a-T1 (types)

---

### T3 — Implement the Orchestrator (workflow state machine)

**Do:**
- Create `src/orchestrator.ts` with `Orchestrator` (injectable `github`/`ai`/`reporter` deps, defaulting to real impls).
- Implement `run(options)` exactly as in 3b: validate args; create or `open`+`loadRun` (resume); loop `getNextStep` through `INIT→FETCH_PR→EXTRACT→GUIDANCE→GENERATE→APPROVE→POST`, marking each `running`→`done`.
- FETCH_PR persists `repo`+`head_sha`. EXTRACT stores KB entries + PR goal + panel. GUIDANCE prompts (when `promptGuidance`) and `reinforce`s. GENERATE recovers prior issues via `findSentinelComment`+`parseCommentBody`, calls `ai.generateReview` with the KB tool, persists `review`+`review_issue`. APPROVE preview/menu loop (edit→`openInEditor`+persist; regenerate→reset GENERATE+APPROVE to pending; cancel→return FAILED). POST builds body via `buildCommentBody`, edits existing or creates, sets DONE, returns `RunResult`.
- Wrap the whole flow in try/catch → `recordError` + failed result suggesting `--resume`.
- Include `summarizeKb` helper.

**Files:** `src/orchestrator.ts`

**Acceptance:** Unit test with fake github/ai/reporter: happy path (no existing comment) calls `createComment` and returns `state:'DONE'`; existing marked comment path passes `priorIssues` and calls `updateComment`; `promptApproval→'cancel'` returns `state:'FAILED'` with no post.

**Depends on:** 3a (all), T1, T2

---

### T4 — Implement the CLI and bin entry

**Do:**
- Create `src/cli.ts` with commander: `program` name/description/version; `review [pr-number]` command with options `--resume <run-id>`, `--guidance <text>`, `--no-guidance`, `-y/--yes`, `--model <name>`; map to `ReviewOptions` (handle `--no-guidance` → `opts.guidance===false`; `--yes` → `interactive:false, promptGuidance:false`); call `Orchestrator.run` and `process.exit` (0 DONE / 1 else).
- Add `runs [--limit]` command printing the table via `WorkflowManagerImpl.listRuns` with `stateColor`.
- Add top-level `parseAsync().catch` → red error + exit 2.
- Create `bin/sentinel.js` (`#!/usr/bin/env node` → `import('../dist/cli.js')`).

**Files:** `src/cli.ts`, `bin/sentinel.js`

**Acceptance:** `npm run build` then `node bin/sentinel.js --help` prints usage with all commands/flags; `node bin/sentinel.js runs` prints "No runs yet." on a clean checkout.

**Depends on:** T3

---

### T5 — Configure project metadata

**Do:**
- Ensure `.gitignore` includes `node_modules/`, `dist/`, `.sentinel/`.
- Create `README.md` with setup (gh auth, `ANTHROPIC_API_KEY`, install/build/link) and usage (the 5 example commands).

**Files:** `.gitignore`, `README.md`

**Acceptance:** `.sentinel/` is gitignored (`git check-ignore .sentinel` succeeds); README renders the documented commands.

**Depends on:** nothing

---

### T6 — Write application tests + e2e smoke

**Do:**
- Add `node:test` tests for the 3b Testing table: ReviewOptions mapping (`review 123`, `--yes`, `--no-guidance`), Orchestrator happy/re-review/cancel/resume paths (fakes), extract constraint detection, runs list.
- Document the manual e2e smoke: `node bin/sentinel.js review <pr> --no-guidance` against a real PR (requires `gh` auth + `ANTHROPIC_API_KEY`).

**Files:** `src/**/*.test.ts` or `test/`

**Acceptance:** `npm run build && npm test` green; manual smoke posts/updates a Sentinel comment on a test PR with a commit SHA.

**Depends on:** T3, T4

---

## Task Quality Checklist

- [x] Each task starts with a verb
- [x] Every task has exact file paths
- [x] Every task has acceptance criteria
- [x] Instructions are precise — no design decisions left to the agent
- [x] Tasks are small — one coherent change, reviewable in isolation
- [x] No task says "implement" without specifying what the implementation does
