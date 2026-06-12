# Copilot Workspace Instructions

## Copilot Chat Local Coder

GitHub Copilot Chat in this repo must use the Copilot-only local Ollama coding agent for coding assistance. This workflow is not for Codex, Kilo Code, Claude, Blackbox, Roo, or the SuperRoo VS Code extension.

Role map:

| Role | Model |
|---|---|
| Planner | `hermes3` |
| Architect | `phi4` |
| Coding | `qwen2.5-coder:7b` |
| Complex Coding | `qwen2.5-coder:14b` |
| Search/Embeddings | `nomic-embed-text` |
| Long-term Memory | SuperRoo Memory Explorer |

For any Copilot coding task, preserve the user's prompt and run:

```bash
node scripts/copilot-local-coder.mjs "original user prompt"
```

For model readiness:

```bash
node scripts/copilot-local-coder.mjs --check-models
```

Do not use this workflow for other coding extensions. Do not rewrite Kilo, Codex, Claude, Blackbox, Roo, or SuperRoo VS Code routing to use this Copilot-only agent.

## Chat/API Fallback

If GitHub Copilot Chat or the Copilot API is unavailable, rate-limited, returns 403/5xx, or cannot answer:

1. Preserve the user's original prompt exactly.
2. Run the Copilot-only local Ollama coder:

```bash
node scripts/copilot-local-coder.mjs "original user prompt"
```

3. Tell the user that Copilot API failed and that the answer came from the local Copilot Ollama coder.
4. Do not fall back to other coding extensions. If local Ollama is unavailable, report the missing model or Ollama service instead of routing to Kilo/Codex/Claude/Blackbox.

## Before Any Task

1. Run `node scripts/copilot-local-coder.mjs --check-models` when model readiness is unknown.
2. Run `node scripts/copilot-local-coder.mjs "task description"` for the actual coding response.
3. The script uses SuperRoo Memory Explorer over local lessons before planning and coding.

## Task Sync With SuperRoo

- Track Copilot work in `.github/copilot-tasks.json`.
- Before starting work, run `node scripts/sync-tasks-bidirectional.mjs --status` and check `ACTIVE_WORK.md`.
- When starting or updating a Copilot task, edit `.github/copilot-tasks.json` and run:

```bash
node scripts/sync-tasks-bidirectional.mjs
node scripts/gen-active-work.mjs
```

- Use `agent: "copilot"` and `project: "superroo2"` so SuperRoo can show Copilot work beside Codex, Claude, Kilo, and Blackbox.

## Copilot-only Local Agent Script

See `docs/agent-workflow/copilot-local-ollama-coder.md` for the full local workflow.
