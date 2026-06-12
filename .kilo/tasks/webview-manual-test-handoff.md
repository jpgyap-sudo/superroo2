---
task: SuperRoo VS Code webview runtime verification
agent: Kilo Code
status: gui-launched-awaiting-manual-evidence
created: 2026-06-07T15:45:00+08:00
source: Codex persistence handoff
---

# SuperRoo Webview Manual Test Handoff

Kilo Code has launched the VS Code GUI. Awaiting manual Extension Development Host evidence.

## Current State

- ✅ VS Code GUI launched via `scripts/launch-kilo-code-gui.ps1`
- ✅ All 124 webview unit tests pass (1333 tests passed, 8 skipped)
- ✅ Extension builds successfully
- ⏳ Awaiting manual verification evidence from Extension Development Host

## Current State

- The SuperRoo VS Code extension code changes have already been made.
- The extension build succeeds.
- The webview unit test suite passes.
- The remaining gap is live runtime evidence from the VS Code Extension Development Host after Kilo launches VS Code.
- This is not a code-change task unless the manual evidence reveals a new runtime failure.

## Important Rule

Do not stop with: "I cannot run VS Code directly."

On this Windows desktop, Kilo must first try to launch the GUI from the terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launch-kilo-code-gui.ps1
```

If that fails, try:

```powershell
Start-Process -FilePath "code" -ArgumentList @("--new-window", "--extensionDevelopmentPath=$PWD\src", "$PWD")
```

If `code` is not on PATH, try:

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" -ArgumentList @("--new-window", "--extensionDevelopmentPath=$PWD\src", "$PWD")
```

Kilo can still proceed by guiding the human through the manual checklist and collecting evidence after the window opens. Kilo still cannot reliably click inside DevTools from a pure terminal, so the human may need to inspect DevTools and the sidebar.

## Next Human Action

After Kilo launches the VS Code GUI, ask the user to do this in the opened window:

1. Press `F5` to open the Extension Development Host.
2. In the Extension Development Host, open the SuperRoo sidebar.
3. Open `Help > Toggle Developer Tools`.
4. Check the Console tab.
5. Open `View > Output`, then select `SuperRoo`.
6. Check the Developer Tools Network tab for bundled assets.

## Evidence To Request

Ask the user to report:

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

## Expected Positive Signals

Console:

```text
[App] Sending webviewDidLaunch message
[ExtensionStateContext.handleMessage] Received message: state
[ExtensionStateContext] didHydrateState set to true
[App] didHydrateState: true, showWelcome: false
```

SuperRoo Output:

```text
[getHtmlContent] Found index.html at: ...
[resolveWebviewView] HTML generated, length=...
[webviewDidLaunch] Received webviewDidLaunch message
[postStateToWebview] View exists: true
```

Network:

```text
index.js status 200
index.css status 200
```

## If Manual Testing Is Not Available

Run the terminal fallback from `.kilo/command/test-webview.md`:

```bash
cd webview-ui && npx vitest run
pnpm --filter @superroo/vscode-e2e test:run -- --grep "Webview Rendering"
```

Then inspect:

```text
apps/vscode-e2e/.vscode-test/user-data/logs/
apps/vscode-e2e/out/suite/webview-rendering.test.js
```

## Completion Condition

Mark this task complete only when one of these is true:

- Manual evidence confirms the webview renders and hydrates.
- Manual evidence identifies a concrete runtime failure to fix.
- Terminal e2e evidence passes and the user accepts that as sufficient for now.
