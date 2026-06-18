# Level 1 — Scope, UX Concept & Stack

> Living document. Iterate until scope is locked.
> Open questions marked ❓ — we resolve them one at a time in conversation.

---

## Checklist

- [x] Vision agreed
- [x] User types and key journeys defined
- [x] UX concept locked (CLI experience)
- [x] Feature list finalized with acceptance criteria
- [x] Tech stack locked with rationale
- [x] Constraints documented
- [x] All open questions resolved
- [x] **Architect confirms: Level 1 complete**

---

## Vision

Sentinel is a thin, fast, CLI-based AI agent that reviews GitHub Pull Requests. It learns a repository's rules (from README, AGENTS, explicit constraints like "do not touch this file"), understands the PR's goals, accepts additional human guidance, then generates a concise human-approved review posted to the PR as a single, evolving comment. Success = an engineer can run `sentinel review <pr>` and get a useful, posted review in minutes with minimal setup and dependencies.

---

## Users & Journeys

### Reviewer / Engineer (primary user)

**Who they are:** Software engineers who want a fast, AI-assisted first-pass review on a PR before (or alongside) human review.
**What they care about:** Speed, control (human-in-the-loop), low setup friction, minimal dependencies, signal over noise.

**Key journeys:**
1. **First review** — Run `sentinel review 123`. Sentinel learns repo rules, parses PR goals, prompts for extra guidance, generates a review, shows it for approval, posts it to GitHub.
2. **Add guidance** — During the run, supply specific constraints ("focus on security", "ignore the generated files") that strengthen the agent's rules before review generation.
3. **Re-review after changes** — Run `sentinel review 123` again after the PR gets new commits. Sentinel edits the existing comment: marks resolved items, carries forward unresolved ones, adds new findings, updates the commit SHA.
4. **Resume an interrupted run** — A run failed (network, API). Run `sentinel review --resume <run-id>` to continue from the last completed step.
5. **Inspect past runs** — Run `sentinel runs` to see recent runs and their state.

### PR Author (indirect consumer)

**Who they are:** The developer whose PR is being reviewed; reads the posted comment.
**What they care about:** Clear, actionable, non-spammy feedback; seeing what's resolved vs. outstanding across iterations.

**Key journeys:**
1. **Read the review** — Opens the PR, sees a single Sentinel comment with current issues + resolved history, tied to a commit SHA.

---

## UX Concept

> This is a CLI tool. UX = terminal experience.

### Design Direction

Polished, minimal, progress-driven CLI. Each workflow step prints clear progress (spinners + checkmarks). Interactive by default — the engineer stays in control, especially at the review-approval gate. Think the clarity of `gh` + the progress feel of modern installers (`vite`, `turbo`). Less is more; no noise.

### Key Screens / Views / Interfaces

| Screen/View | Purpose | Key Elements | Interaction Notes |
|-------------|---------|-------------|-------------------|
| Run header | Orient the user | Banner, run ID, PR title | Printed once at start |
| Progress stream | Show workflow steps | Spinners → checkmarks per step, sub-items (files read) | Live updates via `ora` |
| Learned rules panel | Show extracted KB | Numbered list of rules/constraints/patterns | Boxed via `boxen` |
| Guidance prompt | Gather extra constraints | Free-text prompt (default on) | `prompts`; skipped with `--yes`/`--no-guidance` |
| Review preview | Human-in-the-loop gate | Rendered markdown review | Shown before any GitHub write |
| Approval menu | Decide the action | `[a]pprove / [e]dit / [r]egenerate / [c]ancel` | `prompts`; edit opens `$EDITOR` |
| Result line | Confirm outcome | Posted/updated link + commit SHA | Final success/failure message |
| `runs` list | Inspect history | run-id, PR#, state, age | Read from SQLite |
| `--help` | Explain flow & flags | Usage, commands, options, workflow, setup | Static text |

### UX Patterns & Decisions

