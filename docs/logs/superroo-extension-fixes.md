# SuperRoo Extension Fix Log

**Purpose:** Centralized record of fixes attempted for the SuperRoo VS Code extension webview issue.  
**Status:** Extension webview renders black/blank.  
**Last updated:** 2026-06-06

---

## How to Use This Log

- **Every coding agent** that attempts a fix MUST append an entry to this file.
- Entries should be timestamped and attributed to the agent/model that made the change.
- Include: what was changed, why, what was tested, and the result.
- Do NOT delete or overwrite previous entries. Only append.

---

## Current Symptom

- VS Code extension activates without errors.
- Sidebar/Tab webview opens but shows a **black/blank screen**.
- No visible React UI renders.
- Console/webview devtools likely show runtime or CSP errors (not yet confirmed).

---

## Verified Facts (as of 2026-06-06)

- `webview-ui` builds successfully (`pnpm --filter @superroo/vscode-webview build`).
- `webview-ui` type-checks clean (`tsc` in `webview-ui` passes).
- Extension bundle succeeds (`pnpm bundle` in `src`).
- Built assets exist at `src/webview-ui/build/assets/index.js` (~5.6 MB) and `index.css` (~164 KB).
- `src/webview-ui/build/index.html` exists and references `/assets/index.js` and `/assets/index.css`.
- `ClineProvider.getHtmlContent()` reads `src/webview-ui/build/index.html`, extracts asset paths, and serves them via `webview.asWebviewUri(...)`.
- `ClineProvider.resolveWebviewView()` sets `webviewView.webview.html` and logs the generated HTML preview.
- `webviewMessageHandler.ts` now handles `superRoo:get*` messages with fallback empty payloads.
- `AdvancedVpsSettingsTab.tsx` had corrupted JSX at the top (`;(() => {` block merged with imports). This was repaired.
- ESLint in `webview-ui` shows only warnings (no errors), but fails due to `--max-warnings=0`.
- No syntax errors or parse failures found in `webview-ui/src`.
- All required assets now present in `dist/assets/` (codicons, images, vscode-material-icons).
- TypeScript error in `Task.ts` line 1658 (mcpHub access) is fixed.

---

## Fix Attempts

### 1. Add fallback handlers for `superRoo:get*` webview messages
- **Date:** 2026-06-05
- **Agent:** Kilo (auto)
- **File changed:** `src/core/webview/webviewMessageHandler.ts`
- **What was changed:** Added `case` handlers for `superRoo:getDashboard`, `superRoo:getFeatures`, `superRoo:getBugs`, `superRoo:getEvents`, `superRoo:getTasks`, `superRoo:getProviders`, `superRoo:getFullSettings`, `superRoo:getRoutes`. Each returns a safe empty/default payload so the webview does not hang waiting for a response.
- **Why:** The dashboard was sending these messages but the extension host had no handlers, causing the webview to stall during initialization.
- **Tested:** Build succeeds; type-check passes; no runtime test available yet.
- **Result:** Did NOT fix the black screen. Webview still blank.
- **Next:** Investigate whether the webview is actually loading the bundle at all (CSP, path, or runtime error).

---

### 2. Repair corrupted `AdvancedVpsSettingsTab.tsx`
- **Date:** 2026-06-05
- **Agent:** Kilo (auto)
- **File changed:** `webview-ui/src/components/super-roo/tabs/settings/AdvancedVpsSettingsTab.tsx`
- **What was changed:** Removed broken top-level JSX/IIFE block (`;(() => { ... })()`) that was merged with imports. Restored valid React component structure with proper imports at the top.
- **Why:** The file was syntactically invalid and would crash the webview UI during module load.
- **Tested:** `webview-ui` build succeeds after fix.
- **Result:** Did NOT fix the black screen. Likely not the only broken file, but this one was definitely broken.
- **Next:** Scan all `webview-ui/src` for similar corruption patterns.

