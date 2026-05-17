#!/usr/bin/env bash
set -euo pipefail

# Best for weak VPS log summarizer:
ollama pull qwen2.5:1.5b

# Better for coding logs if VPS has ~8GB RAM:
ollama pull qwen2.5-coder:3b

# Uncomment only if VPS has ~16GB+ RAM:
# ollama pull qwen2.5-coder:7b
