param(
    [switch]$NoExtensionDevelopmentHost,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$codeCommand = Get-Command code -ErrorAction SilentlyContinue
$codePath = $null

if ($codeCommand) {
    $codePath = $codeCommand.Source
} else {
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"
    if (Test-Path -LiteralPath $fallback) {
        $codePath = $fallback
    }
}

if (-not $codePath) {
    throw "VS Code executable was not found. Install the 'code' command in PATH or verify Code.exe exists under LOCALAPPDATA."
}

$arguments = @("--new-window")
if (-not $NoExtensionDevelopmentHost) {
    $arguments += "--extensionDevelopmentPath=$repoRoot\src"
}
$arguments += $repoRoot

Write-Host "VS Code executable: $codePath"
Write-Host "Arguments: $($arguments -join ' ')"

if ($WhatIf) {
    Write-Host "WhatIf: launch skipped."
    exit 0
}

Start-Process -FilePath $codePath -ArgumentList $arguments
Write-Host "Launched VS Code GUI. If this is a webview test, continue with .kilo/command/test-webview.md."
