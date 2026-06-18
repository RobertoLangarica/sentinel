# 🛡️ Sentinel

AI-powered PR reviewer. Sentinel learns your repo's rules (from `README`, `AGENTS`,
explicit constraints like "do not touch this file"), understands a PR's goals, takes
your guidance, generates a concise review, lets you **approve it before anything is
posted**, and then posts it to GitHub as a single, evolving comment.

---

## The mental model (read this first if CLIs are new to you)

A **CLI tool** is just a program you run by typing its name in a terminal, followed by
a command and some options. Think of it like sentences:

```
sentinel  review  123  --guidance "focus on security"
   │         │     │            │
   tool   command  argument    option (a named setting)
```

- **tool** = `sentinel` (the program itself)
- **command** = what you want it to do (`review`, `runs`, `config`)
- **argument** = the thing it acts on (here, PR number `123`)
- **option/flag** = a setting that tweaks behavior (starts with `--`)

You don't memorize anything — every command has `--help`:

```bash
sentinel --help            # top-level: lists all commands
sentinel review --help     # help for one command
sentinel config --help
```

**Two things Sentinel needs to do its job:**

1. **GitHub access** — it shells out to the `gh` CLI (GitHub's official tool). You log
   in once with `gh auth login` and Sentinel reuses that. No tokens to manage.
2. **An Anthropic API key** — this is what powers the AI. You save it **once** into a
   config file (below) and then forget about it.

Everything Sentinel stores for a run lives in a hidden `.sentinel/` folder inside the
repo you're reviewing — it's gitignored, so it never gets committed.

---

## One-time setup

```bash
# 1. Install the GitHub CLI and log in (Sentinel uses it for all GitHub access)
#    (macOS: `brew install gh`)
gh auth login

# 2. Build and link Sentinel so you can call it from anywhere
cd /path/to/sentinel
npm install
npm run build
npm link            # makes the `sentinel` command available globally

# 3. Save your Anthropic API key ONCE (this is the "set and forget" part)
sentinel config set-key sk-ant-xxxxxxxxxxxxxxxx
```

That's it. The key is written to `~/.config/sentinel/config.json` (readable only by
you). You never have to type or export it again.

**Verify your setup any time:**

```bash
sentinel config show
# Config file: /Users/you/.config/sentinel/config.json
# API key:     sk-ant-…abcd   ← masked, just confirms it's set
# Model:       (default)
```

> Prefer environment variables instead of the config file? Sentinel also reads
> `ANTHROPIC_API_KEY` from the environment. The config file simply takes priority if
> both are present — so you can set it once and ignore it.

---

## Your first review

From **inside the repo whose PR you want to review** (so `gh` knows which repo you mean):

```bash
cd /path/to/your/project
sentinel review 123          # 123 = the PR number
```

Here's what happens, step by step (you'll see each one with a spinner ✓):

```
🛡️  Sentinel PR Review
──────────────────────────────────────────────────
Run ID: a3f2-keen-check          ← a name for this run (used to resume later)

✓ Fetched PR #123: Add auth middleware
✓ Knowledge extracted (5 entries from 2 files)   ← learned your repo's rules
┌ Learned Rules ──────────────────────┐
│ 1. [constraint] Never edit config/…  │
│ 2. [goal] Add JWT auth to the API    │
└──────────────────────────────────────┘

? Additional guidance/constraints (Enter to skip):   ← type anything, or just press Enter
✓ Review generated

┌ 📝 Review Preview ───────────────────┐
│ ## Sentinel Review                    │
│ - ⚠️ Hardcoded secret in auth.ts:42   │
│ ...                                   │
└──────────────────────────────────────┘

? What next?           ← YOU are in control here; nothing is posted yet
  ❯ Approve and post to GitHub
    Edit review in $EDITOR
    Regenerate review
    Cancel
```

Pick **Approve**, and Sentinel posts the review as a comment on PR #123, stamped with
the commit it reviewed. Done.

---

## Everyday commands

