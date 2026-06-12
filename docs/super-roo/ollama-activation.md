# SuperRoo Ollama Activation Pack

This pack wires Ollama as a local embedding generator and fallback summarizer.

## Goal

Use Ollama for local embeddings and lightweight tasks; DeepSeek API for high-quality summarization:

```text
Raw logs/errors/context
  -> DeepSeek API summarizes/compresses (primary)
  -> Ollama generates embeddings for semantic search
  -> Codex receives clean senior-debug brief
  -> DeepSeek receives implementation-only task
  -> Codex reviews final patch
```

## Files

The Ollama integration consists of:

| File                                          | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `src/super-roo/ollama/OllamaClient.ts`        | HTTP client for Ollama API (generate, chat, health)  |
| `src/super-roo/ollama/LogSummarizer.ts`       | Compresses noisy logs into structured JSON summary   |
| `src/super-roo/ollama/ContextCompressor.ts`   | Compresses engineering context for different targets |
| `src/super-roo/ollama/CodexBriefBuilder.ts`   | Builds senior-debug brief from summary               |
| `src/super-roo/ollama/DeepSeekTaskBuilder.ts` | Builds implementation-only task from summary         |
| `src/super-roo/ollama/OllamaPipeline.ts`      | Orchestrates the full pipeline                       |
| `src/super-roo/ollama/index.ts`               | Barrel export                                        |
| `src/super-roo/cli/ollama-test.ts`            | CLI test tool                                        |
| `scripts/install-ollama-vps.sh`               | VPS installation script                              |
| `scripts/pull-ollama-models.sh`               | Model pull script                                    |

## VPS install

```bash
chmod +x scripts/install-ollama-vps.sh scripts/pull-ollama-models.sh
./scripts/install-ollama-vps.sh
./scripts/pull-ollama-models.sh
```

## Add env

Add to your `.env`:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=hermes3
OLLAMA_SUMMARY_MODEL=hermes3
OLLAMA_FALLBACK_MODEL=qwen2.5:1.5b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_TEMPERATURE=0.1
OLLAMA_NUM_CTX=8192
OLLAMA_MAX_LOG_CHARS=30000
SUPERRROO_USE_OLLAMA_SUMMARIZER=true
```

Recommended weak VPS model:

```bash
OLLAMA_SUMMARY_MODEL=hermes3
```

Recommended fallback model:

```bash
OLLAMA_FALLBACK_MODEL=qwen2.5:1.5b
```

Optional larger coding model if the VPS has enough spare RAM:

```bash
OLLAMA_SUMMARY_MODEL=qwen2.5-coder:3b
```

## Test manually

```bash
mkdir -p tmp
pnpm test 2>&1 | tee tmp/latest.log
pnpm tsx src/super-roo/cli/ollama-test.ts tmp/latest.log
```

Output:

```text
tmp/ollama/summary.json
tmp/ollama/codex-brief.md
tmp/ollama/deepseek-task.md
```

## Central Brain Integration

The Ollama Pipeline is exposed through the Central Brain MCP endpoint:

### MCP Actions

| Action             | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `ollama_summarize` | Summarize logs via Ollama, returns structured JSON + codex brief + deepseek task |
| `ollama_compress`  | Compress engineering context for a target model                                  |
| `ollama_health`    | Check Ollama health and available models                                         |

### REST API

```bash
# Summarize logs
curl -X POST http://127.0.0.1:8787/brain/mcp \
  -H 'Content-Type: application/json' \
  -d '{"action":"ollama_summarize","params":{"source":"telegram","logs":"...","command":"deploy"}}'

# Compress context
curl -X POST http://127.0.0.1:8787/brain/mcp \
  -H 'Content-Type: application/json' \
  -d '{"action":"ollama_compress","params":{"title":"Debug session","goal":"Fix login bug","context":"...","target":"deepseek"}}'

# Check health
curl -X POST http://127.0.0.1:8787/brain/mcp \
  -H 'Content-Type: application/json' \
  -d '{"action":"ollama_health"}'
```

### Telegram

Use `/mcp ollama_summarize` from Telegram to summarize logs directly.

## Where to integrate next

1. After SuperRoo agent command finishes, send logs to `OllamaPipeline.processLogs()`.
2. Store `summary.json` in your MemoryStore/EventLog.
3. Send `codex-brief.md` to Codex extension or MCP brief.
4. Send `deepseek-task.md` to DeepSeek coder.
5. After final test passes, save the final diff and result to memory.

## Safety rule

Ollama should not approve production changes by itself. Use it for summarizing, compressing, retrieval, and first-pass diagnosis only.
