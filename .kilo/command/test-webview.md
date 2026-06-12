---
description: Launch VS Code GUI and run webview verification from Kilo
agent: debugger
---

# Test VS Code Webview

Use this command when debugging the SuperRoo VS Code webview. Kilo must launch the VS Code GUI first when running on this Windows desktop.

- Direct VS Code GUI launch from the terminal on Windows.
- Manual Extension Development Host inspection after the window opens.
- Terminal e2e verification only after GUI launch is unavailable or insufficient.

## Required Context

1. Read `docs/logs/superroo-extension-fixes.md` before starting.
2. Check `ACTIVE_WORK.md` for parallel extension/webview work.
3. Register lesson intent with Central Brain before substantial debugging.

## Direct VS Code GUI Launch Protocol

Kilo Code must not answer "I cannot run VS Code directly" on this machine before trying the commands below.

From the repo root, first verify the VS Code CLI exists:

```powershell
Get-Command code
```

Then launch the visible VS Code GUI:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launch-kilo-code-gui.ps1
```

If the script is unavailable, run the direct command:

```powershell
Start-Process -FilePath "code" -ArgumentList @("--new-window", "--extensionDevelopmentPath=$PWD\src", "$PWD")
```

If `code` is not on PATH, try the standard Windows install path:

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" -ArgumentList @("--new-window", "--extensionDevelopmentPath=$PWD\src", "$PWD")
```

Only after all launch attempts fail may Kilo say it cannot open the VS Code GUI from the current environment. If the GUI opens, continue with the checklist below.

## Manual Extension Development Host Checklist

After Kilo launches VS Code, guide the user through this exact checklist and ask them to report the evidence back.

### 1. Launch Extension In Debug Mode

In the launched VS Code window:

```text
Press F5
```

Or run:

```text
Debug: Start Debugging
```

This opens a new Extension Development Host window using `.vscode/launch.json` configuration `Run Extension`.

Kilo should already have attempted to open this window using the Direct VS Code GUI Launch Protocol. Kilo still cannot reliably click inside the GUI from a pure terminal; the human performs the visual DevTools checks after the window is open.

### 2. Open SuperRoo Sidebar

In the Extension Development Host:

```text
Click the SuperRoo icon in the Activity Bar
```

Or run:

```text
View: Show SuperRoo
```

### 3. Check Developer Tools Console

Open:

```text
Help > Toggle Developer Tools
```

Or:

```text
Ctrl+Shift+I
```

In the Console tab, look for:

```text
[App] Sending webviewDidLaunch message
[ExtensionStateContext.handleMessage] Received message: state
[ExtensionStateContext] didHydrateState set to true
[App] didHydrateState: true, showWelcome: false
```

### 4. Check Extension Output Channel

Open:

```text
View > Output
```

Select:

```text
SuperRoo
```

Look for:

```text
[getHtmlContent] extensionPath: ...
[getHtmlContent] Found index.html at: ...
[resolveWebviewView] HTML generated, length=...
[webviewDidLaunch] Received webviewDidLaunch message
[postStateToWebview] View exists: true
```

### 5. Check Network Tab

In Developer Tools, open the Network tab and verify:

```text
index.js status 200
index.css status 200
```

### 6. Report Back

Ask for the report in this format:

```markdown
## Webview Console Logs
- [paste logs or say missing]

## SuperRoo Output Channel
- [paste logs or say missing]

## Network
- index.js: [status/error]
- index.css: [status/error]
- Other errors: [none/list]
```

## Terminal E2E Test Ladder

Run the smallest useful check first:

```bash
cd webview-ui && npx vitest run
```

Then run the VS Code extension webview smoke test:

```bash
pnpm --filter @superroo/vscode-e2e test:run -- --grep "Webview Rendering"
```

For a narrower file-level e2e run:

```bash
pnpm --filter @superroo/vscode-e2e test:run -- --file webview-rendering.test.js
```

## Evidence

After each run, inspect:

```text
apps/vscode-e2e/.vscode-test/user-data/logs/
apps/vscode-e2e/out/suite/webview-rendering.test.js
```

If the test starts VS Code but the webview still looks suspicious, create or run an e2e test that writes screenshot/log artifacts, then analyze screenshots through the vision agent.

## Rule

Never answer "I cannot run VS Code directly" until the Direct VS Code GUI Launch Protocol has failed. Never answer "I cannot test the webview because I am CLI-only" until the GUI launch and e2e path have both failed and the generated logs have been inspected.
