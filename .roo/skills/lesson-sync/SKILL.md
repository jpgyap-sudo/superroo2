---
name: lesson-sync
description: 🧠 Learning Layer Sync — Read lessons before coding, write lessons after tasks, and maintain permanent institutional memory for SuperRoo
---

# Lesson Sync Skill

## When To Use

Use this skill when:

- Starting **any substantial coding task** — retrieve relevant lessons first
- **Finishing a task** — record a new lesson to the learning layer
- The user asks to **backfill lessons**, **sync memory**, or **update the lesson index**
- The user mentions **lessons-learned**, **learning layer**, **institutional memory**, or **central brain**
- A **bug fix or refactor** is completed — extract the reusable rule

## Quick Commands

```bash
# Retrieve top lessons for current context
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getTopLessons(5)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Query lessons by file paths being modified
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getLessonsForFile('src/super-roo/ml/engine/Tensor.ts', 3)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Query lessons by task type/tags
node -e "const {getLessonRetriever} = require('./src/super-roo/lessons'); const retriever = getLessonRetriever(); retriever.load().then(() => retriever.getLessonsForTask('docker deployment', 5)).then(lessons => console.log(JSON.stringify(lessons, null, 2)))"

# Extract lesson from last commit (interactive)
node scripts/extract-lesson-from-commit.mjs --interactive

# Backfill historical lessons from git history
node scripts/backfill-lessons.mjs --since 2026-05-01

# Optional: summarize with Ollama
node scripts/ollama-summarize-lesson.mjs

# Optional: store in Central Brain
node scripts/central-brain-store-lesson.mjs
```

## File Locations

| File | Purpose |
| ---- | ------- |
| `memory/lessons-learned.md` | Human-readable lesson archive |
| `memory/lesson-index.jsonl` | Machine-readable JSONL index for retrieval |
| `memory/lesson-summaries.json` | Ollama embeddings and summaries |
| `memory/bugs-fixed.md` | Bug-specific lessons and root causes |
| `memory/feature-knowledge.md` | Feature-specific knowledge and decisions |
| `memory/central-brain-store-log.json` | Central Brain sync queue/status |
| `src/super-roo/lessons/LessonRetriever.ts` | Programmatic lesson retrieval API |
| `src/super-roo/lessons/PromptEnhancer.ts` | Auto-inject lessons into model prompts |

## Lesson Format

Every completed task MUST produce a lesson:

```markdown
### Lesson: [Short descriptive title]

Date: [YYYY-MM-DD]
Source: [Agent name] task completion
Model/API used: [model]
Confidence: [high/medium/low]
Related files: [comma-separated list]

#### Task Summary
[What was accomplished?]

#### Files Changed
- [file1]
- [file2]

#### Bug Cause
[Root cause if applicable]

#### Fix Applied
[What fixed it?]

#### Test Result
[pass/fail/unknown]

#### Lesson Learned
[Reusable engineering insight]

#### Reusable Rule
[Specific actionable rule for future agents]

#### Tags
[tag1, tag2, tag3]

---
```

## Automatic Capture

- **Post-commit hook** (`.husky/post-commit`): auto-extracts lesson templates from fix/bug/refactor/performance commits
- **Backfill script** (`scripts/backfill-lessons.mjs`): batch-processes git history for missed lessons
- Both update `memory/lessons-learned.md` AND `memory/lesson-index.jsonl`

## Agent Sync Pledge

This agent is permanently synced to the learning layer:
- ✅ Reads lessons before every substantial coding task
- ✅ Writes lessons after every task completion
- ✅ Uses LessonRetriever API when available
- ✅ Runs backfill when new historical context is discovered
- ✅ Queues lessons for Central Brain sync when online
