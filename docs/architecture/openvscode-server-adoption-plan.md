# OpenVSCode Server Adoption Plan — SuperRoo Cloud IDE Evolution

**Date**: 2026-05-21
**Status**: Analysis Complete — Ready for Phase 0 Decision
**Replaces/Complements**: [`theia-adoption-plan.md`](./theia-adoption-plan.md)

---

## Executive Summary

After studying [gitpod-io/openvscode-server](https://github.com/gitpod-io/openvscode-server) and SuperRoo's current cloud IDE architecture, **openvscode-server is the superior adoption target** compared to Eclipse Theia or continued custom Monaco development.

**Why openvscode-server wins:**
- It is **VS Code:OSS + minimal server patches** — identical API to your existing VS Code extension (`apps/vscode-nightly/`)
- **Lower maintenance** than Theia (no InversifyJS DI, no plugin system complexity)
- **OpenVSX marketplace** gives you extensions for free (Git, Docker, Python, ESLint, Prettier, etc.)
- **Your existing `packages/vscode-shim/` works out of the box**
- **Native terminal, file explorer, source control, debugger** — none of which you have to build or maintain
- **Connection-token auth** built-in — replaces your custom auth middleware

**Current pain this solves:**
- Your dashboard IDE (`cloud/dashboard/src/components/ide-terminal/`) is 1,000+ lines of custom React + Monaco + LSP bridge that will *never* catch up to VS Code parity
- Your mini-IDE (`cloud/mini-ide/`) is a separate Express server with vanilla JS that duplicates file-system logic
- You are maintaining **two IDEs** (dashboard + mini) that both lack basic VS Code features (extensions, debugger, settings UI, SCM)

---

## 1. What openvscode-server Provides (That We Lack)

| Feature | openvscode-server | SuperRoo Dashboard IDE | SuperRoo Mini IDE |
|---------|-------------------|----------------------|-------------------|
| **Editor** | Full VS Code (Monaco + LSP + DAP) | Monaco + custom LSP bridge | Monaco CDN |
| **File Explorer** | Native (tree, drag-drop, multi-select) | Custom React FileTree | Custom JS file list |
| **Terminal** | Integrated xterm.js + PTY | Custom TerminalPanel | Basic WS output |
| **Extensions** | OpenVSX marketplace | None (ExtensionsPanel is UI-only) | None |
| **Git/SCM** | Native source control | GitPanel (partial) | None |
| **Debugger** | Full DAP support | None | None |
| **Settings UI** | Native settings editor | SettingsPanel (partial) | None |
| **Search** | Native (workspace, symbol, regex) | SearchPanel (partial) | None |
| **Auth** | `--connection-token` | Custom middleware | Telegram initData only |
| **Multi-workspace** | Native | Custom workspace switcher | Demo workspaces |
| **Keybindings** | Full VS Code keymap | Partial shortcuts | None |
| **Theme** | Full theme support | Dark theme only | Dark theme only |

---

## 2. Architecture: Before vs After

### Before (Current)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SUPERROO CLOUD IDE (Current)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │   Dashboard  │     │   Mini IDE   │     │   VS Code    │                │
│  │   (Next.js)  │     │  (Express)   │     │  Extension   │                │
│  │              │     │              │     │  (desktop)   │                │
│  │ • Monaco     │     │ • Monaco CDN │     │              │                │
│  │ • Custom LSP │     │ • File CRUD  │     │ • Native API │                │
│  │ • AI Chat    │     │ • AI Panel   │     │ • SuperRoo   │                │
│  │ • Terminal   │     │ • Terminal   │     │   sidebar    │                │
│  │ • FileTree   │     │ • Brain      │     │              │                │
│  └──────┬───────┘     └──────┬───────┘     └──────────────┘                │
│         │                    │                                              │
│         ▼                    ▼                                              │
│  ┌─────────────────────────────────────┐                                   │
│  │        SuperRoo API (8787)          │                                   │
│  │  • File system proxy                │                                   │
│  │  • AI command routing               │                                   │
│  │  • LSP bridge (partial)             │                                   │
│  │  • Workspace management             │                                   │
│  └─────────────────────────────────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### After (Proposed)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SUPERROO CLOUD IDE (Proposed)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SuperRoo Dashboard (Next.js)                       │   │
│  │  ┌───────────────────────────────────────────────────────────────┐  │   │
│  │  │  Project Overview │ Agent Status │ Deploy Pipeline │ Launch IDE │  │   │
│  │  └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │  Embedded iframe OR tab link to OpenVSCode Server            │    │   │
│  │  │  (with SuperRoo extension pre-installed)                     │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│  ┌───────────────────────────┼─────────────────────────────────────────┐   │
│  │                           ▼                                         │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │              OpenVSCode Server (port 3000)                   │   │   │
│  │  │  • Full VS Code:OSS in browser                               │   │   │
│  │  │  • SuperRoo Extension (AI chat, brain, deploy)               │   │   │
│  │  │  • OpenVSX extensions (Git, Docker, Python, etc.)            │   │   │
│  │  │  • Native terminal, debugger, settings, SCM                  │   │   │
│  │  │  • Connection-token auth                                     │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                      │   │
│  │                              ▼                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │              SuperRoo API Server (8787)                      │   │   │
│  │  │  • Agent orchestration │ Memory │ Deploy │ Sandbox           │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              Telegram Mini IDE (kept lightweight)                     │   │
│  │  • File CRUD via API (same backend)                                 │   │
│  │  • AI command panel                                                 │   │
│  │  • Can OPTIONALLY embed a read-only VS Code webview                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Specific Adaptations from openvscode-server

### 3.1 Container Deployment Model

**Adapt their Docker pattern:**

```dockerfile
# cloud/docker/Dockerfile.vscode-server
FROM gitpod/openvscode-server:latest

USER root

# Install Node.js 20, Python 3.12, Go 1.22, Rust (match your sandbox images)
RUN apt-get update && apt-get install -y \
    curl git build-essential python3 python3-pip golang rustc \
    && rm -rf /var/lib/apt/lists/*

# Install SuperRoo VS Code extension from your nightly build
COPY bin/superroo-3.53.3.vsix /tmp/superroo.vsix
RUN /home/.openvscode-server/bin/openvscode-server \
    --install-extension /tmp/superroo.vsix

# Pre-install useful OpenVSX extensions
ENV OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"
ENV OPENVSCODE="${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server"
RUN \
    exts=(\
        ms-python.python \
        esbenp.prettier-vscode \
        dbaeumer.vscode-eslint \
        bradlc.vscode-tailwindcss \
        eamodio.gitlens \
    ) && \
    for ext in "${exts[@]}"; do ${OPENVSCODE} --install-extension "${ext}"; done

USER openvscode-server

# Start with connection token from env, host 0.0.0.0, and workspace mount
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exec ${OPENVSCODE} --host 0.0.0.0 --port 3000 --connection-token ${VSCODE_TOKEN:-$(openssl rand -hex 16)}"]
```

**Add to `cloud/docker/docker-compose.yml`:**

```yaml
  # ---------------------------------------------------------------------------
  # OpenVSCode Server (Full IDE)
  # ---------------------------------------------------------------------------
  superroo-vscode:
    build:
      context: ../..
      dockerfile: cloud/docker/Dockerfile.vscode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - VSCODE_TOKEN=${VSCODE_CONNECTION_TOKEN}
      - SUPERROO_API_URL=http://superroo-api:8787
      - SUPERROO_API_KEY=${SUPERROO_API_KEY}
    volumes:
      - workspaces:/home/workspace:cached
      - superroo-extensions:/home/.openvscode-server/extensions
      - logs:/home/workspace/logs
    mem_limit: 512m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    networks:
      - superroo-net
```

### 3.2 Security: Connection Token + SSO Bridge

openvscode-server uses `--connection-token` or `--connection-token-file` for basic auth. **Adapt this to integrate with your existing auth:**

```javascript
// cloud/api/routes/vscode-auth.js
// Bridge between SuperRoo auth and VS Code connection tokens

const crypto = require('crypto');
const tokenCache = new Map(); // userId -> { token, expiresAt }

function generateVscodeToken(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    tokenCache.set(userId, { token, expiresAt: Date.now() + 3600_000 });
    return token;
}

// Dashboard calls this after user login
app.post('/api/vscode/token', authenticate, (req, res) => {
    const token = generateVscodeToken(req.user.id);
    res.json({
        url: `https://ide.dev.abcx124.xyz/?tkn=${token}`,
        token,
        expiresIn: 3600
    });
});
```

Then the Dashboard iframe embeds:
```tsx
// cloud/dashboard/src/components/views/ide-terminal.tsx (simplified)
const { token } = await fetch('/api/vscode/token').then(r => r.json());
return (
    <iframe
        src={`https://ide.dev.abcx124.xyz/?tkn=${token}`}
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
    />
);
```

### 3.3 SuperRoo VS Code Extension: Cloud-Ready Mode

Your existing VS Code extension (`apps/vscode-nightly/`) already has the AI chat, Terminal Brain, and deploy features. **Add a "cloud mode" to it** so it detects when running inside openvscode-server and changes behavior:

```typescript
// apps/vscode-nightly/src/extension.ts (addition)

