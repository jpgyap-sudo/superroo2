# SuperRoo UI Architecture

> **Purpose**: Reference document for the SuperRoo UI architecture across all three surfaces: Cloud Dashboard (Next.js), Telegram Bot, and Website (Next.js). Use this to understand wiring patterns, component hierarchy, and data flow before building or extending any UI feature.

---

## 1. Cloud Dashboard Architecture

### 1.1 Tech Stack

| Layer | Technology | Location |
|-------|-----------|----------|
| Framework | Next.js 14 (App Router) | `cloud/dashboard/` |
| Styling | Tailwind CSS | `cloud/dashboard/tailwind.config.ts` |
| Icons | lucide-react | Imported per-component |
| UI Primitives | Custom (`Card`, `Badge`, `StatCard`) | `cloud/dashboard/src/components/ui/` |
| State | React hooks (`useState`, `useCallback`, `useEffect`) | In each view |
| Data Fetching | `fetch()` + `useEffect` | In each view or `api.ts` |
| Real-time | WebSocket (`/api/ws/chat`, `/api/ws/lsp`) | `cloud/api/api.js` |
| Auth | JWT token in `localStorage` | `cloud/api/auth.js` |

### 1.2 Component Hierarchy

```
page.tsx (Dashboard)
├── Sidebar (sidebar.tsx)
│   └── NAV items → setPage(id)
├── View Area
│   ├── Overview (views/overview.tsx)
│   ├── Agents (views/agents.tsx)
│   ├── Telegram (views/telegram.tsx)
│   ├── IDE Terminal (views/ide-terminal.tsx)
│   │   ├── FileTree (ide-terminal/FileTree.tsx)
│   │   ├── CodeEditor (ide-terminal/CodeEditor.tsx → MonacoEditor.tsx)
│   │   ├── TerminalPanel (ide-terminal/TerminalPanel.tsx)
│   │   ├── AiChatPanel (ide-terminal/AiChatPanel.tsx)
│   │   ├── SearchPanel (ide-terminal/SearchPanel.tsx)
│   │   ├── GitPanel (ide-terminal/GitPanel.tsx)
│   │   ├── ProblemsPanel (ide-terminal/ProblemsPanel.tsx)
│   │   ├── SettingsPanel (ide-terminal/SettingsPanel.tsx)
│   │   ├── ExtensionsPanel (ide-terminal/ExtensionsPanel.tsx)
│   │   ├── DiffViewModal (ide-terminal/DiffViewModal.tsx)
│   │   ├── KeyboardShortcutsModal (ide-terminal/KeyboardShortcutsModal.tsx)
│   │   └── ErrorBoundary (ide-terminal/ErrorBoundary.tsx)
│   ├── Working Tree (views/working-tree.tsx)
│   ├── Jobs (views/jobs.tsx)
│   ├── Queue (views/queue.tsx)
│   ├── Projects (views/projects.tsx)
│   ├── Bugs (views/bugs.tsx)
│   ├── Healing (views/healing.tsx)
│   ├── Monitoring (views/monitoring.tsx)
│   ├── Logs (views/logs.tsx)
│   ├── Docker (views/docker.tsx)
│   ├── GitHub (views/github.tsx)
│   ├── Approvals (views/approvals.tsx)
│   ├── Model Router (views/model-router.tsx)
│   ├── API Keys (views/api-keys.tsx)
│   ├── Settings (views/settings.tsx)
│   ├── AI Assistant (views/ai-assistant.tsx)
│   ├── Skill Generator (views/skill-generator.tsx)
│   ├── Auto Deploy (views/auto-deploy.tsx)
│   └── Login (auth/login.tsx)
└── Status Bar (inline in page.tsx)
```

### 1.3 Wiring a New View (Checklist)

To add a new dashboard view, you MUST touch exactly these files:

```
1. cloud/dashboard/src/components/views/<name>.tsx     → Create view component
2. cloud/dashboard/src/components/sidebar.tsx           → Add nav entry
3. cloud/dashboard/src/app/page.tsx                     → Import + PAGES entry
4. cloud/api/api.js                                     → Add API endpoint (if needed)
```

### 1.4 Data Flow Patterns

**Pattern A: Simple fetch on mount**
```
View mounts → useEffect → fetch(/api/endpoint) → setState → render
```

