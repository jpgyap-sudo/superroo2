# Plug-and-Play Ollama Migration Architecture

SuperRoo now uses `~/.superroo/ollama-mode.json` as the shared local-model mode file.

Use:

```bash
node scripts/ollama-migration-mode.mjs --status
node scripts/ollama-migration-mode.mjs --set=pure-ollama
node scripts/ollama-migration-mode.mjs --set=hybrid-local
```

`codex-brain-mcp.mjs` reads this file at startup and sets default model envs for thinker, fast coder, pro coder, embeddings, local Ollama, and optional VPS fallback. Extension configs can still override individual env vars when needed.

Modes:

- `hybrid-local`: local Ollama first, Tailscale VPS fallback.
- `pure-ollama`: all thinking, coding, review, and embeddings stay on local Ollama.

Reusable rule: avoid hardcoding model migration choices in each extension. Put the mode in `~/.superroo/ollama-mode.json`, restart MCP clients, then verify with `brain_status`, `ollama_status`, and a small `smart_code` dry run.