export function activate(context: vscode.ExtensionContext) {
    const isCloud = !!process.env.SUPERROO_API_URL;

    if (isCloud) {
        // Cloud mode: connect to SuperRoo API instead of local MCP
        const apiClient = new SuperRooApiClient(
            process.env.SUPERROO_API_URL!,
            process.env.SUPERROO_API_KEY
        );

        // Register cloud-specific commands
        context.subscriptions.push(
            vscode.commands.registerCommand('superroo.agentChat', () => {
                AgentChatPanel.createOrShow(context.extensionUri, apiClient);
            }),
            vscode.commands.registerCommand('superroo.deploy', () => {
                DeployPanel.createOrShow(context.extensionUri, apiClient);
            }),
            vscode.commands.registerCommand('superroo.terminalBrain', () => {
                TerminalBrainPanel.createOrShow(context.extensionUri, apiClient);
            })
        );

        // Add status bar item showing connected workspace
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBar.text = "$(rocket) SuperRoo Cloud";
        statusBar.tooltip = "Connected to SuperRoo Cloud Agents";
        statusBar.command = 'superroo.agentChat';
        statusBar.show();
        context.subscriptions.push(statusBar);
    } else {
        // Desktop mode: existing MCP-based behavior
        activateDesktopMode(context);
    }
}
```

### 3.4 File System Bridge: Workspaces as Volumes

openvscode-server mounts a workspace directory. **Your existing workspace API becomes a volume manager:**

```javascript
// cloud/api/routes/workspace-volume.js
// When a user selects a workspace, mount it as the VS Code workspace

