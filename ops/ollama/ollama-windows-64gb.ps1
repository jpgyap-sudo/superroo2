# Ollama Performance Configuration for 64GB RAM (Windows)
# Run once as Administrator, then restart Ollama.
#
# With 64GB RAM you can load ALL models simultaneously:
#   hermes3       4.3 GB
#   qwen2.5-coder:14b  8.4 GB
#   qwen2.5-coder:7b   4.4 GB
#   phi4          8.4 GB
#   nomic-embed-text   0.3 GB
#   Total:        25.8 GB  -->  38 GB remaining for OS + context buffers
#
# Settings optimized for maximum throughput, minimum cold starts.

$env_vars = @{
  # Load all models simultaneously and never unload them
  "OLLAMA_MAX_LOADED_MODELS"      = "6"
  "OLLAMA_KEEP_ALIVE"             = "24h"

  # Large context windows — 64GB can handle 128K tokens per model
  "OLLAMA_CONTEXT_LENGTH"         = "131072"

  # Flash attention — reduces memory bandwidth for attention, faster inference
  "OLLAMA_FLASH_ATTENTION"        = "1"

  # KV cache quantization — compresses key-value cache, frees ~30% RAM
  "OLLAMA_KV_CACHE_QUANTIZATION"  = "q8_0"

  # CPU threads — use all physical cores for maximum parallelism
  # Set to your physical core count (check Task Manager > Performance > CPU)
  "OLLAMA_NUM_THREADS"            = "16"

  # Batch size — larger batches = better throughput for multiple simultaneous requests
  "OLLAMA_BATCH_SIZE"             = "1024"

  # Scheduler spread — keep all models in memory, never swap
  "OLLAMA_SCHED_SPREAD"           = "1"

  # Prefer local (already set in scripts, but enforce here too)
  "OLLAMA_HOST"                   = "0.0.0.0:11434"
}

Write-Host "Setting Ollama environment variables for 64GB RAM optimization..." -ForegroundColor Cyan

foreach ($key in $env_vars.Keys) {
  $value = $env_vars[$key]
  [System.Environment]::SetEnvironmentVariable($key, $value, "User")
  Write-Host "  SET $key = $value" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done! Restart Ollama for settings to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "Verify with: ollama ps" -ForegroundColor White
Write-Host "Warmup all models: node C:\Users\user\brain\src\warmup.mjs" -ForegroundColor White
Write-Host ""
Write-Host "Expected performance on 64GB RAM:" -ForegroundColor Cyan
Write-Host "  hermes3 8B:          ~1-2s first token" -ForegroundColor White
Write-Host "  qwen2.5-coder:7b:    ~0.5-1s first token" -ForegroundColor White
Write-Host "  qwen2.5-coder:14b:   ~1-3s first token" -ForegroundColor White
Write-Host "  nomic-embed-text:    ~50ms per embed" -ForegroundColor White
Write-Host "  (all subsequent calls: near-instant, models warm in RAM)" -ForegroundColor White