| Pattern | Decision | Rationale |
|---------|----------|-----------|
| Progress feedback | Per-step spinner + checkmark (`ora`) | Makes ephemeral workflow visible |
| Human-in-the-loop | Mandatory review preview before posting | Engineer must approve content |
| Guidance | On by default; `--no-guidance` / `--yes` to skip | Default to control, allow scripting |
| Editing | `[e]` opens review in `$EDITOR` | Familiar engineer workflow |
| Error handling | Fail step, persist state, suggest `--resume` | Recoverable without restart |
| Idempotent posting | Edit existing Sentinel comment, never duplicate | Avoid PR comment spam |

---

## Features

### Core (must ship)

| ID | Feature | User Journey | User-Facing Behavior | Acceptance Criteria |
|----|---------|-------------|---------------------|---------------------|
| F1 | CLI entry & arg parsing | All | `sentinel review <pr>`, `--resume`, `runs`, `--help`, `--yes`, `--guidance`, `--model` | Commands parse; `--help` lists all; invalid args error clearly |
| F2 | Run lifecycle + SQLite state | 1,4,5 | Each run gets `<short-id>-<alias>`, DB at `.sentinel/runs/<id>.db`, workflow states tracked | DB created; state advances per step; `runs` lists them |
| F3 | GitHub access via `gh` | 1,3 | Fetch PR metadata, diff, changed files, existing comments | Returns PR title/body/diff; lists comments; errors if `gh` unauth |
| F4 | Knowledge extraction | 1 | Reads README, AGENTS, CONTRIBUTING, `.sentinel/rules.md`; parses PR goals; stores rules/patterns/constraints in KB | KB populated; "reason to be" derived from PR; learned rules shown |
| F5 | Interactive guidance | 2 | Prompt for extra constraints; merge into KB (strengthen existing) | Guidance captured; KB updated; skippable via flag |
| F6 | KB query tool (agent tool) | 1 | Agent calls a tool to query the KB on demand instead of carrying all context | Agent can retrieve rules/constraints by query during generation |
| F7 | Provider-agnostic AI layer | 1 | Anthropic by default; `--model` override; pluggable interface | Generates review via Anthropic; interface allows other providers |
| F8 | Review generation | 1,3 | Concise markdown review using diff + KB | Produces structured markdown; concise; references rules |
| F9 | Human-in-the-loop approval | 1 | Preview + `[a/e/r/c]` menu; edit in `$EDITOR` | No GitHub write before approval; edit/regenerate/cancel work |
| F10 | Idempotent comment posting | 1,3 | New comment if none; else edit existing; include commit SHA; mark prior items resolved | Single Sentinel comment; SHA updated; resolved items struck-through; nothing deleted |
| F11 | Resume | 4 | `--resume <id>` continues from last completed state | Resumes correct step; reuses persisted KB/state |
| F12 | Workflow step enforcement | All | Each step marked done before next; visible progress | Steps run in order; state reflects progress; failure halts cleanly |

### Stretch (Phase 2)

| ID | Feature | Why Deferred |
|----|---------|-------------|
| S1 | Additional AI providers (OpenAI, Ollama) | Interface designed now; implement when needed |
| S2 | GitHub Action / webhook automation | MVP is manual CLI; automate later |
| S3 | Cross-run KB persistence / caching | Repo grows; per-run cold start is fine for now |
| S4 | Inline / line-level review comments | MVP posts a single summary comment |
| S5 | Multi-repo / team config | Single repo, single user for MVP |

### Out of Scope (v1)

- Long-running server, webhook receiver (CLI only)
- GitHub App auth model (use `gh` CLI auth)
- Persisting/Resuming KB across different PRs
- Auto-merging or approving PRs (review comment only)

---

## Tech Stack