**Pattern B: WebSocket real-time**
```
View mounts → useEffect → new WebSocket(/api/ws/...) → onmessage → setState → render
View unmounts → cleanup → ws.close()
```

**Pattern C: User action → API → refresh**
```
User clicks button → handleClick → fetch(POST /api/action) → re-fetch data → render
```

### 1.5 Styling Conventions

- **Background colors**: `bg-[#1e1e1e]` (main), `bg-[#252526]` (panels), `bg-[#2d2d2d]` (hover)
- **Border colors**: `border-[#3c3c3c]`
- **Text colors**: `text-gray-200` (primary), `text-gray-400` (secondary), `text-gray-500` (muted)
- **Accent**: `text-blue-400` (links), `bg-blue-600` (buttons)
- **Success/Error**: `text-green-400`/`text-red-400`, `bg-green-600`/`bg-red-600`
- **Cards**: `<Card className="p-4 bg-[#252526] border border-[#3c3c3c] rounded-lg">`
- **Badges**: `<Badge className="bg-blue-600/20 text-blue-300">`

### 1.6 API Route Patterns

All API routes in [`cloud/api/api.js`](cloud/api/api.js) follow this pattern:

```javascript
// ── Feature Name ──────────────────────────────────────────────────────────
else if (method === "GET" && url.pathname === "/api/feature-endpoint") {
  try {
    const data = await getFeatureData()
    sendJson(res, 200, { data })
  } catch (err) {
    writeApiLog("error", "feature-name", "Failed to get data", { error: err.message })
    sendJson(res, 500, { error: err.message })
  }
}
else if (method === "POST" && url.pathname === "/api/feature-endpoint") {
  try {
    const body = await parseBody(req)
    const result = await processFeatureAction(body)
    sendJson(res, 200, { result })
  } catch (err) {
    sendJson(res, 500, { error: err.message })
  }
}
```

### 1.7 WebSocket Message Format

```javascript
// Client → Server
{ type: "message", text: "hello" }
{ type: "command", command: "npm test" }
{ type: "subscribe", channel: "deployments" }

// Server → Client
{ type: "token", text: "partial response" }
{ type: "done", text: "final response" }
{ type: "error", message: "something went wrong" }
{ type: "status", available: true, servers: {...} }
```

---

## 2. Telegram Bot UI Architecture

### 2.1 Tech Stack

| Layer | Technology | Location |
|-------|-----------|----------|
| Bot Framework | `telegraf` (v4) | `cloud/api/telegramBot.js` |
| Notifications | Custom notifier | `cloud/api/telegramNotifier.js` |
| ML Learning | Custom learner | `cloud/api/telegramLearner.js` |
| Task Board | Inline keyboards + state | `cloud/api/telegramTaskBoard.js` |
| Auth | Email OTP + session | `cloud/api/auth.js` |

### 2.2 Bot Command Structure

```
/start        → Welcome + main menu
/help         → Command list
/tasks        → Task board (inline keyboard)
/status       → System status
/logs [n]     → Recent logs (paginated)
/deploy       → Deployment gate
/orchestrate  → Submit task to orchestrator
/consultant   → Research mode
/agents       → Agent management
/approve      → Approve pending action
/reject       → Reject pending action
```

### 2.3 Inline Keyboard Patterns

**Main Menu** (after /start):
```
┌─────────────────────────────┐
│ 📋 Tasks    🔍 Status      │
│ 📝 Logs     🚀 Deploy      │
│ 🤖 Agents   ⚙️ Settings    │
└─────────────────────────────┘
```

**Task Board** (after /tasks):
```
┌─────────────────────────────┐
│ Task: Fix auth timeout      │
│ Status: 🔵 In Review        │
│ Branch: tg/tg-221           │
│                             │
│ [✅ Approve] [❌ Reject]    │
│ [📄 Diff]   [🔄 Refresh]   │
└─────────────────────────────┘
```

### 2.4 Adding a New Bot Command

```javascript
// 1. Register command handler
bot.command("mycommand", async (ctx) => {
  if (!ctx.from || !isBoss(ctx.from.id)) return
  
  const result = await doSomething()
  await ctx.replyWithHTML(`<b>Result:</b> ${result}`, {
    ...Markup.inlineKeyboard([
      Markup.button.callback("Action", "myaction"),
    ]),
  })
})

// 2. Handle callback
bot.action("myaction", async (ctx) => {
  await ctx.answerCbQuery("Done!")
  await ctx.editMessageText("Action completed.")
})

// 3. Register in menu (optional)
await bot.telegram.setMyCommands([
  { command: "mycommand", description: "Does something" },
])
```

