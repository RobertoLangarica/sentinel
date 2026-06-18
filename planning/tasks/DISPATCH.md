# DISPATCH — Sentinel MVP

> How to execute the task lists. Shows execution tiers, parallelism,
> cross-domain dependencies, and integration verification.

## Task Files

| File | Domain | Tasks |
|------|--------|-------|
| `tasks-3a-foundation.md` | Persistence + GitHub + AI (leaf modules) | T1–T7 |
| `tasks-3b-app.md` | CLI + Orchestrator + Reporter (glue + UX) | T1–T6 |

## Execution Tiers

```
TIER 0 — Scaffold (blocks everything)
  └─ 3a-T1  Project scaffold + src/types.ts + npm install
            (package.json, tsconfig.json shared by both domains)

TIER 1 — Foundation modules (parallel after 3a-T1)
  ├─ 3a-T2  schema + run-id            ┐
  ├─ 3a-T5  GitHubClient + comment      │ independent
  └─ 3a-T6  AIProvider + agentic loop  ┘
        then:
  ├─ 3a-T3  WorkflowManager  (needs 3a-T2)
  └─ 3a-T4  KnowledgeBase     (needs 3a-T2)

TIER 1' — App leaves (parallel; can overlap Tier 1 using stubs)
  ├─ 3b-T1  Reporter          (needs types only)
  ├─ 3b-T2  extract           (needs types only)
  └─ 3b-T5  .gitignore + README (no deps)

TIER 2 — Integration
  └─ 3b-T3  Orchestrator      (needs ALL 3a impls + 3b-T1 + 3b-T2)

TIER 3 — Surface
  └─ 3b-T4  CLI + bin         (needs 3b-T3)

TIER 4 — Verify
  ├─ 3a-T7  Foundation tests  (needs 3a-T3..T6)
  └─ 3b-T6  App tests + smoke (needs 3b-T3, 3b-T4)
```

## Cross-Domain Dependencies

| Consumer | Depends on | Contract source |
|----------|-----------|-----------------|
| 3b-T3 Orchestrator | 3a WorkflowManager, KnowledgeBase, GitHubClient, AIProvider, comment helpers | `src/types.ts` + `level-2-architecture.md` |
| 3b-T1/T2 | `src/types.ts` (3a-T1) | shared interfaces |
| Both domains | `package.json`, `tsconfig.json` (3a-T1) | scaffold |

**Parallelization note:** If two agents work simultaneously, the app agent can build 3b-T1/T2 against `src/types.ts` immediately after 3a-T1, using the Stubs in `level-3b-app.md` for 3a impls until they land. Single-agent build just follows tiers top-to-bottom.

## Build Order (single agent, recommended)

```
3a-T1 → 3a-T2 → 3a-T3 → 3a-T4 → 3a-T5 → 3a-T6 → 3a-T7
      → 3b-T1 → 3b-T2 → 3b-T3 → 3b-T4 → 3b-T5 → 3b-T6
```

## Integration Verification

After all tasks complete, verify end-to-end:

```bash
# 1. Build + unit tests
npm install
npm run build
npm test

# 2. CLI surface works
node bin/sentinel.js --help          # prints full usage
node bin/sentinel.js runs            # "No runs yet."

# 3. Preconditions for live run
gh auth status                       # authenticated
echo "$ANTHROPIC_API_KEY" | head -c 4  # key present

# 4. Live smoke (against a real PR in this repo)
node bin/sentinel.js review <pr> --no-guidance
#  → fetches PR, extracts rules, generates review,
#    shows preview, on approve posts a Sentinel comment with commit SHA

# 5. Re-review idempotency
node bin/sentinel.js review <same-pr>
#  → EDITS the existing comment (no duplicate), updates SHA,
#    marks resolved prior issues

# 6. Resume
#  Ctrl+C mid-run, then:
node bin/sentinel.js runs                       # shows the interrupted run
node bin/sentinel.js review --resume <run-id>   # continues from last step
```

**Definition of done (MVP):**
- `sentinel review <pr>` produces a human-approved review posted to GitHub with a commit SHA
- Re-running edits the same comment (idempotent via marker), never duplicates
- `--resume`, `--yes`, `--no-guidance`, `--model`, `runs`, `--help` all behave per spec
- `.sentinel/` is gitignored; unit tests green