### 3. Copy webview build into extension dist during bundling
- **Date:** 2026-06-05
- **Agent:** Kilo (auto)
- **File changed:** `src/esbuild.mjs`, `packages/build/src/esbuild.ts`, `packages/build/src/index.ts`
- **What was changed:** Added `copyDir` and `rmDir` exports from `@superroo/build`, then updated the `copyFiles` esbuild plugin to copy `src/webview-ui/build` into `dist/webview-ui/build` during bundling.
- **Why:** The extension was looking for webview assets at `webview-ui/build` relative to the extension root, but the bundle wasn't copying them into `dist`. This caused the webview to fail loading assets.
- **Tested:** `pnpm --dir src bundle` succeeds and logs "Copied 632 webview build files". `dist/webview-ui/build/assets` contains the full bundle.
- **Result:** Assets now correctly bundled. Webview should be able to load the React app.
- **Next:** Run the extension in VS Code to verify the webview renders.

### 4. Fix Task.ts mcpHub access error
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/core/task/Task.ts`
- **What was changed:** Changed `this.providerRef.deref()?.mcpHub` to `this.providerRef.deref()?.getMcpHub()` on line 1658.
- **Why:** The `mcpHub` property is `protected` in `ClineProvider`, but `Task.ts` was accessing it directly. The public `getMcpHub()` method exists for this purpose.
- **Tested:** TypeScript compilation passes for this file.
- **Result:** Type error resolved.

### 5. Fix esbuild.mjs to copy codicons and images assets to dist
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/esbuild.mjs`
- **What was changed:** Added `["assets/codicons", "dist/assets/codicons"]` and `["assets/images", "dist/assets/images"]` to the `copyPaths` array. Also fixed destination paths to use `dist/` prefix for all files.
- **Why:** The `getHtmlContent()` method in `ClineProvider.ts` references `assets/codicons/codicon.css` and `assets/images` via `getUri()`, but these were not being copied to the dist folder during bundling. This would cause 404 errors when the webview tries to load these resources.
- **Tested:** `pnpm --dir src bundle` now logs "Copied 2 files from assets/codicons to dist/assets/codicons" and "Copied 4 files from assets/images to dist/assets/images".
- **Result:** All required assets now present in `dist/assets/`.

### 6. Fix agents/index.ts type re-exports
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/super-roo/agents/index.ts`
- **What was changed:** Changed `export { RooTaskRunner }` to `export type { RooTaskRunner }` and similarly for `TestRunner` and `SupabaseRunner` since they are interfaces, not runtime values.
- **Why:** TypeScript's `isolatedModules` mode requires `export type` for type-only re-exports.
- **Tested:** TypeScript compilation passes for this file.
- **Result:** Type error resolved.

### 7. Fix HermesAgent.ts return type compatibility
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/super-roo/agents/HermesAgent.ts`
- **What was changed:** Changed `data: response` to `data: response as unknown as Record<string, unknown>` on line 145.
- **Why:** `AgentRunResult.data` expects `Record<string, unknown>` but `HermesResponse` is a specific interface.
- **Tested:** TypeScript compilation passes for this file.
- **Result:** Type error resolved.

### 8. Fix AgentBus.ts null safety for events
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/super-roo/parallel/AgentBus.ts`
- **What was changed:** Changed `this.events.error(...)` and `this.events.debug(...)` to `this.events?.error(...)` and `this.events?.debug(...)` on lines 244, 289, and 299.
- **Why:** The `events` property is `EventLog | null` and could be null if no EventLog was passed to the constructor.
- **Tested:** TypeScript compilation passes for this file.
- **Result:** Type error resolved.

### 9. Fix modelRouterTypes.ts missing "offline" capability
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/super-roo/settings/services/modelRouterTypes.ts`
- **What was changed:** Added `"offline"` to the `ModelCapability` type union.
- **Why:** The `modelRouterProviderRegistry.ts` uses `"offline"` in the capability map for ollama, but it wasn't defined in the type.
- **Tested:** TypeScript compilation passes for this file.
- **Result:** Type error resolved.

### 10. Fix InfiniteImprovementLoop.ts CodeSample type compatibility
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `src/super-roo/ml/loop/InfiniteImprovementLoop.ts`
- **What was changed:** 
  - Added explicit return type `CodeSample[]` to `extractCodeSamples` method
  - Changed `queueObservationsForSync` parameter type from inline to `CodeSample[]`
  - Added null coalescing for optional properties in `queueObservationsForSync`
- **Why:** The `loadBrainOutcomes()` returns samples with optional properties, but `queueObservationsForSync` expected required properties.
- **Tested:** TypeScript compilation passes for this file.
- **Result:** Type error resolved.

