---
name: ide-vscode-parity
description: Close feature gaps between the Cloud IDE Terminal and VS Code webview. Use when adding Monaco Editor, IntelliSense, error diagnostics, auto-fix, multi-cursor, breadcrumbs, minimap, settings UI, or extensions panel to the cloud dashboard.
---

# IDE VS Code Parity Skill

Close feature gaps between the Cloud IDE Terminal and VS Code webview.

## Gap Matrix

| Priority | Feature | VS Code Webview | Cloud IDE | Status |
|----------|---------|----------------|-----------|--------|
| HIGH | Monaco Editor | Full Monaco with LSP | Basic `<div>` with regex highlight | ⬜ |
| HIGH | Error Diagnostics | Red squiggles, Problems panel | None | ⬜ |
| HIGH | IntelliSense | Code completion, hover info | Command autocomplete only | ⬜ |
| MEDIUM | Auto-fix | Quick-fix lightbulb | None | ⬜ |
| MEDIUM | Multi-cursor | Alt+click multiple cursors | None | ⬜ |
| LOW | Breadcrumbs | File path navigation | None | ⬜ |
| LOW | Minimap | Code overview scrollbar | None | ⬜ |
| LOW | Settings UI | Full settings editor | None | ⬜ |
| LOW | Extensions Panel | Browse/install extensions | None | ⬜ |

## Implementation Order

### Phase A: Monaco Editor Integration (FOUNDATION)
- Install `@monaco-editor/react` and `monaco-editor`
- Replace `CodeEditor.tsx` with Monaco wrapper
- Configure dark theme matching dashboard
- Wire file open/save through Monaco API
- Language detection from file extension

**Monaco gives FREE**: syntax highlighting, error squiggles, IntelliSense, multi-cursor, minimap, breadcrumbs, find/replace, code folding, bracket matching

### Phase B: LSP Bridge
- Install `vscode-languageserver-protocol`
- Create `cloud/api/lsp-bridge.js`
- Spawn `typescript-language-server` for TS/JS
- Spawn `pylsp` or `pyright-langserver` for Python
- Pipe LSP over WebSocket: Monaco ↔ API server ↔ Language Server

### Phase C: Problems Panel
- Create `ProblemsPanel.tsx`
- Subscribe to Monaco `onDidChangeMarkers`
- Group markers by file/severity
- Click to jump to line
- Toggle with Ctrl+Shift+M

### Phase D: Auto-fix / Quick Fix
- Monaco CodeActions via LSP
- `codeActionOnSave` in Monaco
- Keyboard shortcut: Ctrl+.
- AI auto-fix: send error + code to AI → apply suggestion

### Phase E: Settings UI
- Create `SettingsPanel.tsx` — two-pane layout
- Read from `localStorage` + API
- Categories: Editor, Terminal, AI, Git
- Input types: toggle, number, string, dropdown, color picker
- Auto-save on change

### Phase F: Extensions Panel
- Create `ExtensionsPanel.tsx`
- Extension manifest format (VS Code-compatible subset)
- Install via API (download + unzip to `~/.superroo/extensions/`)
- Dynamic loading in dashboard
- Support commands, views, keybindings

## Files

```
cloud/dashboard/package.json                    # add @monaco-editor/react
cloud/dashboard/src/components/ide-terminal/
  MonacoEditor.tsx                              # Monaco wrapper
  ProblemsPanel.tsx                             # Diagnostics panel
  SettingsPanel.tsx                             # Settings editor
  ExtensionsPanel.tsx                           # Extensions browser
cloud/api/
  lsp-bridge.js                                 # LSP ↔ WebSocket bridge
  lsp/typescript.js                             # TypeScript LSP config
  lsp/python.js                                 # Python LSP config
```

## Monaco Configuration

```typescript
// Dark theme matching dashboard
editorOptions={{
  theme: 'vs-dark',
  fontSize: 13,
  fontFamily: 'JetBrains Mono, monospace',
  minimap: { enabled: true },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'all',
  bracketPairColorization: { enabled: true },
}}
```
