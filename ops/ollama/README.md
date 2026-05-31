# =============================================================================

# SuperRoo — Ollama Optimization Suite

# =============================================================================

## Files Created

### Environment Variables

- `ollama-optimized.env` - Base optimized settings for 64GB RAM systems
- `ollama-linux.env` - Linux-specific environment file
- `ollama-windows.ps1` - Windows PowerShell configuration script

### Systemd Service

- `ollama-superroo.service` - Optimized Ollama systemd service unit
- `ollama-superroo.conf` - Drop-in override configuration

### Model Optimization

- `Modelfile` - Template with context settings
- `Modelfile.nomic-embed` - nomic-embed-text: 32K context
- `Modelfile.llama31` - llama3.1: 64K context
- `Modelfile.qwen25` - qwen2.5: 64K context

### Scripts

- `ollama-batch-optimize.sh` - Auto-detect system, benchmark, and optimize

## Quick Start

### Linux

```bash
# Apply systemd service
sudo cp ops/ollama/ollama-superroo.service /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart ollama

# Or source environment
source ops/ollama/ollama-linux.env
```

### Windows

```powershell
# Run PowerShell script as Administrator
powershell -ExecutionPolicy Bypass -File ops/ollama/ollama-windows.ps1
```

## Key Optimizations for 64GB RAM

| Variable                 | Value | Purpose                     |
| ------------------------ | ----- | --------------------------- |
| OLLAMA_NUM_THREADS       | 16    | Use adequate CPU cores      |
| OLLAMA_MAX_LOADED_MODELS | 5     | Keep multiple models in RAM |
| OLLAMA_CONTEXT_LENGTH    | 65536 | 64K token context windows   |
| OLLAMA_FLASH_ATTENTION   | 1     | Faster attention (GPU)      |
| OLLAMA_BATCH_SIZE        | 512   | Parallel request batching   |

## See Also

- `docs/ops/ollama-performance-tuning.md` - Full tuning guide
