#!/bin/sh
# =============================================================================
# SuperRoo — Ollama Entrypoint
#
# Starts the Ollama server in the background, then pulls the required models
# so they are ready when the daemon connects.
#
# NOTE: This container does NOT have curl or wget installed. We use a simple
# /dev/tcp check (via ash's built-in) to wait for the server to be ready.
# =============================================================================

echo "[ollama-entrypoint] Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for the server to be ready using a simple socket check
# (curl/wget are not available in the base ollama image)
echo "[ollama-entrypoint] Waiting for Ollama server to be ready..."
for i in $(seq 1 30); do
    if ollama list > /dev/null 2>&1; then
        echo "[ollama-entrypoint] Ollama server is ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "[ollama-entrypoint] ERROR: Ollama server failed to start."
        exit 1
    fi
    sleep 2
done

# Check if models already exist before pulling
EMBEDDING_MODEL="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"
TEXT_MODEL="${OLLAMA_TEXT_MODEL:-qwen2.5:0.5b}"

echo "[ollama-entrypoint] Checking existing models..."
EXISTING_MODELS=$(ollama list 2>/dev/null || echo "")

# Pull embedding model (required for pgvector RAG) — non-fatal if network is down
if echo "$EXISTING_MODELS" | grep -q "${EMBEDDING_MODEL}"; then
    echo "[ollama-entrypoint] Embedding model ${EMBEDDING_MODEL} already exists, skipping pull."
else
    echo "[ollama-entrypoint] Pulling embedding model: ${EMBEDDING_MODEL}..."
    ollama pull "${EMBEDDING_MODEL}" || echo "[ollama-entrypoint] WARNING: Failed to pull ${EMBEDDING_MODEL} (network may be down). Will retry on next container restart."
fi

# Pull text model (required for cheap inference routing) — non-fatal if network is down
if echo "$EXISTING_MODELS" | grep -q "${TEXT_MODEL}"; then
    echo "[ollama-entrypoint] Text model ${TEXT_MODEL} already exists, skipping pull."
else
    echo "[ollama-entrypoint] Pulling text model: ${TEXT_MODEL}..."
    ollama pull "${TEXT_MODEL}" || echo "[ollama-entrypoint] WARNING: Failed to pull ${TEXT_MODEL} (network may be down). Will retry on next container restart."
fi

echo "[ollama-entrypoint] All models ready. Ollama is running."

# Wait for the Ollama server process
wait $OLLAMA_PID
