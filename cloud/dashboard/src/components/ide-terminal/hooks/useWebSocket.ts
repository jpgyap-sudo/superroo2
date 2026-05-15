"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import type { ChatMessage } from "@/lib/ide-store"
import type { Dispatch } from "react"
import type { IdeAction } from "@/lib/ide-store"

const SESSION_KEY = "superroo-chat-session"
const WS_TIMEOUT_MS = 120_000 // 120 seconds
const RECONNECT_DELAY = 3000
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
}

interface UseWebSocketReturn {
	wsRef: React.MutableRefObject<WebSocket | null>
	wsConnected: boolean
	wsReconnecting: boolean
	sendMessage: (payload: object) => boolean
}

export function useWebSocket({
	dispatch,
	onSuggestions,
	onShowSmartSuggestions,
}: UseWebSocketOptions): UseWebSocketReturn {
	const wsRef = useRef<WebSocket | null>(null)
	const [wsConnected, setWsConnected] = useState(false)
	const [wsReconnecting, setWsReconnecting] = useState(false)
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
		const wsUrl = `${protocol}//${window.location.host}/api/ws/chat?session=${sessionId}`

		try {
			const ws = new WebSocket(wsUrl)

			ws.onopen = () => {
				setWsConnected(true)
				setWsReconnecting(false)

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
				reconnectTimerRef.current = setTimeout(() => {
					connect()
				}, RECONNECT_DELAY)
			}

			ws.onerror = () => {
				ws.close()
			}

			wsRef.current = ws
		} catch {
			setWsReconnecting(true)
			reconnectTimerRef.current = setTimeout(() => connect(), RECONNECT_DELAY)
		}
	}, [dispatch, startStreamTimeout, clearStreamTimeout, onSuggestions, onShowSmartSuggestions])

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
		return false
	}, [])

	return { wsRef, wsConnected, wsReconnecting, sendMessage }
}
