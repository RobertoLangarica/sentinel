# 🛡️ Sentinel

AI-powered PR reviewer. Sentinel learns your repo's rules (from `README`, `AGENTS`,
explicit constraints like "do not touch this file"), understands a PR's goals, takes
your guidance, generates a concise review, lets you approve it, and posts it to GitHub
as a single, evolving comment.

## How it works

```
review → learn repo rules → your guidance → AI generates review
       → you approve/edit → posts (or edits) a single PR comment with the commit SHA
```

- **Idempotent:** re-running on the same PR edits the existing Sentinel comment (it
  never spams duplicates) and marks previously-found issues as resolved when fixed.
- **Resumable:** each run is tracked in a per-run SQLite DB under `.sentinel/runs/`.
  If a run fails, continue with `--resume <run-id>`.
- **Agentic:** the model consults a knowledge base of your repo's rules on demand
  rather than carrying all context every turn.

## Setup

```bash
# 1. GitHub CLI must be installed and authenticated (Sentinel uses it for all GitHub access)
gh auth login

# 2. Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Install + build + link
npm install
npm run build
npm link        # makes `sentinel` available globally
```

## Usage

```bash
sentinel review 123                         # Interactive review of PR #123
sentinel review 123 --guidance "security"   # Add specific guidance
sentinel review 123 --yes                    # No prompts (automation)
sentinel review 123 --no-guidance            # Skip only the guidance prompt
sentinel review --resume a3f2-keen-check     # Continue an interrupted run
sentinel review 123 --model claude-3-opus-latest  # Override the model
sentinel runs                                # List recent runs
sentinel --help                              # Full help
```

## Workflow steps

`INIT → FETCH_PR → EXTRACT → GUIDANCE → GENERATE → APPROVE → POST → DONE`

Each step is tracked and visible in the terminal. A failure persists state so you can
always `--resume`.

## Requirements

- Node.js ≥ 20
- `gh` CLI (authenticated)
- `ANTHROPIC_API_KEY`

## Notes

- `.sentinel/` is gitignored — run databases are local artifacts.
- The AI provider is behind an interface; additional providers (OpenAI, local) can be
  added without touching the rest of the system.