const { execSync } = require('child_process');

app.post('/api/workspaces/:id/mount', async (req, res) => {
    const workspaceId = req.params.id;
    const hostPath = `/srv/superroo/workspaces/${workspaceId}`;

    // Ensure directory exists
    await fs.mkdir(hostPath, { recursive: true });

    // Restart VS Code container with this workspace mounted
    // (or use docker compose exec to symlink)
    execSync(`docker compose -f cloud/docker/docker-compose.yml exec superroo-vscode \
        ln -sf ${hostPath} /home/workspace/${workspaceId}`);

    res.json({
        workspaceId,
        vscodeUrl: `https://ide.dev.abcx124.xyz/?workspace=${workspaceId}`
    });
});
```

### 3.5 Terminal Brain as a VS Code Panel (Not a Custom React Component)

Instead of your custom `TerminalPanel.tsx` (200+ lines), the Terminal Brain becomes a **VS Code Webview Panel** inside the extension:

```typescript
// apps/vscode-nightly/src/panels/TerminalBrainPanel.ts
export class TerminalBrainPanel {
    public static createOrShow(extensionUri: Uri, api: SuperRooApiClient) {
        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined;

        const panel = window.createWebviewPanel(
            'superrooTerminalBrain',
            'Terminal Brain',
            column || ViewColumn.Two,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.webview.html = getTerminalBrainHtml(panel.webview, extensionUri);

        // Bridge webview messages to SuperRoo API
        panel.webview.onDidReceiveMessage(async msg => {
            switch (msg.type) {
                case 'brain:plan':
                    const plan = await api.brain.plan(msg.query);
                    panel.webview.postMessage({ type: 'plan:result', plan });
                    break;
                case 'brain:execute':
                    const result = await api.brain.execute(msg.command);
                    panel.webview.postMessage({ type: 'execute:result', result });
                    break;
                // ... etc
            }
        });
    }
}
```

This gives you:
- Native VS Code panel docking (left, right, bottom)
- Keyboard shortcuts to toggle
- Persistence across reloads
- No custom React/CSS to maintain

---

## 4. What to Keep, What to Replace, What to Migrate

### Keep (SuperRoo Differentiators)
| Component | Why Keep It |
|-----------|-------------|
| `cloud/api/api.js` | Agent orchestration, memory, deploy — core IP |
| `cloud/orchestrator/` | Sandbox, queue, deploy orchestrator |
| `cloud/dashboard/` | Project overview, agent status, deploy pipeline |
| `cloud/mini-ide/` | Telegram WebApp needs lightweight UI |
| `src/super-roo/agents/` | Agent logic is your core value |
| `apps/vscode-nightly/` | Convert to cloud+desktop dual-mode extension |

### Replace (With openvscode-server)
| Current | Replacement | Effort |
|---------|-------------|--------|
| `cloud/dashboard/src/components/ide-terminal/CodeEditor.tsx` | VS Code native editor | Zero (use iframe) |
| `cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx` | VS Code integrated terminal | Zero (native) |
| `cloud/dashboard/src/components/ide-terminal/FileTree.tsx` | VS Code explorer | Zero (native) |
| `cloud/dashboard/src/components/ide-terminal/SettingsPanel.tsx` | VS Code settings UI | Zero (native) |
| `cloud/dashboard/src/components/ide-terminal/ProblemsPanel.tsx` | VS Code problems panel | Zero (native) |
| `cloud/dashboard/src/components/ide-terminal/ExtensionsPanel.tsx` | OpenVSX marketplace | Zero (native) |
| `cloud/dashboard/src/components/ide-terminal/GitPanel.tsx` | VS Code source control | Zero (native) |
| Custom LSP bridge (`cloud/api/lsp-bridge.js`) | VS Code built-in LSP client | Zero (native) |
| `cloud/mini-ide/server.js` file CRUD | VS Code server file system | Low (redirect API) |

### Migrate (Into VS Code Extension)
| Feature | Migration Path |
|---------|---------------|
| AI Chat Panel (`AiChatPanel.tsx`) | VS Code Webview Panel in extension |
| Terminal Brain (`brain:*` APIs) | VS Code Webview Panel in extension |
| Deploy Pipeline UI | VS Code Webview Panel + Status Bar |
| Inline AI actions (selection menu) | VS Code Code Action Provider |
| Slash commands (`/fix`, `/deploy`) | VS Code Commands + Chat API |
| Workspace task sync | VS Code Tasks API |

---

## 5. Phased Implementation Plan

### Phase 0: Decision & Spike (2-3 days)
- [ ] Build `Dockerfile.vscode-server` and add to docker-compose
- [ ] Install your existing `.vsix` into openvscode-server container
- [ ] Verify extension loads and basic AI chat works
- [ ] Decision gate: continue or abort

### Phase 1: Coexistence (Week 1)
- [ ] Deploy openvscode-server alongside existing dashboard IDE
- [ ] Add "Open in VS Code" button to dashboard that generates connection token
- [ ] Keep existing IDE as fallback
- [ ] Collect usage metrics (which IDE users prefer)

### Phase 2: Extension Cloud Mode (Week 2-3)
- [ ] Add `isCloud` detection to `apps/vscode-nightly/`
- [ ] Build `SuperRooApiClient` class that talks to `cloud/api/api.js`
- [ ] Migrate AI Chat Panel to VS Code Webview
- [ ] Migrate Terminal Brain to VS Code Webview
- [ ] Add status bar integration for agent status

### Phase 3: Dashboard Simplification (Week 4)
- [ ] Replace dashboard IDE view with embedded openvscode-server iframe
- [ ] Remove `CodeEditor.tsx`, `TerminalPanel.tsx`, `FileTree.tsx`, etc.
- [ ] Dashboard becomes: Project Overview + Agent Status + Launch IDE button
- [ ] Redirect file CRUD in mini-IDE to VS Code server API

### Phase 4: Mini-IDE Strategy (Week 5)
- [ ] Option A: Keep mini-IDE lightweight for Telegram, but use VS Code server backend for files
- [ ] Option B: Embed a minimal VS Code webview in Telegram WebApp (if Telegram allows)
- [ ] Deprecate custom `cloud/mini-ide/server.js` file system code

### Phase 5: Cleanup (Week 6)
- [ ] Delete deprecated dashboard IDE components
- [ ] Remove custom LSP bridge (use VS Code native)
- [ ] Remove duplicate file system APIs
- [ ] Update documentation

---

## 6. Risk Assessment vs Theia

| Risk | openvscode-server | Theia | Custom Monaco |
|------|-------------------|-------|---------------|
| Maintenance burden | Low (Gitpod maintains patches) | High (DI framework, plugin system) | Very High (build everything) |
| Extension compatibility | High (VS Code API) | Medium (Theia plugin API) | None |
| Team learning curve | Low (everyone knows VS Code) | High (Theia-specific concepts) | Medium |
| Upgrade path | Easy (pull new Docker image) | Hard (rebuild Theia app) | Hard (upgrade Monaco + React) |
| Customization depth | Medium (extension API limits) | High (full framework) | Unlimited |
| Bundle size | ~200MB Docker image | ~300MB+ | ~50MB but incomplete |
| Startup time | ~3s | ~5s | ~2s |

**Verdict**: openvscode-server hits the sweet spot of "full VS Code experience" with "minimal maintenance." Theia is overkill for your use case. Custom Monaco is a treadmill you'll never get off.

---

## 7. Files to Create / Modify

### New Files
```
cloud/docker/Dockerfile.vscode-server          # VS Code server container
cloud/docker/docker-compose.vscode.yml         # Optional override compose
cloud/api/routes/vscode-auth.js                # Token bridge
apps/vscode-nightly/src/cloud/                 # Cloud mode modules
apps/vscode-nightly/src/cloud/SuperRooApiClient.ts
apps/vscode-nightly/src/panels/AgentChatPanel.ts
apps/vscode-nightly/src/panels/TerminalBrainPanel.ts
apps/vscode-nightly/src/panels/DeployPanel.ts
docs/architecture/openvscode-server-adoption-plan.md   # This file
```

### Modified Files
```
cloud/docker/docker-compose.yml                # Add superroo-vscode service
cloud/dashboard/src/components/views/ide-terminal.tsx   # Embed iframe
apps/vscode-nightly/src/extension.ts           # Add isCloud mode
apps/vscode-nightly/package.json               # Add cloud mode activation events
```

### Deprecated (Phase 5 deletion)
```
cloud/dashboard/src/components/ide-terminal/CodeEditor.tsx
cloud/dashboard/src/components/ide-terminal/MonacoEditor.tsx
cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx
cloud/dashboard/src/components/ide-terminal/FileTree.tsx
cloud/dashboard/src/components/ide-terminal/SettingsPanel.tsx
cloud/dashboard/src/components/ide-terminal/ProblemsPanel.tsx
cloud/dashboard/src/components/ide-terminal/ExtensionsPanel.tsx
cloud/dashboard/src/components/ide-terminal/GitPanel.tsx
cloud/dashboard/src/components/ide-terminal/SearchPanel.tsx
cloud/dashboard/src/components/ide-terminal/DiffViewModal.tsx
cloud/api/lsp-bridge.js                        # If exists
```

---

## 8. Immediate Next Steps

1. **Run the spike**:
   ```bash
   docker run -it --init -p 3000:3000 \
     -v "$(pwd):/home/workspace:cached" \
     gitpod/openvscode-server
   ```
   Visit `http://localhost:3000` and confirm it works.

2. **Install your extension**:
   ```bash
   docker exec <container> /home/.openvscode-server/bin/openvscode-server \
     --install-extension /home/workspace/bin/superroo-3.53.3.vsix
   ```
   Verify your SuperRoo sidebar appears.

3. **Decide**: If the spike works, proceed to Phase 1. If not, you haven't lost anything.

---

*This plan was generated after studying both the SuperRoo codebase and the openvscode-server repository. It complements (and likely supersedes) the Theia adoption plan by offering a faster path to VS Code parity with lower risk.*