| Layer | Choice | Rationale | Alternatives Considered |
|-------|--------|-----------|------------------------|
| Language / Runtime | TypeScript on Node.js | Type safety, engineer DX | Python, Go |
| CLI framework | `commander` (or `yargs`) | Mature arg parsing + `--help` | Manual parsing |
| GitHub access | `gh` CLI via child process | Reuse existing auth, zero token mgmt | Octokit + PAT |
| AI provider | Anthropic SDK behind provider interface | Best at code review; swappable | OpenAI, Ollama |
| Database | SQLite (`better-sqlite3`) | Embedded, synchronous, simple, resumable | JSON file, in-memory |
| CLI UX libs | `ora`, `chalk`, `prompts`, `boxen` | Spinners, color, prompts, panels | Raw console |
| Hosting / Deploy | Local CLI (npm bin) | MVP, run locally | — |
| Key Libraries | `commander`, `@anthropic-ai/sdk`, `better-sqlite3`, `ora`, `chalk`, `prompts`, `boxen` | Minimal, focused dependency set | — |

---

## Constraints & Non-Negotiables

- **Thin & fast** — minimal dependencies, runnable in minutes.
- **`gh` CLI must be installed and authenticated** — Sentinel does not manage tokens.
- **`ANTHROPIC_API_KEY` required** in environment.
- **`.sentinel/` must be gitignored** — run DBs are local artifacts.
- **Human-in-the-loop is mandatory** before any GitHub write (unless `--yes`).
- **Idempotent posting** — never create duplicate Sentinel comments.
- **Each run is a cold start** for KB (no cross-PR memory in v1), but resumable within a run.

---

## Open Questions

**OQ-1 — How does Sentinel identify its own existing comment on a PR?**
Needed for idempotent editing (F10). We must reliably find "the Sentinel comment" among potentially many PR comments.

| Option | What It Means | Upside | Downside |
|--------|--------------|--------|----------|
| A | Match a signature line/marker in the comment body (e.g., `<!-- sentinel-review -->` hidden HTML marker) | Robust, invisible to readers, survives edits | Relies on body parsing |
| B | Match the comment author (the `gh` authenticated user) + a visible header | Simple | Breaks if user posts other comments; ties identity to a human account |
| C | Store the GitHub comment ID in the run DB | Exact | Lost across cold-start runs (different DB per run) → unreliable for re-review |

> **My recommendation:** **Option A** — A hidden HTML marker (`<!-- sentinel-review:v1 -->`) in the comment body is the standard idempotency pattern for bots and survives across independent runs.

**OQ-2 — What does "mark resolved" mean technically for prior issues on re-review?**
On re-review (F10), how do we decide an item is resolved?

| Option | What It Means | Upside | Downside |
|--------|--------------|--------|----------|
| A | Heuristic: if a prior issue's file/lines changed since last reviewed SHA, mark it as "potentially resolved" and let the AI verify against new diff | Automatic, mostly accurate | Some false positives/negatives |
| B | Ask the AI to re-evaluate every prior issue against the new code each run | Most accurate | More tokens / slower |
| C | Just carry all prior issues forward; human edits the markdown to strike resolved ones | Simplest, zero logic | Manual work, defeats automation |

> **My recommendation:** **Option B** — On re-review, feed prior issues + new diff to the AI and let it classify each as resolved/unresolved/new. Most accurate and aligns with the "agent understands the PR" vision; token cost is acceptable for MVP.

---

## Decision Log

| OQ | Decision | Rationale | Date |
|----|----------|-----------|------|
| (pre) D1–D7 | See PROGRESS.md decisions | Established in planning conversation | 2026-06-18 |
| OQ-1 | Option A — hidden HTML marker (`<!-- sentinel-review:v1 -->`) in comment body | Robust, invisible, survives independent cold-start runs | 2026-06-18 |
| OQ-2 | Option B — AI re-evaluates each prior issue vs. new diff (resolved/unresolved/new) | Most accurate; aligns with agent-understands-PR vision | 2026-06-18 |

## Iteration Log

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-06-18 | Initial draft from planning conversation; 2 open questions raised |
| v0.2 | 2026-06-18 | OQ-1 + OQ-2 resolved; all checklist items complete except final confirmation |
