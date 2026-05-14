---
name: ui-builder
description: 🏗️ UI Builder — Build, extend, and wire dashboard views, Telegram UI, and website pages with full-stack integration. Ensures every new feature is properly wired (sidebar → page.tsx → API endpoint → WebSocket), expandable for future integrations, and follows SuperRoo design patterns.
---

# UI Builder Skill

## When To Use

Use this skill when the user asks to:

- **Build a new dashboard view** (e.g., a new management page in the cloud dashboard)
- **Add a new Telegram UI feature** (e.g., new bot commands, inline keyboards, task boards)
- **Build or redesign a website page** (e.g., landing page, docs site, marketing site)
- **Extend an existing UI** with new panels, modals, tabs, or controls
- **Wire a new feature end-to-end** (frontend → API → backend → WebSocket)
- **Fix or refactor UI components** to be expandable for future integrations

## Core Principles

### 1. Every UI Feature Must Be Wired End-to-End

A feature is NOT complete until it has all 4 layers wired:

| Layer | File | What to Check |
|-------|------|---------------|
| **Sidebar** | [`cloud/dashboard/src/components/sidebar.tsx`](cloud/dashboard/src/components/sidebar.tsx) | Nav entry with icon, label, and `id` |
| **Page Registry** | [`cloud/dashboard/src/app/page.tsx`](cloud/dashboard/src/app/page.tsx) | Import + `PAGES` record entry |
| **View Component** | `cloud/dashboard/src/components/views/<name>.tsx` | The actual UI component |
| **API Endpoint** | [`cloud/api/api.js`](cloud/api/api.js) | Route handler (REST or WebSocket) |

### 2. Design for Expandability

- **Use interfaces/types** at the top of every component file — never hardcode data shapes inline
- **Separate concerns**: keep data fetching (`api.ts`), types (`types.ts`), and UI rendering in separate files
- **Use `useCallback`/`useMemo`** for performance — the dashboard has many views and re-renders
- **Wrap new sections in `<ErrorBoundary>`** — see [`cloud/dashboard/src/components/ide-terminal/ErrorBoundary.tsx`](cloud/dashboard/src/components/ide-terminal/ErrorBoundary.tsx)
- **Use `cn()` from `@/lib/utils`** for conditional class merging
- **Use Tailwind CSS** — never inline styles. VSCode CSS variables go in `webview-ui/src/index.css`

### 3. Telegram UI Follows Bot Patterns

Telegram UI is NOT a web page — it's a bot interface. Key differences:

- **Commands**: Register in [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) with `bot.command()`
- **Inline Keyboards**: Use `Markup.inlineKeyboard()` with callback data routing
- **Menus**: Use `bot.telegram.setMyCommands()` for persistent menu
- **Stateful Conversations**: Use session-based `conversationState` map
- **Natural Language**: Route through `handleNaturalLanguageInstruction()` in telegramBot.js
- **Notifications**: Use [`cloud/api/telegramNotifier.js`](cloud/api/telegramNotifier.js) for push notifications with action buttons

### 4. Website Pages Follow Next.js Patterns

