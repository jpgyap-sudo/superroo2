/**
 * Super Roo — webview state context.
 *
 * Single React context that:
 *   - owns one SrMessageClient
 *   - holds the dashboard snapshot, features, bugs, events, tasks, settings
 *   - exposes a `send` shortcut for actions
 *   - falls back to mock data when there's no extension host
 *
 * Phase 3 keeps state simple — no Redux, no Zustand. All five tabs read from
 * the same context so a single message round-trip refreshes everything.
 *
 * Real-time updates flow through `superRoo:event` push messages from the
 * extension host (which subscribes to the headless `EventLog` and forwards).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { SrMessageClient, type VsCodeLike } from "../messaging/client"
import type { SrExtensionMessage, SrWebviewMessage } from "../messaging/protocol"
import { mockBugs, mockEvents, mockFeatures, mockSnapshot, mockTasks } from "../messaging/mockData"
import type { SrBug, SrDashboardSnapshot, SrEvent, SrFeature, SrTask } from "../types"

const MAX_LIVE_EVENTS = 500

// ──────────────────────────────────────────────────────────────────────────────
// Provider / settings / route types (mirror of src/super-roo/settings/types.ts)
// ──────────────────────────────────────────────────────────────────────────────

export interface SrProviderEntry {
	id: string
	name: string
	description: string
	status: string
	hasKey: boolean
	lastTestedAt: number | null
	latencyMs: number | null
	models: string[]
	capabilities: string[]
}

export interface SrAgentRoute {
	agent: string
	primary: string
	fallbacks: string[]
}

export interface SrApprovalResult {
	decision: string
	reason: string
}

export interface SrContextValue {
	/** Current dashboard snapshot (null until first reply lands). */
	snapshot: SrDashboardSnapshot | null
	features: SrFeature[]
	bugs: SrBug[]
	events: SrEvent[]
	tasks: SrTask[]
	// Provider / settings / routes state
	providers: SrProviderEntry[]
	fullSettings: Record<string, unknown>
	routes: SrAgentRoute[]
	approvalResult: SrApprovalResult | null
	mockMode: boolean
	send: (msg: SrWebviewMessage) => void
	requestRefresh: () => void
}

const SrContext = createContext<SrContextValue | null>(null)

interface ProviderProps {
	children: ReactNode
	vscode?: VsCodeLike
	/** Force mock mode (e.g. for Storybook). Default: auto-detect. */
	forceMock?: boolean
}

