"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import type { ChatMessage } from "@/lib/ide-store"
import type { Dispatch } from "react"
import type { IdeAction } from "@/lib/ide-store"
import { getWebSocketUrl } from "../api"

const SESSION_KEY = "superroo-chat-session"
const WS_TIMEOUT_MS = 120_000 // 120 seconds
const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 10000
const PING_INTERVAL = 30000

function getSessionId(): string {
	if (typeof window === "undefined") return ""
	let sessionId = localStorage.getItem(SESSION_KEY)
	if (!sessionId) {
		sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
		localStorage.setItem(SESSION_KEY, sessionId)
	}
	return sessionId
}

interface UseWebSocketOptions {
	dispatch: Dispatch<IdeAction>
	onSuggestions?: (suggestions: { text: string; description: string; type: "ai" }[]) => void
	onShowSmartSuggestions?: (show: boolean) => void
	/** Callback for PTY output data */
	onPtyOutput?: (sessionId: string, data: string) => void
	/** Callback for PTY session exit */
	onPtyExit?: (sessionId: string, exitCode: number | null, signal: string | null) => void
	/** Callback for PTY session created confirmation */
	onPtyCreated?: (sessionId: string, shell: string, cwd: string) => void
	/** Callback for PTY buffer data */
	onPtyBuffer?: (sessionId: string, buffer: string) => void
	/** Callback for PTY session list */
	onPtyList?: (
		sessions: Array<{ id: string; shell: string; cwd: string; createdAt: number; lastActivity: number }>,
	) => void
}

interface UseWebSocketReturn {
	wsRef: React.MutableRefObject<WebSocket | null>
	wsConnected: boolean
	wsReconnecting: boolean
	sendMessage: (payload: object) => boolean
	canSendAi: () => boolean
	aiRateLimitStatus: { retryAfterMs: number; tokens: number } | null
}

