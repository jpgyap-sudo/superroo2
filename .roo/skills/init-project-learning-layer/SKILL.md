---
name: init-project-learning-layer
description: Initializes the SuperRoo cross-project learning layer for a new project — generates LEARNING_LAYER.md with before/after coding instructions, creates memory/ directory, and verifies superroo-learn connectivity.
---

# Init Project Learning Layer Skill

## When To Use

Use this skill when the user starts working on a **new project** (a directory that is NOT the `superroo2` repo) and needs the cross-project learning layer set up. This includes:

- A brand new project directory
- An existing project that hasn't been wired to the learning layer yet
- Any time the user says "I'm starting a new project" or "set up learning layer for this project"

## What This Skill Does

1. Runs `node tools/init-project-learning-layer.mjs --project-dir <path>` to generate `LEARNING_LAYER.md` with learning layer instructions
2. Creates `memory/` directory with empty `lessons-learned.md` and `lesson-index.jsonl`
3. Verifies `superroo-learn health` works from the new project directory
4. Runs an initial `superroo-learn query` to check if any existing lessons are relevant
5. If the project has git history, runs `superroo-learn scan` to backfill historical lessons

## Steps

### Step 1: Determine Project Path

If the user didn't specify a path, ask for it. The project path is typically outside the `superroo2` repo.

### Step 2: Run the Init Script

```bash
node /path/to/superroo2/tools/init-project-learning-layer.mjs \
  --project-dir "<project-path>" \
  [--project-name "<name>"] \
  [--force]
```

- Use `--project-name` if the auto-detected name is wrong
- Use `--force` only if the user explicitly wants to overwrite an existing `LEARNING_LAYER.md`

### Step 3: Verify Connectivity

```bash
cd <project-path> && superroo-learn health
```

If health check fails:

- Check that `superroo-learn` is in PATH (if not, run `node /path/to/superroo2/tools/install-global-hook.mjs`)
- Check that `DEEPSEEK_API_KEY` is accessible (the script checks `~/superroo/superroo2/.env` as fallback)

### Step 4: Initial Lesson Query

```bash
cd <project-path> && superroo-learn query "initial project scan"
```

This confirms the learning layer is working and shows any relevant lessons from other projects.

### Step 5: Backfill Historical Lessons (if git repo)

```bash
cd <project-path> && superroo-learn scan
```

This processes all git commits that match lesson indicators and stores them with DeepSeek summaries.

### Step 6: Report Summary

Tell the user what was created and what they need to do next:

- `LEARNING_LAYER.md` — review and fill in TODO sections
- `memory/lessons-learned.md` — lesson storage
- `memory/lesson-index.jsonl` — lesson search index
- Remind them to run `superroo-learn query` before coding and `superroo-learn store` (or `git commit`) after coding

## Example

User says: "I'm starting a new project called invoice-parser in ~/projects/invoice-parser"

Agent runs:

```bash
node /path/to/superroo2/tools/init-project-learning-layer.mjs \
  --project-dir ~/projects/invoice-parser \
  --project-name invoice-parser
cd ~/projects/invoice-parser && superroo-learn health
superroo-learn query "PDF parsing invoice extraction"
superroo-learn scan
```

## Notes

- This skill is for **cross-project** setup only. The `superroo2` repo already has its own learning layer configured.
- The init script is idempotent — running it again on the same project is safe (it won't overwrite without `--force`).
- If `superroo-learn` is not in PATH, the user can run it directly: `node /path/to/superroo2/tools/superroo-learn.mjs`
- Agents (Roo, Claude Code, Codex) should read `LEARNING_LAYER.md` at the start of each session to follow learning layer instructions.
