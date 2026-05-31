---
name: ollama-performance
description: "Optimize Ollama for 64GB RAM: all models loaded simultaneously, 128K context, flash attention, zero cold starts. Run the Windows setup script once, then warmup() at each session."
---

# Ollama Performance — 64GB RAM Setup

## One-Time Windows Setup

```powershell
# Run as Administrator in PowerShell
Set-ExecutionPolicy -Scope Process Bypass
& "C:\Users\user\Documents\superroo2\ops\ollama\ollama-windows-optimize.ps1"
```

Restart Ollama after running.

## What Gets Set

| Setting               | Value  | Impact                              |
| --------------------- | ------ | ----------------------------------- |
| MAX_LOADED_MODELS     | 5      | All 5 models in RAM simultaneously  |
| CONTEXT_LENGTH        | 131072 | 128K tokens — fit entire codebases  |
| FLASH_ATTENTION       | 1      | 2-3x faster attention computation   |
| KV_CACHE_QUANTIZATION | q8_0   | Halve KV memory, same quality       |
| KEEP_ALIVE            | 24h    | Never unload models during work day |
| NUM_PARALLEL          | 4      | 4 concurrent AI requests            |
| BATCH_SIZE            | 1024   | Max throughput per batch            |
| NUM_THREADS           | 16     | Use all physical CPU cores          |

## Memory Map

```
Model                  Size      Purpose
────────────────────────────────────────────────
hermes3 8B Q4_0        4.3 GB   Research, analysis, memory retrieval
qwen2.5-coder:14b      8.4 GB   Complex coding (primary)
qwen2.5-coder:7b       4.4 GB   Fast coding (quick edits)
phi4 14.7B Q4_K_M      8.4 GB   Deep reasoning, architecture
nomic-embed-text 137M  0.3 GB   RAG embeddings
────────────────────────────────────────────────
All models loaded      25.8 GB  (of 64GB available)
Headroom for OS/KV     ~38 GB
```

## Session Start Ritual

In Claude Code brain MCP: `warmup()`

- Pre-loads hermes3, qwen2.5-coder:7b, qwen2.5-coder:14b
- After warmup: ALL calls are instant (no cold start ever)
- Takes ~10-15 seconds the first time per session

## Verify

```bash
curl http://localhost:11434/api/ps   # shows loaded models + memory usage
ollama ps                            # same via CLI
```

## Troubleshooting

| Symptom                    | Fix                                |
| -------------------------- | ---------------------------------- |
| Slow first call            | Run `warmup()` at session start    |
| Model unloaded mid-session | Check OLLAMA_KEEP_ALIVE=24h is set |
| OOM errors                 | Reduce OLLAMA_NUM_PARALLEL to 2    |
| High CPU idle              | Normal — models stay warm in RAM   |