export function useWebSocket({
	dispatch,
	onSuggestions,
	onShowSmartSuggestions,
	onPtyOutput,
	onPtyExit,
	onPtyCreated,
	onPtyBuffer,
	onPtyList,
}: UseWebSocketOptions): UseWebSocketReturn {
	const wsRef = useRef<WebSocket | null>(null)
	const [wsConnected, setWsConnected] = useState(false)
	const [wsReconnecting, setWsReconnecting] = useState(false)
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const reconnectAttemptRef = useRef(0)
	const pendingInputQueueRef = useRef<string[]>([])
	const ptySessionIdRef = useRef<string | null>(null)

	// ── Adaptive AI rate limiting (token bucket) ────────────────────────
	const tokenBucketRef = useRef({
		tokens: 3,
		maxTokens: 5,
		lastRefill: Date.now(),
		backoffMs: 0,
		errorCount: 0,
	})
	const [aiRateLimitStatus, setAiRateLimitStatus] = useState<{ retryAfterMs: number; tokens: number } | null>(null)

	const canSendAi = useCallback((): boolean => {
		const bucket = tokenBucketRef.current
		const now = Date.now()
		const elapsed = now - bucket.lastRefill
		const tokensToAdd = Math.floor(elapsed / 2000)
		if (tokensToAdd > 0) {
			bucket.tokens = Math.min(bucket.tokens + tokensToAdd, bucket.maxTokens)
			bucket.lastRefill = now
		}
		if (bucket.backoffMs > 0 && now < bucket.backoffMs) {
			setAiRateLimitStatus({ retryAfterMs: bucket.backoffMs - now, tokens: bucket.tokens })
			return false
		}
		if (bucket.tokens >= 1) {
			bucket.tokens -= 1
			setAiRateLimitStatus(null)
			return true
		}
		setAiRateLimitStatus({ retryAfterMs: 0, tokens: 0 })
		return false
	}, [])

	const recordAiError = useCallback(() => {
		const bucket = tokenBucketRef.current
		bucket.errorCount += 1
		bucket.backoffMs = Date.now() + Math.min(1000 * Math.pow(2, bucket.errorCount), 30000)
		bucket.maxTokens = 1
		setAiRateLimitStatus({ retryAfterMs: bucket.backoffMs - Date.now(), tokens: bucket.tokens })
	}, [])

	const recordAiSuccess = useCallback(() => {
		const bucket = tokenBucketRef.current
		if (bucket.errorCount > 0) {
			bucket.errorCount = Math.max(0, bucket.errorCount - 1)
		}
		if (bucket.errorCount === 0) {
			bucket.backoffMs = 0
			bucket.maxTokens = 5
		}
		setAiRateLimitStatus(null)
	}, [])

	// Clear the streaming timeout
	const clearStreamTimeout = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}
	}, [])

	// Start the streaming timeout — if no "done" within WS_TIMEOUT_MS, cancel
	const startStreamTimeout = useCallback(() => {
		clearStreamTimeout()
		timeoutRef.current = setTimeout(() => {
			dispatch({ type: "SET_AI_SENDING", payload: false })
			const errMsg: ChatMessage = {
				id: `msg-${Date.now()}`,
				role: "assistant",
				author: "System",
				time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				content: `Request timed out after ${WS_TIMEOUT_MS / 1000}s. Please try again.`,
			}
			dispatch({ type: "ADD_AI_MESSAGE", payload: errMsg })
			// Close the stale connection so it reconnects fresh
			if (wsRef.current) {
				wsRef.current.close()
			}
		}, WS_TIMEOUT_MS)
	}, [dispatch, clearStreamTimeout])

	const connect = useCallback(() => {
		const sessionId = getSessionId()
		const wsUrl = getWebSocketUrl(`/api/ws/chat?session=${sessionId}`)

		try {
			const ws = new WebSocket(wsUrl)

			ws.onopen = () => {
				setWsConnected(true)
				setWsReconnecting(false)
				reconnectAttemptRef.current = 0

				// Re-attach to existing PTY session if we have one
				if (ptySessionIdRef.current) {
					ws.send(JSON.stringify({ type: "pty:attach", sessionId: ptySessionIdRef.current }))
				}

				// Flush any pending input
				if (pendingInputQueueRef.current.length > 0) {
					for (const data of pendingInputQueueRef.current) {
						ws.send(JSON.stringify({ type: "pty:input", sessionId: ptySessionIdRef.current, data }))
					}
					pendingInputQueueRef.current = []
				}

				// Start ping interval
				pingIntervalRef.current = setInterval(() => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: "ping" }))
					}
				}, PING_INTERVAL)
			}

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data)
					switch (data.type) {
						case "assistant-start": {
							// Start the timeout when streaming begins
							startStreamTimeout()
							const msg: ChatMessage = {
								id: `msg-${Date.now()}`,
								role: "assistant",
								author: data.agent || "AI",
								meta: data.meta,
								time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
								content: "",
							}
							dispatch({ type: "ADD_AI_MESSAGE", payload: msg })
							break
						}
						case "token": {
							dispatch({ type: "UPDATE_LAST_AI_MESSAGE", payload: data.text })
							break
						}
						case "done": {
							// Clear the timeout — streaming completed successfully
							clearStreamTimeout()
							recordAiSuccess()
							dispatch({ type: "SET_AI_SENDING", payload: false })
							if (data.suggestions?.length) {
								dispatch({ type: "SET_PROACTIVE_SUGGESTIONS", payload: data.suggestions })
							}
							break
						}
						case "suggestions": {
							const mapped = (data.suggestions || []).map((s: string) => ({
								text: s,
								description: "AI suggestion",
								type: "ai" as const,
							}))
							onSuggestions?.(mapped)
							onShowSmartSuggestions?.(true)
							break
						}
						case "error": {
							clearStreamTimeout()
							recordAiError()
							dispatch({ type: "SET_AI_SENDING", payload: false })
							const errMsg: ChatMessage = {
								id: `msg-${Date.now()}`,
								role: "assistant",
								author: "System",
								time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
								content: `Error: ${data.message || "Unknown error"}`,
							}
							dispatch({ type: "ADD_AI_MESSAGE", payload: errMsg })
							break
						}
						case "cancelled": {
							clearStreamTimeout()
							dispatch({ type: "SET_AI_SENDING", payload: false })
							break
						}
						// ── PTY Events ──────────────────────────────────────────
						case "pty:output": {
							onPtyOutput?.(data.sessionId, data.data)
							break
						}
						case "pty:exit": {
							onPtyExit?.(data.sessionId, data.exitCode, data.signal)
							break
						}
						case "pty:created": {
							ptySessionIdRef.current = data.sessionId
							onPtyCreated?.(data.sessionId, data.shell, data.cwd)
							break
						}
						case "pty:buffer": {
							ptySessionIdRef.current = data.sessionId
							onPtyBuffer?.(data.sessionId, data.buffer)
							break
						}
						case "pty:list": {
							onPtyList?.(data.sessions || [])
							break
						}
					}
				} catch {
					// ignore parse errors
				}
			}

			ws.onclose = () => {
				setWsConnected(false)
				setWsReconnecting(true)
				clearStreamTimeout()
				if (pingIntervalRef.current) {
					clearInterval(pingIntervalRef.current)
					pingIntervalRef.current = null
				}
				const delay = Math.min(
					RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current),
					RECONNECT_MAX_DELAY,
				)
				reconnectAttemptRef.current += 1
				reconnectTimerRef.current = setTimeout(() => {
					connect()
				}, delay)
			}

			ws.onerror = () => {
				ws.close()
			}

			wsRef.current = ws
		} catch {
			setWsReconnecting(true)
			const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current), RECONNECT_MAX_DELAY)
			reconnectAttemptRef.current += 1
			reconnectTimerRef.current = setTimeout(() => connect(), delay)
		}
	}, [
		dispatch,
		startStreamTimeout,
		clearStreamTimeout,
		onSuggestions,
		onShowSmartSuggestions,
		onPtyOutput,
		onPtyExit,
		onPtyCreated,
		onPtyBuffer,
		onPtyList,
	])

	useEffect(() => {
		connect()

		// Reconnect on visibility change
		function handleVisibilityChange() {
			if (document.visibilityState === "visible") {
				const ws = wsRef.current
				if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
					if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
					connect()
				}
			}
		}
		document.addEventListener("visibilitychange", handleVisibilityChange)

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange)
			if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
			clearStreamTimeout()
			if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)
			if (wsRef.current) {
				wsRef.current.close()
				wsRef.current = null
			}
		}
	}, [connect, clearStreamTimeout])

	const sendMessage = useCallback((payload: object): boolean => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(payload))
			return true
		}
		// Queue PTY input if disconnected
		const typed = payload as Record<string, unknown>
		if (typed.type === "pty:input" && typeof typed.data === "string") {
			pendingInputQueueRef.current.push(typed.data)
		}
		return false
	}, [])

	return { wsRef, wsConnected, wsReconnecting, sendMessage, canSendAi, aiRateLimitStatus }
}