### 2.5 Notification Flow

```
System Event → telegramNotifier.notify()
  → Build message with inline action buttons
  → Send to boss chat via bot.telegram.sendMessage()
  → User clicks button → handleNotificationCallback()
  → Execute action (approve/reject/retry)
  → Update message with result
```

---

## 3. Website Architecture

### 3.1 Tech Stack

| Layer | Technology | Location |
|-------|-----------|----------|
| Framework | Next.js 14 (App Router) | `apps/web-superroo/` |
| Styling | Tailwind CSS | `apps/web-superroo/tailwind.config.ts` |
| SEO | Custom helpers | `apps/web-superroo/src/lib/seo.ts` |
| OG Images | Satori + Resvg | `apps/web-superroo/src/lib/og.ts` |
| Analytics | Custom | `apps/web-superroo/src/lib/stats.ts` |

### 3.2 Page Structure

```
apps/web-superroo/src/app/
├── layout.tsx           → Root layout (header, footer)
├── page.tsx             → Home page
├── about/page.tsx       → About page
├── blog/
│   ├── page.tsx         → Blog listing
│   └── [slug]/page.tsx  → Blog post
├── docs/
│   └── page.tsx         → Documentation
├── api/
│   └── <route>/route.ts → API routes
└── not-found.tsx        → 404 page
```

### 3.3 Adding a New Page

```tsx
// apps/web-superroo/src/app/my-route/page.tsx
import { Metadata } from "next"
import { getSEOTags } from "@/lib/seo"

export const metadata: Metadata = getSEOTags({
  title: "My Page",
  description: "Description for SEO",
})

export default function MyPage() {
  return (
    <main className="...">
      <h1>My Page</h1>
    </main>
  )
}
```

---

## 4. Cross-Cutting Concerns

### 4.1 Error Handling

- **Dashboard views**: Wrap in `<ErrorBoundary>` from [`cloud/dashboard/src/components/ide-terminal/ErrorBoundary.tsx`](cloud/dashboard/src/components/ide-terminal/ErrorBoundary.tsx)
- **API routes**: Always use `try/catch` with `sendJson(res, 500, { error: err.message })`
- **Telegram bot**: Commands should catch errors and reply with friendly messages
- **Website**: Use `not-found.tsx` and `error.tsx` for error pages

### 4.2 Loading States

- **Dashboard**: Show `<div className="text-gray-400">Loading...</div>` while fetching
- **Empty states**: Show `<div className="text-gray-500 text-center py-8">No data</div>`
- **Error states**: Show error message with retry button
- **Telegram**: Use `ctx.replyWithChatAction('typing')` for long operations

### 4.3 Performance

- **useCallback/useMemo**: Wrap all handlers and computed values
- **Dynamic imports**: Use Next.js `dynamic()` for heavy components (Monaco Editor)
- **Debounce**: Use `useDebounceEffect` for search inputs
- **Pagination**: Limit API responses (use `limit` param)
- **WebSocket cleanup**: Always return cleanup function from `useEffect`

### 4.4 Security

- **Auth check**: Every dashboard API endpoint checks `auth.verifyToken()`
- **Telegram**: `isBoss()` guard on all commands
- **API keys**: Stored encrypted in provider meta (AES-256-GCM)
- **CORS**: Not needed (same-origin via nginx proxy)

---

## 5. File Index

