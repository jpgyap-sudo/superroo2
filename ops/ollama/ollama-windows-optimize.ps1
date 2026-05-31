# Ollama 64GB RAM Optimization for Windows
# Run as Administrator once to set system-wide env vars
# Then restart Ollama service / app
#
# Usage: powershell -ExecutionPolicy Bypass -File ollama-windows-optimize.ps1

Write-Host "Configuring Ollama for 64GB RAM system..." -ForegroundColor Cyan

$settings = @{
    # Load all models simultaneously — 64GB has room for hermes3(4.3GB) + coder14b(8.4GB) + coder7b(4.4GB) + phi4(8.4GB) + nomic(0.3GB) = 25.8GB
    "OLLAMA_MAX_LOADED_MODELS"       = "5"

    # Huge context window — 64GB can hold 128K tokens in KV cache
    "OLLAMA_CONTEXT_LENGTH"          = "131072"

    # Flash attention — 2-3x faster attention computation
    "OLLAMA_FLASH_ATTENTION"         = "1"

    # KV cache quantization — halves KV cache memory, ~same quality
    "OLLAMA_KV_CACHE_QUANTIZATION"   = "q8_0"

    # Keep models loaded for 24 hours — no cold starts ever
    "OLLAMA_KEEP_ALIVE"              = "24h"

    # Batch size — larger = more throughput for concurrent requests
    "OLLAMA_BATCH_SIZE"              = "1024"

    # Number of threads — set to physical core count (not logical)
    # Change this to match your CPU's physical core count
    "OLLAMA_NUM_THREADS"             = "16"

    # Disable GPU offload for CPU-only systems (remove if you have a GPU)
    "OLLAMA_GPU"                     = "0"

    # Parallel request handling — serve multiple prompts concurrently
    "OLLAMA_NUM_PARALLEL"            = "4"

    # Max queue depth — how many requests can wait
    "OLLAMA_MAX_QUEUE"               = "128"

    # Scheduler spread — better latency when running multiple models
    "OLLAMA_SCHED_SPREAD"            = "1"
}

foreach ($key in $settings.Keys) {
    $value = $settings[$key]
    [System.Environment]::SetEnvironmentVariable($key, $value, "User")
    Write-Host "  SET $key = $value" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done! Restart Ollama for changes to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "Memory budget:" -ForegroundColor Cyan
Write-Host "  hermes3 8B Q4_0       : ~4.3 GB"
Write-Host "  qwen2.5-coder:14b     : ~8.4 GB"
Write-Host "  qwen2.5-coder:7b      : ~4.4 GB"
Write-Host "  phi4 14.7B            : ~8.4 GB"
Write-Host "  nomic-embed-text      : ~0.3 GB"
Write-Host "  KV cache (131072 ctx) : ~8.0 GB  (per active request)"
Write-Host "  ─────────────────────────────────"
Write-Host "  All models loaded     : ~25.8 GB"
Write-Host "  Available for OS/apps : ~38 GB"
Write-Host ""
Write-Host "With OLLAMA_KEEP_ALIVE=24h, models stay warm all day." -ForegroundColor Green
Write-Host "With OLLAMA_NUM_PARALLEL=4, up to 4 concurrent prompts." -ForegroundColor Green