### 11. Add debug logging for webview hydration tracing
- **Date:** 2026-06-06
- **Agent:** Kilo
- **File changed:** `webview-ui/src/App.tsx`, `webview-ui/src/context/ExtensionStateContext.tsx`, `src/core/webview/webviewMessageHandler.ts`, `src/core/webview/ClineProvider.ts`
- **What was changed:** Added `console.debug` and `provider.log` statements to trace:
  - `webviewDidLaunch` message receipt
  - State being sent to webview
  - `didHydrateState` changes in the webview
- **Why:** To diagnose why the webview stays stuck on "Loading SuperRoo..." - need to verify if messages are being received and processed.
- **Tested:** Build succeeds.
- **Result:** Debug logs will appear in VS Code Developer Tools Console and Output channel when webview loads.

### 12. Add safety check for language change in TranslationProvider
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `webview-ui/src/i18n/TranslationContext.tsx`
- **What was changed:** Added check `if (extensionState.language)` before calling `i18n.changeLanguage()` to prevent errors when state is not yet hydrated.
- **Why:** The TranslationProvider calls `useExtensionState()` which requires the state to be hydrated. If the webview is still loading and `didHydrateState` is false, calling `changeLanguage(undefined)` could cause issues.
- **Tested:** Build succeeds.
- **Result:** Prevents potential runtime error during initial webview load.

### 13. Enhanced debug logging for webview message flow
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `src/core/webview/ClineProvider.ts`, `src/core/webview/webviewMessageHandler.ts`, `webview-ui/src/App.tsx`, `webview-ui/src/utils/vscode.ts`
- **What was changed:**
  - Added view existence check in `postStateToWebview()` before posting state
  - Added detailed logging in `postMessageToWebview()` to track message flow
  - Added logging in `webviewDidLaunch` handler to trace state sending
  - Added logging in `vscode.postMessage()` wrapper to trace outgoing messages
  - Added logging in App's webviewDidLaunch retry loop
  - Removed duplicate `webviewDidLaunch` message in ExtensionStateContext (was sending twice)
- **Why:** To trace the exact message flow and identify where the webview hydration is failing.
- **Tested:** Build succeeds.
- **Result:** Debug logs will show in VS Code Developer Tools Console and Output channel. Look for:
  - `[App] Sending webviewDidLaunch message`
  - `[webviewDidLaunch] Received webviewDidLaunch message`
  - `[postStateToWebview] View exists: true/false`
  - `[ExtensionStateContext] Received message: state`
  - `[App] didHydrateState: true/false`

### 14. Added extension path logging and fallback message listener
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `src/core/webview/ClineProvider.ts`, `webview-ui/src/App.tsx`
- **What was changed:**
  - Added logging for `extensionPath` and `extensionUri.fsPath` in `getHtmlContent()`
  - Added logging for script and CSS paths being resolved
  - Added fallback `window.addEventListener("message", ...)` in App.tsx to ensure messages are received
- **Why:** To verify the webview assets are being found at the correct paths, and to ensure message reception even if `useEvent` hook fails.
- **Tested:** Build succeeds.
- **Result:** Debug logs will show the exact paths being used to load webview assets.

### 15. Added multiple path resolution attempts for webview index.html
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `src/core/webview/ClineProvider.ts`
- **What was changed:** Added multiple possible paths to search for `index.html` since the extension path resolution may differ between development and production modes.
- **Why:** The extension might be looking for webview assets in the wrong location, causing the HTML generation to fail and fall back to HMR mode (which requires a running Vite server).

### 16. Fixed CSP strict-dynamic directive that may block module scripts
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `src/core/webview/ClineProvider.ts`
- **What was changed:** Removed `'strict-dynamic'` from the CSP `script-src` directive. The `'strict-dynamic'` keyword can interfere with module script loading in VS Code webviews.
- **Why:** Module scripts with nonces may not load correctly with `'strict-dynamic'` in the CSP.

### 17. Fixed watch:webview task package name
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `.vscode/tasks.json`
- **What was changed:** Changed `pnpm --filter @roo-code/vscode-webview dev` to `pnpm --filter @superroo/vscode-webview dev`
- **Why:** The package name was incorrect, which would prevent the Vite dev server from starting in watch mode.

### 18. Diagnostic script created
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `scripts/diagnose-webview.mjs`
- **What was changed:** Created diagnostic script to verify webview build files exist and extension has correct handlers.
- **Tested:** All files exist:
  - `index.html`: 371 bytes
  - `index.js`: 5664206 bytes
  - `index.css`: 164469 bytes
  - `extension.js`: 31694101 bytes
  - All webview handlers present in bundle
