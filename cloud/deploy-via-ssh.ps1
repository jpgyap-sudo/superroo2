# deploy-via-ssh.ps1 - Run a command on VPS with timeout
param(
    [Parameter(Mandatory=$true)]
    [string]$Command,
    [int]$TimeoutSeconds = 30,
    [string]$RemoteHost = "root@100.64.175.88"
)

$sshArgs = @(
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=10",
    "-o", "ServerAliveCountMax=2",
    "-o", "StrictHostKeyChecking=no",
    $RemoteHost,
    $Command
)

$outFile = "$env:TEMP\ssh_deploy_out.txt"
$errFile = "$env:TEMP\ssh_deploy_err.txt"

Write-Output "SSH: Connecting to $RemoteHost..."
Write-Output "SSH: Command: $Command"
Write-Output "SSH: Timeout: ${TimeoutSeconds}s"

$proc = Start-Process -NoNewWindow -PassThru `
    -FilePath "ssh" `
    -ArgumentList $sshArgs `
    -RedirectStandardOutput $outFile `
    -RedirectStandardError $errFile

if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    Write-Output "SSH_TIMEOUT: Command did not complete within ${TimeoutSeconds}s"
    $proc.Kill()
    exit 1
}

Write-Output "SSH_DONE (exit code: $($proc.ExitCode))"
Write-Output "=== STDOUT ==="
Get-Content $outFile
Write-Output "=== STDERR ==="
Get-Content $errFile
exit $proc.ExitCode
