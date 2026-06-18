# Sentinel — Planning Progress

> Single source of truth for planning state.
> **Project:** Sentinel — AI-powered PR reviewer (MVP, thin & fast)

## Planning Levels

| Level | File | Status |
|-------|------|--------|
| Level 1 — Scope, UX & Stack | `level-1-scope.md` | ✅ Complete |
| Level 2 — Architecture | `level-2-architecture.md` | ✅ Complete |
| Level 3 — Implementation | `level-3*.md` | 🔄 In Progress |
| Task Lists | `tasks/` | ⏳ Pending |

## Master Checklist

- [x] Project explored
- [x] Progress tracker created
- [x] Level 1 confirmed
- [x] Level 2 confirmed
- [x] Coverage check passed
- [ ] Level 3 plans written
- [ ] Task lists generated
- [ ] All files pushed to git

## Key Decisions Log (Pre-Level-1)

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | TypeScript CLI tool | Type safety, engineer-friendly DX |
| D2 | Auth via `gh` CLI | Leverage existing GitHub auth, zero token management |
| D3 | Anthropic Claude primary, provider-agnostic design | Best for code review; swap models/providers later |
| D4 | SQLite per-run storage in `.sentinel/runs/<run-id>.db` | Simple, resumable, gitignored |
| D5 | Interactive by default, `--yes` to skip | Engineer needs control over review before posting |
| D6 | `--resume <run-id>` continues interrupted runs | Cheap to add, big value on failure/iteration |
| D7 | Edit existing Sentinel PR comment (not new) | Avoid comment spam; commit SHA tracks review history |

*Created: 2026-06-18 · Last updated: 2026-06-18*