function detectVsCode(): VsCodeLike | null {
	if (typeof window === "undefined") return null
	if (typeof (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi === "function") {
		try {
			// In Roo's own webview the acquire call has already happened; we can't
			// call it twice. Instead, the parent app gives us a VsCodeLike via prop.
			return null
		} catch {
			return null
		}
	}
	return null
}

export function SrProvider({ children, vscode, forceMock }: ProviderProps) {
	const realClient = useMemo<SrMessageClient | null>(() => {
		const target = vscode ?? detectVsCode()
		return target ? new SrMessageClient(target) : null
	}, [vscode])

	const mockMode = forceMock ?? realClient === null

	const [snapshot, setSnapshot] = useState<SrDashboardSnapshot | null>(mockMode ? mockSnapshot() : null)
	const [features, setFeatures] = useState<SrFeature[]>(mockMode ? mockFeatures() : [])
	const [bugs, setBugs] = useState<SrBug[]>(mockMode ? mockBugs() : [])
	const [events, setEvents] = useState<SrEvent[]>(mockMode ? mockEvents() : [])
	const [tasks, setTasks] = useState<SrTask[]>(mockMode ? mockTasks() : [])
	// Provider / settings / routes state
	const [providers, setProviders] = useState<SrProviderEntry[]>([])
	const [fullSettings, setFullSettings] = useState<Record<string, unknown>>({})
	const [routes, setRoutes] = useState<SrAgentRoute[]>([])
	const [approvalResult, setApprovalResult] = useState<SrApprovalResult | null>(null)

	const clientRef = useRef<SrMessageClient | null>(realClient)

	useEffect(() => {
		const client = clientRef.current
		if (!client) return
		client.start()
		const unsub = client.subscribe((msg: SrExtensionMessage) => {
			switch (msg.type) {
				case "superRoo:dashboard":
					setSnapshot(msg.snapshot)
					return
				case "superRoo:features":
					setFeatures(msg.features)
					return
				case "superRoo:bugs":
					setBugs(msg.bugs)
					return
				case "superRoo:events":
					setEvents(msg.events)
					return
				case "superRoo:tasks":
					setTasks(msg.tasks)
					return
				case "superRoo:event":
					// Streaming event — prepend, cap at MAX_LIVE_EVENTS to bound memory.
					setEvents((prev) => [msg.event, ...prev].slice(0, MAX_LIVE_EVENTS))
					return
				case "superRoo:settings":
					setSnapshot((prev) => (prev ? { ...prev, mode: msg.mode, selfImprove: msg.selfImprove } : prev))
					return
				case "superRoo:error":
					console.warn("[super-roo] extension error:", msg.message)
					return
				// ── Provider responses ──
				case "superRoo:providers":
					setProviders(msg.providers)
					return
				case "superRoo:providerKeySaved":
					// Refresh provider list after saving a key
					client.send({ type: "superRoo:getProviders" })
					return
				case "superRoo:providerTested":
					// Update the specific provider's status in the list
					setProviders((prev) =>
						prev.map((p) =>
							p.id === msg.providerId
								? {
										...p,
										status: msg.ok ? "connected" : "invalid",
										lastTestedAt: Date.now(),
										latencyMs: msg.latencyMs,
									}
								: p,
						),
					)
					return
				case "superRoo:providerKeyRemoved":
					setProviders((prev) =>
						prev.map((p) =>
							p.id === msg.providerId
								? { ...p, hasKey: false, status: "not_tested", lastTestedAt: null, latencyMs: null }
								: p,
						),
					)
					return
				// ── Full settings ──
				case "superRoo:fullSettings":
					setFullSettings(msg.settings)
					return
				// ── Routes ──
				case "superRoo:routes":
					setRoutes(msg.routes)
					return
				case "superRoo:routesSaved":
					// Refresh routes after save
					client.send({ type: "superRoo:getRoutes" })
					return
				// ── Approval ──
				case "superRoo:approvalResult":
					setApprovalResult({ decision: msg.decision, reason: msg.reason })
					return
			}
		})
		// Initial load: ask the host for everything.
		client.send({ type: "superRoo:getDashboard" })
		client.send({ type: "superRoo:getFeatures" })
		client.send({ type: "superRoo:getBugs" })
		client.send({ type: "superRoo:getEvents", limit: 200 })
		client.send({ type: "superRoo:getTasks" })
		client.send({ type: "superRoo:getProviders" })
		client.send({ type: "superRoo:getFullSettings" })
		client.send({ type: "superRoo:getRoutes" })
		return () => {
			unsub()
			client.stop()
		}
	}, [])

	const send = useCallback((msg: SrWebviewMessage) => {
		clientRef.current?.send(msg)
	}, [])

	const requestRefresh = useCallback(() => {
		const client = clientRef.current
		if (!client) return
		client.send({ type: "superRoo:getDashboard" })
		client.send({ type: "superRoo:getFeatures" })
		client.send({ type: "superRoo:getBugs" })
		client.send({ type: "superRoo:getEvents", limit: 200 })
		client.send({ type: "superRoo:getTasks" })
		client.send({ type: "superRoo:getProviders" })
		client.send({ type: "superRoo:getFullSettings" })
		client.send({ type: "superRoo:getRoutes" })
	}, [])

	const value = useMemo<SrContextValue>(
		() => ({
			snapshot,
			features,
			bugs,
			events,
			tasks,
			providers,
			fullSettings,
			routes,
			approvalResult,
			mockMode,
			send,
			requestRefresh,
		}),
		[
			snapshot,
			features,
			bugs,
			events,
			tasks,
			providers,
			fullSettings,
			routes,
			approvalResult,
			mockMode,
			send,
			requestRefresh,
		],
	)

	return <SrContext.Provider value={value}>{children}</SrContext.Provider>
}

export function useSr(): SrContextValue {
	const v = useContext(SrContext)
	if (!v) throw new Error("useSr must be used inside <SrProvider>")
	return v
}
