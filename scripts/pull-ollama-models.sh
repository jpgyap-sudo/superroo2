#!/usr/bin/env bash
set -euo pipefail

# Default for weak VPS log summarizer:
ollama pull qwen2.5:0.5b

# Fallback for deeper summaries when CPU/RAM allow it:
# Note: 1.5B model (986MB) doesn't fit in VPS RAM (only ~588MB free). Use 0.5B instead.
# ollama pull qwen2.5:1.5b

# Embeddings for learning-layer and RAG lookups:
ollama pull nomic-embed-text

# Uncomment only if VPS has enough spare RAM:
# ollama pull qwen2.5-coder:3b
# ollama pull qwen2.5-coder:7b
