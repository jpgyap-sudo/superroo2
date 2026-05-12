#!/bin/sh
# =============================================================================
# SuperRoo — Ollama Entrypoint
#
# Starts the Ollama server in the background, then pulls the required models
# so they are ready when the daemon connects.
# =============================================================================

set -e

echo "[ollama-entrypoint] Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for the server to be ready
echo "[ollama-entrypoint] Waiting for Ollama server to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "[ollama-entrypoint] Ollama server is ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "[ollama-entrypoint] ERROR: Ollama server failed to start."
        exit 1
    fi
    sleep 2
done

# Pull embedding model (required for pgvector RAG)
EMBEDDING_MODEL="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"
echo "[ollama-entrypoint] Pulling embedding model: ${EMBEDDING_MODEL}..."
ollama pull "${EMBEDDING_MODEL}"

# Pull text model (required for cheap inference routing)
TEXT_MODEL="${OLLAMA_TEXT_MODEL:-qwen2.5:0.5b}"
echo "[ollama-entrypoint] Pulling text model: ${TEXT_MODEL}..."
ollama pull "${TEXT_MODEL}"

echo "[ollama-entrypoint] All models ready. Ollama is running."

# Wait for the Ollama server process
wait $OLLAMA_PID
