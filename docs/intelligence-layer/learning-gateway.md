# Learning Gateway

The learning layer now exposes one compact API on top of the existing HermesClaw and pgvector stack:

- `POST /api/learning/search`
- `POST /api/learning/store`
- `POST /api/learning/score`
- `POST /api/learning/curate`

`/search` returns the most relevant local indexed lessons plus RAG-backed lessons when PostgreSQL/Ollama are available. It also returns a compact prompt-ready string so agents can inject only the useful context instead of whole memory files.

`/store` writes durable lessons through HermesClaw into the Central Brain path and logs learning events in `memory/learning-events.jsonl`.

`/score` records whether a task benefited from recalled lessons.

`/curate` records human review decisions in `memory/lesson-curation.jsonl`.
Supported actions are `approve`, `retire`, and `merge`; curation is an overlay, so
the generated lesson index remains reproducible.

The gateway also:

- applies `LearningPolicy` quality gates so draft lessons do not enter prompts
- records which lessons were recalled for each task and how that task ended
- ranks lessons with lexical, tag, file, quality, and historical outcome signals
- surfaces curation queues, failed recalls, unused lessons, and skill-promotion candidates

## Local Workflow

1. Capture a lesson after a completed change:

    ```bash
    node scripts/lesson-capture.mjs
    ```

    For structured payloads, prefer `--json-file=<path>` on shells where inline JSON quoting is fragile.

2. Regenerate the machine-readable index:

    ```bash
    node scripts/regenerate-lesson-index.mjs
    ```

    Regeneration now annotates each lesson with `quality_score` and `policy_status`.
    Auto-mined commit lessons remain `draft` until they gain a durable rule and evidence.

3. Optionally summarize and push lessons into Central Brain:

    ```bash
    node scripts/ollama-summarize-lesson.mjs
    node scripts/central-brain-store-lesson.mjs
    ```

## Agent Rule

Agents should query the gateway before planning and store one concise lesson after successful or failed work. Store problem, root cause, solution, changed files, tags, confidence, and references. Do not store secrets, full transcripts, or raw terminal dumps.

`scripts/ml/build-agent-context.mjs "<task>"` creates `memory/context/latest-agent-context.md` from the Working Tree, task memory, feature knowledge, bug memory, model decisions, and the most relevant indexed lessons. This is the pre-task context artifact required by `AGENTS.md`.
