# =============================================================================

# SuperRoo — Ollama Performance Tuning Guide for 64GB RAM Systems

# =============================================================================

## Quick Start

```bash
# Linux: Apply optimized configuration
sudo cp ops/ollama/ollama-superroo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart ollama

# Or source the environment file
source ops/ollama/ollama-optimized.env
```

## Core Optimizations

### OLLAMA_NUM_THREADS

- **Purpose**: Controls CPU threads used for inference
- **Recommendation**: Set to physical core count (not including hyperthreads)
- **64GB RAM systems**: Typically 16-32 threads depending on CPU
- **CPU detection**: `nproc` shows total cores, check `/proc/cpuinfo` for physical cores

### OLLAMA_MAX_LOADED_MODELS

- **Purpose**: Keep multiple models in RAM simultaneously
- **Formula**: `(Available RAM in GB - 8) / (Average model size in GB)`
- **Example**: With 64GB RAM and 8GB models → `(64-8)/8 = 7` models
- **Safe default**: `5` models to leave headroom

### OLLAMA_CONTEXT_LENGTH

- **Purpose**: Maximum context tokens per request
- **Default**: 8192 tokens
- **Max for 64GB systems**: 65536-131072 tokens (depending on model)
- **Models supporting 64K+**:
    - nomic-embed-text: 32768 tokens
    - llama3.1: 128K tokens
    - qwen2.5: 128K tokens

### OLLAMA_FLASH_ATTENTION

- **Purpose**: Faster attention computation (GPU only)
- **Requirement**: GPU with compute capability >= 8.0
- **Benefit**: 2-3x speedup for long contexts
- **Check GPU support**: NVIDIA V100, A100, RTX 30xx/40xx series

### OLLAMA_KV_CACHE_QUANTIZATION

- **Purpose**: Reduce memory for KV cache
- **Options**: `8bit` (default), `4bit`, `none`
- **Trade-off**: 8bit saves ~50% memory, minimal speed impact

### OLLAMA_GPU

- **Purpose**: Enable GPU acceleration
- **Values**: `1` (enabled) or `0` (disabled)
- **Note**: Requires CUDA/OpenCL compatible GPU

### OLLAMA_NUMA

- **Purpose**: NUMA-aware thread binding
- **Values**: `1` (enabled) or `0` (disabled)
- **Benefit**: Reduces cross-NUMA memory access latency

### OLLAMA_BATCH_SIZE

- **Purpose**: Parallel request batching
- **Range**: 64-1024
- **64GB recommendation**: `512` for high throughput

### OLLAMA_MAX_QUEUE

- **Purpose**: Concurrent request queue size
- **64GB recommendation**: `512` to handle bursts

### OLLAMA_KEEP_ALIVE

- **Purpose**: Keep models loaded in memory
- **Format**: `1h`, `24h`, `72h`
- **64GB recommendation**: `1h` to keep models ready

## NUMA-Specific Tuning

For NUMA systems (multiple CPU sockets), add to `/etc/default/grub`:

```
GRUB_CMDLINE_LINUX="numa_balancing=disable numactl --interleave=all"
```

Then run:

```bash
sudo update-grub && sudo reboot
```

## Memory Locking (HugeTLB)

Improve performance by locking Ollama pages:

```bash
# Check current limits
ulimit -l

# Set in /etc/security/limits.conf
ollama soft memlock unlimited
ollama hard memlock unlimited

# Create huge pages (optional)
echo 4096 > /proc/sys/vm/nr_hugepages
```

## GPU Detection

```bash
# Check NVIDIA GPU
nvidia-smi

# Verify Ollama GPU support
ollama info | grep -i cuda
```

## Model-Specific Context Settings

Create model Modelfiles with custom context:

```
# Modelfile for 64K context
FROM llama3.1
PARAMETER num_ctx 65536
PARAMETER num_batch 512
PARAMETER repeat_penalty 1.0
```

## Benchmarking Script

```bash
#!/usr/bin/env bash
# benchmark-ollama.sh

echo "=== Ollama Performance Benchmark ==="
echo "Threads: $OLLAMA_NUM_THREADS"
echo "Context Length: $OLLAMA_CONTEXT_LENGTH"
echo "Max Loaded Models: $OLLAMA_MAX_LOADED_MODELS"

# Time embedding generation
time curl -s http://localhost:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"benchmark text"}' > /dev/null

# Time completion
time curl -s http://localhost:11434/api/generate \
  -d '{"model":"hermes3","prompt":"Hello world","stream":false}' > /dev/null
```

## Monitoring

```bash
# Check Ollama status
systemctl status ollama

# Monitor memory usage
watch -n 1 'free -g && ollama ps'

# View loaded models
ollama ps

# Check logs
journalctl -u ollama -f
```

## Troubleshooting

| Issue             | Solution                                             |
| ----------------- | ---------------------------------------------------- |
| Out of memory     | Reduce `OLLAMA_MAX_LOADED_MODELS`                    |
| Slow inference    | Enable `OLLAMA_GPU=1` and `OLLAMA_FLASH_ATTENTION=1` |
| High latency      | Increase `OLLAMA_BATCH_SIZE`                         |
| Context too small | Increase `OLLAMA_CONTEXT_LENGTH` (model-dependent)   |
