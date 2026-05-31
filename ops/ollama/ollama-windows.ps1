# =============================================================================
# SuperRoo — Ollama Windows PowerShell Configuration Script
# =============================================================================

# System information detection
$PhysicalCores = (Get-CimInstance -ClassName Win32_Processor | Select-Object -ExpandProperty NumberOfCores | Measure-Object -Sum).Sum
$LogicalCores = (Get-CimInstance -ClassName Win32_Processor | Select-Object -ExpandProperty NumberOfLogicalProcessors | Measure-Object -Sum).Sum
$TotalRAM = (Get-CimInstance -ClassName Win32_PhysicalMemory | Select-Object -ExpandProperty Capacity | Measure-Object -Sum).Sum / 1GB

Write-Host "Detected System Configuration:"
Write-Host "  Physical Cores: $PhysicalCores"
Write-Host "  Logical Cores: $LogicalCores"
Write-Host "  Total RAM: $TotalRAM GB"

# Calculate optimal settings
$OptimalThreads = [Math]::Min([Math]::Floor($PhysicalCores), 16)
$MaxLoadedModels = [Math]::Max([Math]::Floor(($TotalRAM - 8) / 8), 3)

# Apply environment variables
[Environment]::SetEnvironmentVariable("OLLAMA_NUM_THREADS", $OptimalThreads, "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_MAX_LOADED_MODELS", $MaxLoadedModels, "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "65536", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "1", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_KV_CACHE_QUANTIZATION", "8bit", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_GPU", "1", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_NUMA", "1", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_BATCH_SIZE", "512", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_MAX_QUEUE", "512", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "1h", "Machine")

Write-Host "`nApplied Ollama optimizations:"
Write-Host "  OLLAMA_NUM_THREADS: $OptimalThreads"
Write-Host "  OLLAMA_MAX_LOADED_MODELS: $MaxLoadedModels"
Write-Host "  OLLAMA_CONTEXT_LENGTH: 65536"
Write-Host "  OLLAMA_FLASH_ATTENTION: 1"
Write-Host "  OLLAMA_KV_CACHE_QUANTIZATION: 8bit"
Write-Host "`nRestart Ollama service for changes to take effect: Restart-Service ollama"

# Model context configuration (for reference)
Write-Host "`nSuggested Modelfile for 64K context:"
Write-Host "  FROM nomic-embed-text"
Write-Host "  PARAMETER num_ctx 65536"
Write-Host "  PARAMETER num_batch 512"