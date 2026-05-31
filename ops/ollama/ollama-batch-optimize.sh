#!/usr/bin/env bash
# =============================================================================
# SuperRoo — Ollama Batch Size Optimization Script
# =============================================================================

set -euo pipefail

# Detect system resources
TOTAL_RAM_GB=$(free -g | awk '/^Mem:/{print $2}')
CPU_CORES=$(nproc)

echo "=== System Detection ==="
echo "Total RAM: ${TOTAL_RAM_GB}GB"
echo "CPU Cores: ${CPU_CORES}"

# Calculate optimal batch size based on available resources
# Formula: min(1024, CPU_CORES * 32, TOTAL_RAM_GB * 8)
OPTIMAL_BATCH=$((CPU_CORES * 32))
if [ "$OPTIMAL_BATCH" -gt 1024 ]; then
    OPTIMAL_BATCH=1024
fi

MAX_QUEUE=$((OPTIMAL_BATCH * 2))

echo ""
echo "=== Recommended Settings ==="
echo "OLLAMA_BATCH_SIZE=${OPTIMAL_BATCH}"
echo "OLLAMA_MAX_QUEUE=${MAX_QUEUE}"

# Apply settings
export OLLAMA_BATCH_SIZE="${OPTIMAL_BATCH}"
export OLLAMA_MAX_QUEUE="${MAX_QUEUE}"

# Benchmark function
benchmark_batch() {
    local model="${1:-nomic-embed-text}"
    local prompt="${2:-This is a test prompt for benchmarking Ollama batch performance on a 64GB system.}"
    
    echo ""
    echo "=== Benchmarking ${model} ==="
    
    # Time embedding generation
    START=$(date +%s%N)
    curl -s http://localhost:11434/api/embeddings \
        -d "{\"model\":\"${model}\",\"prompt\":\"${prompt}\"}" > /dev/null
    END=$(date +%s%N)
    
    DURATION=$(( (END - START) / 1000000 ))
    echo "Embedding time: ${DURATION}ms"
}

# Run benchmark if ollama is running
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    benchmark_batch "nomic-embed-text"
    benchmark_batch "qwen2.5:0.5b"
else
    echo "Ollama not running. Start with: ollama serve &"
fi

echo ""
echo "=== Apply to Shell ==="
echo "Add these to your ~/.bashrc:"
echo "  export OLLAMA_BATCH_SIZE=${OPTIMAL_BATCH}"
echo "  export OLLAMA_MAX_QUEUE=${MAX_QUEUE}"