- **App Router**: Pages go in `apps/web-superroo/src/app/`
- **Server Components by default**: Only add `"use client"` when you need hooks or interactivity
- **SEO**: Use `src/lib/seo.ts` for metadata generation
- **OG Images**: Use `src/lib/og.ts` for dynamic Open Graph generation
- **Components**: Shared UI in `apps/web-superroo/src/components/`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLOUD DASHBOARD (Next.js)                    │
│  ┌──────────┐  ┌─────────────────────────────────────────────────┐ │
│  │ Sidebar   │  │  View Area                                      │ │
│  │ (nav.tsx) │  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │ │
│  │           │  │  │ Overview │ │ Telegram │ │ IDE Terminal │   │ │
│  │ icon+label│  │  │ (view)   │ │ (view)   │ │ (view)       │   │ │
│  │   ↓       │  │  └──────────┘ └──────────┘ └──────────────┘   │ │
│  │ page.tsx  │  │  Each view imports sub-components:             │ │
│  │ PAGES{}   │  │  └── panels, modals, cards, charts             │ │
│  └──────────┘  └─────────────────────────────────────────────────┘ │
│                       │ HTTP fetch / WebSocket                      │
│                       ▼                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              API SERVER (cloud/api/api.js)                    │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ REST API │ │WebSocket │ │ Telegram │ │ LSP Bridge   │   │  │
│  │  │ /api/*   │ │ /ws/*    │ │ Bot      │ │ /api/ws/lsp  │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step: Adding a New Dashboard View

### Step 1: Create the View Component

Create `cloud/dashboard/src/components/views/<name>.tsx`:

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { StatCard, Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ErrorBoundary } from "@/components/ide-terminal/ErrorBoundary"
import { SomeIcon } from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────
interface MyFeatureData {
  id: string
  name: string
  status: string
}

// ─── Component ───────────────────────────────────────────────────────────────
export function MyNewView() {
  const [data, setData] = useState<MyFeatureData[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/my-feature")
      const json = await res.json()
      setData(json.data || [])
    } catch (err) {
      console.error("Failed to fetch my-feature data", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <ErrorBoundary>
      <div className="p-4 space-y-4">
        <h1 className="text-lg font-semibold text-gray-200">My New Feature</h1>
        {loading ? (
          <div className="text-gray-400">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-200">{item.name}</span>
                  <Badge>{item.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
```

### Step 2: Register in Sidebar

In [`cloud/dashboard/src/components/sidebar.tsx`](cloud/dashboard/src/components/sidebar.tsx):

1. Import the icon from `lucide-react`
2. Add a nav entry: `{ id: "my-feature", icon: MyIcon, label: "My Feature" }`

### Step 3: Register in Page Registry

In [`cloud/dashboard/src/app/page.tsx`](cloud/dashboard/src/app/page.tsx):

1. Import the view: `import { MyNewView } from "@/components/views/my-new-view"`
2. Add to `PAGES`: `"my-feature": MyNewView,`

### Step 4: Add API Endpoint (if needed)

In [`cloud/api/api.js`](cloud/api/api.js), add a route handler:

```javascript
// ── My Feature ──────────────────────────────────────────────────────────────
else if (method === "GET" && url.pathname === "/api/my-feature") {
  try {
    const data = await getMyFeatureData()
    sendJson(res, 200, { data })
  } catch (err) {
    sendJson(res, 500, { error: err.message })
  }
}
```

### Step 5: Add WebSocket (if real-time needed)

In [`cloud/api/api.js`](cloud/api/api.js), add WebSocket message handling:

```javascript
// In the ws.on("message") handler:
if (msg.type === "my-feature-update") {
  // Handle real-time update
  ws.send(JSON.stringify({ type: "my-feature-data", payload: data }))
}
```

---

## Step-by-Step: Adding a New Telegram Bot Feature

### Step 1: Register the Command

In [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js):

```javascript
bot.command("mycommand", async (ctx) => {
  // Auth check
  if (!ctx.from || !isBoss(ctx.from.id)) return
  
  // Business logic
  const result = await doSomething()
  
  // Response with inline keyboard
  await ctx.reply(`Result: ${result}`, {
    ...Markup.inlineKeyboard([
      Markup.button.callback("Action", "myaction_callback"),
    ]),
  })
})
```

### Step 2: Handle Callbacks

```javascript
bot.action("myaction_callback", async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.editMessageText("Action completed!")
})
```

### Step 3: Add to Menu (optional)

```javascript
await bot.telegram.setMyCommands([
  { command: "mycommand", description: "Does something useful" },
  // ... existing commands
])
```

### Step 4: Wire to Dashboard (optional)

If the Telegram feature needs a dashboard counterpart:

1. Add an API endpoint in [`cloud/api/api.js`](cloud/api/api.js) that the Telegram bot calls
2. Add a dashboard view that shows Telegram bot data via the API

---

## Step-by-Step: Adding a New Website Page

### Step 1: Create the Page

Create `apps/web-superroo/src/app/<route>/page.tsx`:

```tsx
import { Metadata } from "next"
import { getSEOTags } from "@/lib/seo"

export const metadata: Metadata = getSEOTags({
  title: "Page Title",
  description: "Page description for SEO",
})

export default function MyPage() {
  return (
    <main className="...">
      <h1>My Page</h1>
    </main>
  )
}
```

### Step 2: Add Navigation

Update the site navigation in the layout or header component.

### Step 3: Add API Route (if needed)

Create `apps/web-superroo/src/app/api/<route>/route.ts` for serverless API endpoints.

---

## Component Patterns Reference

### Dashboard View Pattern

```tsx
// ─── State ──────────────────────────────────────────────────────────────────
const [data, setData] = useState<DataType[]>([])
const [loading, setLoading] = useState(true)

// ─── Data Fetching ──────────────────────────────────────────────────────────
const fetchData = useCallback(async () => {
  try {
    const res = await fetch("/api/endpoint")
    const json = await res.json()
    setData(json.data || [])
  } finally {
    setLoading(false)
  }
}, [])

useEffect(() => { fetchData() }, [fetchData])

// ─── Render ─────────────────────────────────────────────────────────────────
return (
  <ErrorBoundary>
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-200">Title</h1>
        <Badge>{count} items</Badge>
      </div>
      {/* Content */}
      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : data.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No data</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.map((item) => (
            <Card key={item.id} className="p-4">
              {/* Card content */}
            </Card>
          ))}
        </div>
      )}
    </div>
  </ErrorBoundary>
)
```

### Modal/Overlay Pattern

```tsx
{showModal && (
  <div
    className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40"
    onClick={() => setShowModal(false)}
  >
    <div
      className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[600px] max-h-[70vh] overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <ModalComponent
        onClose={() => setShowModal(false)}
      />
    </div>
  </div>
)}
```

### Sub-component Pattern (IDE Terminal style)

For complex views, split into focused sub-components in `cloud/dashboard/src/components/ide-terminal/`:

| File | Purpose |
|------|---------|
| `types.ts` | All shared interfaces |
| `api.ts` | All API fetch functions |
| `MainComponent.tsx` | Orchestrator with state |
| `SubPanel1.tsx` | Focused sub-panel |
| `SubPanel2.tsx` | Another sub-panel |
| `ErrorBoundary.tsx` | Error boundary wrapper |

### Telegram Inline Keyboard Pattern

```javascript
const keyboard = Markup.inlineKeyboard([
  [Markup.button.callback("✅ Approve", `approve_${taskId}`)],
  [Markup.button.callback("❌ Reject", `reject_${taskId}`)],
  [Markup.button.callback("📄 Diff", `diff_${taskId}`)],
])

