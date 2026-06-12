# Copilot Local Ollama Coder

This workflow is only for GitHub Copilot Chat in this repository. Do not use it as the default route for Codex, Kilo Code, Claude, Blackbox, Roo, or the SuperRoo VS Code extension.

## Role Map

| Role | Model |
|---|---|
| Planner | `hermes3` |
| Architect | `phi4` |
| Coding | `qwen2.5-coder:7b` |
| Complex Coding | `qwen2.5-coder:14b` |
| Search/Embeddings | `nomic-embed-text` |
| Long-term Memory | SuperRoo Memory Explorer |

## Command

```powershell
node scripts/copilot-local-coder.mjs "user request"
```

For model readiness:

```powershell
node scripts/copilot-local-coder.mjs --check-models
```

## Scope Rule

Copilot Chat should use this local Ollama workflow for coding assistance. Other coding extensions keep their own established routing and must not be migrated to this Copilot-only agent.

## Memory

The local agent reads:

- `memory/lesson-index.jsonl`
- `memory/lessons-learned.md`

It uses `nomic-embed-text` when available and falls back to keyword matching over local SuperRoo lessons when stored lesson vectors are unavailable.
