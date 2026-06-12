---
description: Open the Kilo Code/SuperRoo VS Code GUI from terminal
agent: debugger
---

# Launch Kilo Code GUI

Use this command when Kilo says it cannot run VS Code directly.

## Rule

On this Windows desktop, Kilo must attempt to launch a visible VS Code GUI before claiming a CLI-only blocker.

## Command

Run from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launch-kilo-code-gui.ps1
```

If the script cannot run, use:

```powershell
Start-Process -FilePath "code" -ArgumentList @("--new-window", "$PWD")
```

For SuperRoo extension webview debugging, use the development host form:

```powershell
Start-Process -FilePath "code" -ArgumentList @("--new-window", "--extensionDevelopmentPath=$PWD\src", "$PWD")
```

If `code` is not on PATH, try:

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" -ArgumentList @("--new-window", "--extensionDevelopmentPath=$PWD\src", "$PWD")
```

After the GUI opens, continue in `.kilo/command/test-webview.md`.