- **Result:** Bundle is correct. Issue must be runtime (CSP, message flow, or JS error).

### 19. Fixed HMR fallback to not show error when Vite server not running
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `src/core/webview/ClineProvider.ts`
- **What was changed:** Changed `vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))` to a console log when Vite dev server isn't running. The extension should silently fall back to bundled HTML instead of showing an error.
- **Why:** In development mode (F5), the Vite dev server might not be running, causing the webview to fail with an error message instead of using the bundled assets.

### 20. Created vscode mock for webview tests
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `webview-ui/__mocks__/vscode.ts`
- **What was changed:** Created vscode mock file with `acquireVsCodeApi` global and `getState`/`setState`/`postMessage` methods.
- **Why:** Tests were failing with `TypeError: vscode.getState is not a function` because the vscode mock was missing for webview tests.

### 21. Fixed incomplete vscode mocks in test files
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `webview-ui/src/components/welcome/__tests__/WelcomeViewProvider.spec.tsx`, `webview-ui/src/context/__tests__/ExtensionStateContext.roo-auth-gate.spec.tsx`, `webview-ui/src/components/chat/__tests__/ChatRow.diff-actions.spec.tsx`, `webview-ui/src/components/chat/__tests__/ChatView.keyboard-fix.spec.tsx`, `webview-ui/src/components/chat/__tests__/ChatView.notification-sound.spec.tsx`, `webview-ui/src/components/chat/__tests__/ChatView.preserve-images.spec.tsx`, `webview-ui/src/components/chat/__tests__/ChatView.scroll-debug-repro.spec.tsx`, `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`, `webview-ui/src/components/settings/__tests__/SettingsView.spec.tsx`
- **What was changed:** Added `getState: vi.fn(() => undefined)` and `setState: vi.fn()` to the `vi.mock("@src/utils/vscode", ...)` mocks in all failing test files. The mocks only had `postMessage` but `ExtensionStateContext.tsx` calls `vscode.getState()` on line 209 during initialization.
- **Why:** The `ExtensionStateContextProvider` component calls `vscode.getState()` to restore persisted state. Without this mock method, tests crashed with `TypeError: vscode.getState is not a function`.
- **Tested:** All 124 test files now pass (1332 tests passed, 8 skipped).
- **Result:** All webview tests now pass.

### 22. Fixed fs/promises import for sync methods in ClineProvider.ts
- **Date:** 2026-06-07
- **Agent:** Kilo
- **File changed:** `src/core/webview/ClineProvider.ts`
- **What was changed:** Changed `import * as fs from "fs/promises"` to separate `import * as fsPromises from "fs/promises"` and `import * as fsSync from "fs"`. Updated `fs.existsSync` to `fsSync.existsSync` and async `fs.readFile`/`fs.stat`/`fs.mkdir`/`fs.rm` to `fsPromises` equivalents. Removed unused `fileExistsAtPath` import.
- **Why:** The code was using `fs.existsSync` which doesn't exist on `fs/promises` module. TypeScript was failing with "Property 'existsSync' does not exist on type 'typeof import("fs/promises")'".
- **Tested:** TypeScript compilation passes for main extension code. Bundle completes successfully. All 124 webview test files pass.
- **Result:** Extension builds without errors.

### 23. Extension verified working on Extension Development Host
- **Date:** 2026-06-07
- **Agent:** User confirmation
- **What was changed:** N/A - verification step
- **Why:** To confirm the webview renders correctly after all fixes.
- **Tested:** Extension Development Host launched successfully, webview renders.
- **Result:** ✅ Webview is now working. The black/blank screen issue is resolved.

### 24. Fixed .vscodeignore to include webview-ui/build/index.html in packaged .vsix
- **Date:** 2026-06-07
- **Agent:** DeepSeek (Codex/Code mode)
- **File changed:** `src/.vscodeignore`, `src/core/webview/ClineProvider.ts`
- **What was changed:**
  - **`.vscodeignore`**: Added `!webview-ui/build/index.html` and `!webview-ui/build/sourcemap-manifest.json` patterns so these files are included in the packaged `.vsix`.
  - **`ClineProvider.ts` `getHtmlContent()`**:
    - Added `dist/webview-ui/build/` paths to `possiblePaths` array as fallback locations for packaged installs.
    - Replaced static `["webview-ui", "build"]` with dynamic `buildBasePathParts` computed from the actual discovered `index.html` location relative to `extensionUri.fsPath`.
    - All asset path resolutions (script, CSS absolute paths, and `getUri()` calls) now use `buildBasePathParts` instead of hardcoded `"webview-ui"/"build"` segments.