await ctx.reply(message, { ...keyboard, parse_mode: "HTML" })
```

---

## Key Files Reference

### Dashboard Frontend
| File | Purpose |
|------|---------|
| [`cloud/dashboard/src/app/page.tsx`](cloud/dashboard/src/app/page.tsx) | Main dashboard page — view registry |
| [`cloud/dashboard/src/components/sidebar.tsx`](cloud/dashboard/src/components/sidebar.tsx) | Navigation sidebar |
| [`cloud/dashboard/src/components/views/`](cloud/dashboard/src/components/views/) | All view components |
| [`cloud/dashboard/src/components/ide-terminal/`](cloud/dashboard/src/components/ide-terminal/) | IDE Terminal sub-components |
| [`cloud/dashboard/src/components/ui/`](cloud/dashboard/src/components/ui/) | Reusable UI primitives |
| [`cloud/dashboard/tailwind.config.ts`](cloud/dashboard/tailwind.config.ts) | Tailwind configuration |

### API Backend
| File | Purpose |
|------|---------|
| [`cloud/api/api.js`](cloud/api/api.js) | Main API server (~7000 lines) |
| [`cloud/api/auth.js`](cloud/api/auth.js) | Authentication |
| [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | Telegram bot logic |
| [`cloud/api/telegramNotifier.js`](cloud/api/telegramNotifier.js) | Telegram notifications |
| [`cloud/api/lsp-bridge.js`](cloud/api/lsp-bridge.js) | LSP language server bridge |

### Website
| File | Purpose |
|------|---------|
| `apps/web-superroo/src/app/` | Next.js App Router pages |
| `apps/web-superroo/src/lib/seo.ts` | SEO metadata helpers |
| `apps/web-superroo/src/lib/og.ts` | Open Graph image generation |

---

## Validation Checklist

Before marking a UI feature as complete, verify:

- [ ] **Sidebar entry** exists in [`sidebar.tsx`](cloud/dashboard/src/components/sidebar.tsx)
- [ ] **Page registry** entry exists in [`page.tsx`](cloud/dashboard/src/app/page.tsx)
- [ ] **View component** renders without errors (wrap in `<ErrorBoundary>`)
- [ ] **API endpoint** (if needed) returns correct data
- [ ] **WebSocket** (if real-time) connects and handles messages
- [ ] **TypeScript compiles**: `npx tsc --noEmit` (run from `cloud/dashboard/`)
- [ ] **Build succeeds**: `pnpm build` (run from `cloud/dashboard/`)
- [ ] **Playwright tests pass** (if e2e tests exist)
- [ ] **Telegram commands** (if bot feature) are registered and respond
- [ ] **Error states** handled (loading, empty, error, offline)
- [ ] **Mobile responsive** (check with browser dev tools)
- [ ] **Expandable**: types are in interfaces, data fetching is separated, no hardcoded magic values