### Dashboard Views (18 views)
| View ID | Component | File |
|---------|-----------|------|
| overview | `Overview` | `cloud/dashboard/src/components/views/overview.tsx` |
| working-tree | `WorkingTreeView` | `cloud/dashboard/src/components/views/working-tree.tsx` |
| jobs | `JobsView` | `cloud/dashboard/src/components/views/jobs.tsx` |
| queue | `QueueView` | `cloud/dashboard/src/components/views/queue.tsx` |
| projects | `ProjectsView` | `cloud/dashboard/src/components/views/projects.tsx` |
| agents | `AgentsView` | `cloud/dashboard/src/components/views/agents.tsx` |
| bugs | `BugsView` | `cloud/dashboard/src/components/views/bugs.tsx` |
| healing | `HealingView` | `cloud/dashboard/src/components/views/healing.tsx` |
| monitoring | `MonitoringView` | `cloud/dashboard/src/components/views/monitoring.tsx` |
| logs | `LogsView` | `cloud/dashboard/src/components/views/logs.tsx` |
| docker | `DockerView` | `cloud/dashboard/src/components/views/docker.tsx` |
| github | `GitHubView` | `cloud/dashboard/src/components/views/github.tsx` |
| approvals | `ApprovalsView` | `cloud/dashboard/src/components/views/approvals.tsx` |
| telegram | `TelegramView` | `cloud/dashboard/src/components/views/telegram.tsx` |
| model-router | `ModelRouterView` | `cloud/dashboard/src/components/views/model-router.tsx` |
| api-keys | `ApiKeysView` | `cloud/dashboard/src/components/views/api-keys.tsx` |
| settings | `SettingsView` | `cloud/dashboard/src/components/views/settings.tsx` |
| ai | `AiAssistantView` | `cloud/dashboard/src/components/views/ai-assistant.tsx` |
| skill-generator | `SkillGeneratorView` | `cloud/dashboard/src/components/views/skill-generator.tsx` |
| ide-terminal | `IdeTerminalView` | `cloud/dashboard/src/components/views/ide-terminal.tsx` |
| auto-deploy | `AutoDeployView` | `cloud/dashboard/src/components/views/auto-deploy.tsx` |

### IDE Terminal Sub-components
| Component | File |
|-----------|------|
| Types | `cloud/dashboard/src/components/ide-terminal/types.ts` |
| API | `cloud/dashboard/src/components/ide-terminal/api.ts` |
| FileTree | `cloud/dashboard/src/components/ide-terminal/FileTree.tsx` |
| CodeEditor | `cloud/dashboard/src/components/ide-terminal/CodeEditor.tsx` |
| MonacoEditor | `cloud/dashboard/src/components/ide-terminal/MonacoEditor.tsx` |
| TerminalPanel | `cloud/dashboard/src/components/ide-terminal/TerminalPanel.tsx` |
| AiChatPanel | `cloud/dashboard/src/components/ide-terminal/AiChatPanel.tsx` |
| SearchPanel | `cloud/dashboard/src/components/ide-terminal/SearchPanel.tsx` |
| GitPanel | `cloud/dashboard/src/components/ide-terminal/GitPanel.tsx` |
| ProblemsPanel | `cloud/dashboard/src/components/ide-terminal/ProblemsPanel.tsx` |
| SettingsPanel | `cloud/dashboard/src/components/ide-terminal/SettingsPanel.tsx` |
| ExtensionsPanel | `cloud/dashboard/src/components/ide-terminal/ExtensionsPanel.tsx` |
| DiffViewModal | `cloud/dashboard/src/components/ide-terminal/DiffViewModal.tsx` |
| KeyboardShortcutsModal | `cloud/dashboard/src/components/ide-terminal/KeyboardShortcutsModal.tsx` |
| ErrorBoundary | `cloud/dashboard/src/components/ide-terminal/ErrorBoundary.tsx` |

### API Backend
| File | Purpose |
|------|---------|
| `cloud/api/api.js` | Main HTTP + WebSocket server (~7000 lines) |
| `cloud/api/auth.js` | Authentication (JWT, OTP, Telegram login) |
| `cloud/api/telegramBot.js` | Telegram bot (~2779 lines) |
| `cloud/api/telegramNotifier.js` | Push notifications with action buttons |
| `cloud/api/telegramLearner.js` | ML-powered conversation learning |
| `cloud/api/telegramTaskBoard.js` | Task board UI via inline keyboards |
| `cloud/api/lsp-bridge.js` | LSP language server bridge |
| `cloud/api/routes/healing-metrics.js` | Healing metrics API |
| `cloud/api/routes/monitoring.js` | Monitoring API |

### Website
| File | Purpose |
|------|---------|
| `apps/web-superroo/src/app/layout.tsx` | Root layout |
| `apps/web-superroo/src/app/page.tsx` | Home page |
| `apps/web-superroo/src/lib/seo.ts` | SEO metadata helpers |
| `apps/web-superroo/src/lib/og.ts` | Open Graph image generation |
| `apps/web-superroo/src/lib/stats.ts` | Analytics/stats helpers |