- **Why:** The `.vscodeignore` used `**` (exclude everything) then selectively included assets via `!webview-ui/build/assets/*.js`, `!webview-ui/build/assets/*.css`, etc. but the HTML entry point `index.html` was never explicitly included. When packaged as `.vsix`, `index.html` was stripped, causing the webview to fail silently. Additionally, the esbuild copy step places the webview build at `dist/webview-ui/build/` which is surfaced at root level in packaged installs via `!dist`. The `getHtmlContent()` path resolution only searched `webview-ui/build/` paths, not `dist/webview-ui/build/`.
- **Tested:** Verified `index.html` exists at both `src/webview-ui/build/` (for F5 dev) and `src/dist/webview-ui/build/` (for bundled output). Path resolution logic tested via code review — the dynamic `buildBasePathParts` computation handles both paths correctly.
- **Result:** ✅ `.vscodeignore` now includes `index.html` and `sourcemap-manifest.json`. `getHtmlContent()` now searches 5 paths (including `dist/webview-ui/build/` variants) and dynamically adapts asset URIs to match where `index.html` was found. Extension should now render webview correctly in both F5 dev mode and packaged `.vsix` installs.
- **Next:** Package a new `.vsix` (`cd src && pnpm vsix`), install it, and verify webview renders correctly in production mode. Also need to run existing tests to confirm no regressions.

---

## E2E Test Gap Identified

The VS Code extension E2E test suite (`apps/vscode-e2e/src/suite/`) has **no test that verifies webview rendering**. All tests focus on backend functionality (tasks, modes, tools) but none check that the webview loads and displays the React app.

Created `apps/vscode-e2e/src/suite/webview-rendering.test.ts` to fill this gap.

1. **Confirm webview runtime errors:**  
   Open the webview devtools (Help > Toggle Developer Tools) and inspect the Console/Network tabs.  
   - Is `index.js` loading?  
   - Any CSP violations?  
   - Any `Uncaught ReferenceError` or `SyntaxError`?

2. **Check CSP / script-src:**  
   `getHtmlContent()` sets `script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' ...`.  
   Verify the nonce matches and that no external script is blocked.

3. **Check `localResourceRoots`:**  
   Ensure `extensionUri` and workspace folders are correctly passed so `asWebviewUri()` can resolve files.

4. **Check `index.html` entry:**  
   The built `index.html` uses `/assets/index.js` (relative root). Confirm this resolves correctly inside the webview.

5. **Check for other corrupted files:**  
   Scan `webview-ui/src` for any files with broken top-level JSX or duplicate imports.

6. **Check extension host logs:**  
   Look at `View > Output` and select the extension's output channel for errors during `resolveWebviewView`.

---

## Template for New Entries

```markdown
### N. Short description of fix
- **Date:** YYYY-MM-DD
- **Agent:** Name/model
- **File changed:** path/to/file
- **What was changed:** ...
- **Why:** ...
- **Tested:** ...
- **Result:** ...
- **Next:** ...
```

---

## Related Files

- `src/core/webview/ClineProvider.ts` — webview provider, HTML generation, message routing
- `src/core/webview/webviewMessageHandler.ts` — handles messages from webview to extension
- `src/core/webview/getUri.ts` — URI helper for webview resources
- `webview-ui/src/App.tsx` — root webview React component
- `webview-ui/src/index.tsx` — webview entry point
- `webview-ui/src/components/super-roo/SuperRooDashboard.tsx` — SuperRoo dashboard component
- `webview-ui/src/components/super-roo/hooks/SrContext.tsx` — SuperRoo context/messaging
- `webview-ui/src/components/super-roo/messaging/client.ts` — webview message client
- `src/extension.ts` — extension activation and provider registration
- `src/esbuild.mjs` — extension bundling (now copies webview-ui build, codicons, images to dist)
- `webview-ui/package.json` — webview-ui workspace package
