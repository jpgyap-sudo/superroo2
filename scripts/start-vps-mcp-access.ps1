param(
	[string]$VpsIp = $env:SUPERROO_VPS_IP,
	[string]$SshUser = "root",
	[string]$SshKey = "C:\Users\User\.ssh\id_superroo_vps",
	[int]$OllamaPort = 11435,
	[int]$McpPort = 13419,
	[int]$DbPort = 15432,
	[int]$ApiPort = 0,        # API is now direct via Tailscale (100.64.175.88:8787) — no tunnel needed
	[switch]$Background,
	[switch]$Status
)

if (-not $VpsIp) {
	$VpsIp = "100.64.175.88"
}

$ErrorActionPreference = "Stop"
$target = "$SshUser@$VpsIp"

function Test-Port {
	param([int]$Port)
	try {
		$client = [System.Net.Sockets.TcpClient]::new()
		$iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
		$ok = $iar.AsyncWaitHandle.WaitOne(250)
		if ($ok -and $client.Connected) {
			$client.EndConnect($iar)
			$client.Close()
			return $true
		}
		$client.Close()
		return $false
	} catch {
		return $false
	}
}

function Show-Status {
	$rows = @(
		@{ Name = "Ollama"; Port = $OllamaPort; Url = "http://127.0.0.1:$OllamaPort/api/tags" },
		@{ Name = "MCP"; Port = $McpPort; Url = "http://127.0.0.1:$McpPort/mcp" },
		@{ Name = "PostgreSQL"; Port = $DbPort; Url = "postgresql://superroo:superroo@localhost:$DbPort/superroo_brain" },
		@{ Name = "API"; Port = $ApiPort; Url = "http://127.0.0.1:$ApiPort/api/health" }
	)

	foreach ($row in $rows) {
		$state = if (Test-Port $row.Port) { "open" } else { "closed" }
		Write-Host ("{0,-10} {1,-6} {2}" -f $row.Name, $state, $row.Url)
	}
}

if ($Status) {
	Show-Status
	exit 0
}

if (-not (Test-Path -LiteralPath $SshKey)) {
	throw "SSH key not found: $SshKey"
}

$sshArgs = @(
	"-o", "StrictHostKeyChecking=no",
	"-o", "ConnectTimeout=15",
	"-o", "ServerAliveInterval=15",
	"-o", "ServerAliveCountMax=3",
	"-i", $SshKey,
	"-L", "${OllamaPort}:127.0.0.1:11434",
	"-L", "${McpPort}:127.0.0.1:3419",
	"-L", "${DbPort}:127.0.0.1:5432",
	# API is now direct via Tailscale — no tunnel needed for port 8787
	"-N",
	$target
)

Write-Host "Opening SuperRoo VPS MCP tunnel via Tailscale: $target"
Write-Host "  Ollama     http://127.0.0.1:$OllamaPort"
Write-Host "  MCP        http://127.0.0.1:$McpPort/mcp"
Write-Host "  PostgreSQL postgresql://superroo:superroo@localhost:$DbPort/superroo_brain"
Write-Host "  API        http://127.0.0.1:$ApiPort/api"
Write-Host ""

if ($Background) {
	$argList = ($sshArgs | ForEach-Object {
		if ($_ -match "\s") { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
	}) -join " "
	Start-Process -FilePath "ssh" -ArgumentList $argList -WindowStyle Hidden
	Start-Sleep -Seconds 2
	Show-Status
} else {
	Write-Host "Press Ctrl+C to close the tunnel."
	& ssh @sshArgs
}
