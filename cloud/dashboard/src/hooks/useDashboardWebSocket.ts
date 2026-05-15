"use client"

import { useState, useRef, useCallback, useEffect } from "react"

// ─── Configuration ──────────────────────────────────────────────────────────

const RECONNECT_DELAY = 3000
const PING_INTERVAL = 30000
const MAX_RECONNECT_ATTEMPTS = 10

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardWsMessage {
	type: "data" | "connected" | "subscribed" | "unsubscribed" | "pong" | "error"
	channel?: string
	data?: unknown
	timestamp?: number
	channels?: string[]
	message?: string
}

export type DashboardChannel =
	| "overview"
	| "jobs"
	| "auto-deploy"
	| "docker"
	| "github"
	| "healing"
	| "logs"
	| "monitoring"
	| "projects"
	| "queue"
	| "working-tree"
	| "telegram"

export interface UseDashboardWebSocketOptions {
	channels: DashboardChannel[]
	onData?: (channel: DashboardChannel, data: unknown) => void
	enabled?: boolean
}

export interface UseDashboardWebSocketReturn {
	connected: boolean
	reconnecting: boolean
	subscribe: (channels: DashboardChannel[]) => void
	unsubscribe: (channels: DashboardChannel[]) => void
	send: (msg: object) => boolean
}

// ─── WebSocket URL Resolution ───────────────────────────────────────────────

function getWsUrl(): string {
	if (typeof window === "undefined") return ""
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const host = window.location.host
	return `${protocol}//${host}/api/ws/dashboard`
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDashboardWebSocket({
	channels,
	onData,
	enabled = true,
}: UseDashboardWebSocketOptions): UseDashboardWebSocketReturn {
	const [connected, setConnected] = useState(false)
	const [reconnecting, setReconnecting] = useState(false)

	const wsRef = useRef<WebSocket | null>(null)
	const reconnectAttemptRef = useRef(0)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const onDataRef = useRef(onData)
	const channelsRef = useRef(channels)
	const enabledRef = useRef(enabled)
	const mountedRef = useRef(true)

	// Keep refs in sync
	onDataRef.current = onData
	channelsRef.current = channels
	enabledRef.current = enabled

	// ── Connect ──────────────────────────────────────────────────────────────

	const connect = useCallback(() => {
		if (!enabledRef.current || !mountedRef.current) return
		if (wsRef.current?.readyState === WebSocket.OPEN) return

		const url = getWsUrl()
		if (!url) return

		try {
			const ws = new WebSocket(url)
			wsRef.current = ws

			ws.onopen = () => {
				if (!mountedRef.current) {
					ws.close()
					return
				}
				setConnected(true)
				setReconnecting(false)
				reconnectAttemptRef.current = 0

				// Subscribe to requested channels
				if (channelsRef.current.length > 0) {
					ws.send(
						JSON.stringify({
							type: "subscribe",
							channels: channelsRef.current,
						}),
					)
				}

				// Start ping interval
				if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)
				pingIntervalRef.current = setInterval(() => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: "ping" }))
					}
				}, PING_INTERVAL)
			}

			ws.onmessage = (event) => {
				if (!mountedRef.current) return
				try {
					const msg: DashboardWsMessage = JSON.parse(event.data)
					handleMessage(msg)
				} catch (_) {
					// Ignore parse errors
				}
			}

			ws.onclose = () => {
				if (!mountedRef.current) return
				setConnected(false)
				if (pingIntervalRef.current) {
					clearInterval(pingIntervalRef.current)
					pingIntervalRef.current = null
				}
				scheduleReconnect()
			}

			ws.onerror = () => {
				// onclose will fire after this
			}
		} catch (_) {
			scheduleReconnect()
		}
	}, [])

	// ── Handle Messages ──────────────────────────────────────────────────────

	const handleMessage = useCallback((msg: DashboardWsMessage) => {
		switch (msg.type) {
			case "connected":
				// Initial connection confirmed
				break

			case "data":
				if (msg.channel && onDataRef.current) {
					onDataRef.current(msg.channel as DashboardChannel, msg.data)
				}
				break

			case "pong":
				// Heartbeat response, nothing to do
				break

			case "error":
				console.warn("[dash-ws] Server error:", msg.message)
				break
		}
	}, [])

	// ── Reconnect ────────────────────────────────────────────────────────────

	const scheduleReconnect = useCallback(() => {
		if (!enabledRef.current || !mountedRef.current) return
		if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) return

		setReconnecting(true)
		reconnectAttemptRef.current++

		const delay = RECONNECT_DELAY * Math.min(reconnectAttemptRef.current, 5)
		reconnectTimerRef.current = setTimeout(() => {
			if (mountedRef.current) connect()
		}, delay)
	}, [connect])

	// ── Subscribe / Unsubscribe ──────────────────────────────────────────────

	const subscribe = useCallback((newChannels: DashboardChannel[]) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "subscribe", channels: newChannels }))
		}
	}, [])

	const unsubscribe = useCallback((removeChannels: DashboardChannel[]) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "unsubscribe", channels: removeChannels }))
		}
	}, [])

	const send = useCallback((msg: object): boolean => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(msg))
			return true
		}
		return false
	}, [])

	// ── Lifecycle ────────────────────────────────────────────────────────────

	useEffect(() => {
		mountedRef.current = true
		if (enabled) {
			connect()
		}
		return () => {
			mountedRef.current = false
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current)
			}
			if (pingIntervalRef.current) {
				clearInterval(pingIntervalRef.current)
			}
			if (wsRef.current) {
				wsRef.current.close()
				wsRef.current = null
			}
		}
	}, [enabled, connect])

	return {
		connected,
		reconnecting,
		subscribe,
		unsubscribe,
		send,
	}
}