```bash
sentinel review 123                          # interactive review (the normal way)
sentinel review 123 --guidance "security"    # start with specific guidance
sentinel review 123 --no-guidance            # skip just the guidance question
sentinel review 123 --yes                    # no questions at all (for scripts/CI)
sentinel review --resume a3f2-keen-check      # continue a run that got interrupted
sentinel runs                                # list your recent runs and their status
sentinel config show                         # check your setup
sentinel --help                              # see everything
```

### Re-reviewing the same PR (a "re-run")

There's no special command — **just run `sentinel review 123` again**. Sentinel finds
its own previous comment and **edits it in place** (no duplicate spam): it marks issues
you've fixed as resolved, keeps the ones still open, adds anything new, and updates the
commit stamp. Each re-run is a fresh run id (you'll see it in `sentinel runs`).

To force a specific model on a re-run: `sentinel review 123 --model <name>`.

### Managing / pruning runs

Every run leaves a small SQLite file in `.sentinel/runs/`. They're harmless (and
gitignored), but you can clean them up:

```bash
sentinel runs                       # list runs
sentinel runs prune                 # remove FINISHED runs (DONE/FAILED)
sentinel runs prune --all           # remove ALL runs, including in-progress
sentinel runs rm a3f2-keen-check    # remove specific run(s) by id
```

(Deleting a run only removes local history — it never touches anything on GitHub.)


### If something fails mid-run (resuming)

Network hiccup? API error? Nothing is lost — Sentinel saves progress at every step.
You have two ways to resume:

```bash
# Easiest: resume the latest run for a PR (no need to look up the id)
sentinel review 123 --resume

# Or resume a specific run by id (from `sentinel runs`)
sentinel review --resume a3f2-keen-check
```

`sentinel review 123 --resume` finds the most recent run for PR #123 (preferring one
that isn't finished) and continues it — instead of starting a brand-new run. Without
`--resume`, `sentinel review 123` always starts a fresh run.

---

## Configuration reference

| Command | What it does |
|---------|--------------|
| `sentinel config set-key <key>` | Save your Anthropic API key (one time) |
| `sentinel config set-model <name>` | Set a default model (e.g. `claude-sonnet-4-5-20250929`) |
| `sentinel config show` | Show current config (key masked) |
| `sentinel config path` | Print the config file location |

Config file: `~/.config/sentinel/config.json`

**API key resolution:** config file → `ANTHROPIC_API_KEY` env var.

**Model resolution (evaluated live on every run, including `--resume`):**
`--model` flag → config file (`set-model`) → the run's stored value → built-in default.
So changing your configured model takes effect immediately — even when resuming an
older run.

---

## Workflow steps (what "the run" actually is)

`INIT → FETCH_PR → EXTRACT → GUIDANCE → GENERATE → APPROVE → POST → DONE`

Each step is tracked in a per-run SQLite database under `.sentinel/runs/`. That's what
makes runs **resumable** and what `sentinel runs` reads from.

---

## Requirements

- Node.js ≥ 20
- `gh` CLI, authenticated (`gh auth login`)
- An Anthropic API key (`sentinel config set-key …`)

## For developers

```bash
npm run build     # compile TypeScript → dist/
npm test          # build + run the unit test suite (22 tests)
```

**After you change the source code:**

- **Rebuild — yes.** The `sentinel` command runs the compiled code in `dist/`, so any
  change to `src/` needs `npm run build` to take effect.
- **Re-link — no.** `npm link` created a symlink to this folder; it automatically uses
  the fresh `dist/`. You only need to `npm link` again if you move or rename the
  project directory.

```bash
git pull          # if you grabbed new changes
npm install       # only if dependencies changed
npm run build     # always, to refresh dist/
# `sentinel` is ready — no re-link needed
```

- `.sentinel/`, `dist/`, and `node_modules/` are gitignored.
- The AI provider sits behind a small interface, so additional providers (OpenAI,
  local models) can be added without touching the rest of the system.
