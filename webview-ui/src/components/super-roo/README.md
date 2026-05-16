# Super Roo — Webview Dashboard (Phase 3)

This directory is the React + Tailwind dashboard for Super Roo. It lives inside Roo Code's existing webview app (`webview-ui/`) and uses the same conventions: tabs (4-wide), no semicolons, double quotes, shadcn-style primitives, lucide-react icons, the `@/lib/utils` `cn()` helper, and Roo's VS Code theme tokens (`vscode-foreground`, `vscode-panel-border`, etc.).

## Tabs

| Tab | What it shows |
|---|---|
| Dashboard | Stat cards (mode, queue counts, agent readiness, last 24h), recent tasks |
| Features | Filterable list of features (status / health / name search) with metadata |
| Bugs | Expandable bug rows with severity/status filters, full repro/fix details |
| Logs | Live event stream with level filter, message search, auto-scroll toggle |
| Settings | Mode selector, self-improve toggle, manual refresh |

## Tree

```
webview-ui/src/components/super-roo/
├── SuperRooDashboard.tsx       top-level component with tab navigation
├── index.ts                     public barrel
├── hooks/
│   └── SrContext.tsx            React context: data + send/refresh
├── messaging/
│   ├── client.ts                SrMessageClient — postMessage + window listener
│   ├── protocol.ts              typed SrWebviewMessage / SrExtensionMessage
│   └── mockData.ts              standalone-render fallback
├── parts/
│   └── Pills.tsx                shared status/severity/level/mode pills
├── tabs/
│   ├── DashboardTab.tsx
│   ├── FeaturesTab.tsx
│   ├── BugsTab.tsx
│   ├── LogsTab.tsx
│   └── SettingsTab.tsx
└── types/
    └── index.ts                  webview-local mirrors of headless types
```

## Mock-data fallback

When the host hasn't wired up the message handler yet (Phase 4 work), the dashboard auto-detects the missing extension API and renders mock data so you can see the UI in `vite dev` or storybook. A yellow banner appears across the top when in mock mode.

To force mock mode for screenshots:

```tsx
<SuperRooDashboard forceMock />
```

## Wiring (when Phase 4 lands)

Phase 4 will add a host-side message handler somewhere in `src/super-roo-host/dashboard/` that:

1. Registers a `provider.onWebviewMessage` listener filtering on the `superRoo:` prefix
2. On each command, reads the relevant data from `orchestrator.queue`, `.features`, `.events`, `BugRegistry`, etc.
3. Posts back the matching `SrExtensionMessage`
4. Subscribes to `EventLog` and forwards each event as a `superRoo:event` push so the live log streams

Until then, the message protocol is fully defined and stable — Phase 4 only writes the host side; this directory does not need changes.

## Message protocol

Webview → Host (`SrWebviewMessage`):

- `superRoo:getDashboard` — request snapshot
- `superRoo:getFeatures` — full feature list (with optional filters)
- `superRoo:getBugs`, `superRoo:getEvents`, `superRoo:getTasks`
- `superRoo:setMode { mode }` — change SafetyMode
- `superRoo:setSelfImprove { enabled }`
- `superRoo:cancelTask`, `superRoo:retryTask`
- `superRoo:enqueueGoal { goal, agent, priority }`

Host → Webview (`SrExtensionMessage`):

- Replies: `superRoo:dashboard`, `superRoo:features`, `superRoo:bugs`, `superRoo:events`, `superRoo:tasks`, `superRoo:settings`
- Pushes: `superRoo:event` (streamed from EventLog, single event per message)
- Errors: `superRoo:error { message }`

All message types live in `messaging/protocol.ts`. Both sides import from there.

## Phase 3 limitations

- **Type-checking only.** Per the agreed scope, the components were not rendered in a real VS Code webview; they were type-checked against minimal shims. Any visual issue will surface when you `pnpm --filter @roo-code/vscode-webview check-types && pnpm --filter @roo-code/vscode-webview build`.
- **No new dependencies added.** Uses what's already in `webview-ui/package.json` (React, Tailwind, lucide-react, the shadcn-style `@/lib/utils`).
- **No mount point in Roo's main app yet.** Phase 4 will add either a new VS Code activity-bar tab or a panel section that mounts `<SuperRooDashboard />` with the host's `vscode` API wrapper.
- **No internationalization yet.** All strings are hardcoded English. Roo's webview uses `react-i18next`; we'll add a `super-roo.json` locale file in Phase 4 alongside the host wiring.
- **No accessibility audit yet.** Roles and aria-labels are present on the tab nav but the rest is plain HTML. Phase 4 will run through the existing webview a11y tests.
- **`SrContext` is event-stream-bounded.** The live event list caps at 500 entries to bound memory growth in long sessions.
- **Mock data shows a single bug, three features, six events.** Enough to exercise every component path; not representative of real volume.

## Verification status (sandbox)

- **Type-check (parallel workspace with shims for react, react/jsx-runtime, lucide-react, @/lib/utils):** ✓ zero errors across all 13 files
- **Tests:** none in Phase 3 — UI components in this codebase don't have unit tests; Phase 4 will add a smoke test that mounts `<SuperRooDashboard forceMock />` and asserts each tab renders without throwing.
- **Real `pnpm --filter @roo-code/vscode-webview check-types`:** not run (no internet → no `pnpm install`). The shim mirrors `@types/react`'s shape so the type-check should pass identically.
