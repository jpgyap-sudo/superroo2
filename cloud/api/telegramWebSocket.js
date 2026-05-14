/**
 * Telegram WebSocket Events
 *
 * Provides real-time WebSocket events for Telegram task lifecycle updates.
 * The dashboard TelegramView subscribes to these events to show live
 * task status changes, new tasks, approvals, deployments, and rollbacks.
 *
 * Usage:
 *   const tgWs = require("./telegramWebSocket")
 *   tgWs.broadcast("task:created", { taskId: "TG-ABC123", status: "queued" })
 *   tgWs.broadcast("task:status", { taskId: "TG-ABC123", status: "approved" })
 *
 * Dashboard connects via: ws://host/api/ws/telegram
 */

const { WebSocketServer } = require("ws")

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000 // Send ping every 30 seconds
const CLIENT_TIMEOUT_MS = 60_000 // Disconnect if no pong in 60 seconds

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Set<WebSocket>} */
const clients = new Set()

/** @type {NodeJS.Timeout|null} */
let heartbeatTimer = null

// ---------------------------------------------------------------------------
// WebSocket Server
// ---------------------------------------------------------------------------

/** @type {WebSocketServer|null} */
let wss = null

/**
 * Initialize the Telegram WebSocket server.
 * Must be called with a noServer WebSocketServer instance.
 * @param {import("ws").Server} server - The parent HTTP server for upgrade handling
 * @param {string} path - The WebSocket path (default: /api/ws/telegram)
 */
function init(server, path) {
	if (wss) {
		console.warn("[tg-ws] WebSocket server already initialized")
		return
	}

	wss = new WebSocketServer({ noServer: true })

	wss.on("connection", (ws, req) => {
		const url = new URL(req.url || "", "http://localhost")
		const sessionId = url.searchParams.get("session") || "default"

		clients.add(ws)
		ws._tgSessionId = sessionId
		ws._tgAlive = true

		console.log(`[tg-ws] Client connected: session=${sessionId} (total: ${clients.size})`)

		// Send initial connection confirmation
		ws.send(
			JSON.stringify({
				type: "connected",
				service: "telegram",
				sessionId,
				timestamp: Date.now(),
			}),
		)

		// Handle pong responses for heartbeat
		ws.on("pong", () => {
			ws._tgAlive = true
		})

		// Handle incoming messages from dashboard
		ws.on("message", (raw) => {
			try {
				const msg = JSON.parse(raw.toString())
				handleClientMessage(ws, msg)
			} catch (err) {
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Invalid message format",
					}),
				)
			}
		})

		// Handle client disconnect
		ws.on("close", () => {
			clients.delete(ws)
			console.log(`[tg-ws] Client disconnected: session=${sessionId} (total: ${clients.size})`)
		})

		// Handle errors
		ws.on("error", (err) => {
			console.error(`[tg-ws] Client error:`, err.message)
			clients.delete(ws)
		})
	})

	// Start heartbeat to detect dead connections
	startHeartbeat()

	console.log(`[tg-ws] WebSocket server initialized on path=${path}`)
}

/**
 * Handle messages received from dashboard clients.
 * @param {WebSocket} ws
 * @param {object} msg
 */
function handleClientMessage(ws, msg) {
	switch (msg.type) {
		case "ping":
			ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }))
			break

		case "subscribe":
			// Client wants to subscribe to specific event types
			ws._tgSubscriptions = msg.events || []
			ws.send(
				JSON.stringify({
					type: "subscribed",
					events: ws._tgSubscriptions,
				}),
			)
			break

		case "unsubscribe":
			ws._tgSubscriptions = []
			ws.send(JSON.stringify({ type: "unsubscribed" }))
			break

		default:
			ws.send(
				JSON.stringify({
					type: "error",
					message: `Unknown message type: ${msg.type}`,
				}),
			)
	}
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer)
	}

	heartbeatTimer = setInterval(() => {
		for (const ws of clients) {
			if (!ws._tgAlive) {
				// Client didn't respond to last ping — terminate
				clients.delete(ws)
				ws.terminate()
				console.log(`[tg-ws] Terminated unresponsive client (total: ${clients.size})`)
				continue
			}

			ws._tgAlive = false
			ws.ping()
		}
	}, HEARTBEAT_INTERVAL_MS)

	if (heartbeatTimer.unref) {
		heartbeatTimer.unref()
	}
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/**
 * Broadcast an event to all connected WebSocket clients.
 * Optionally filter by session ID or subscription.
 * @param {string} event - Event type (e.g., "task:created", "task:status")
 * @param {object} data - Event payload
 * @param {string} [sessionId] - Optional session filter
 */
function broadcast(event, data, sessionId) {
	if (clients.size === 0) return

	const payload = JSON.stringify({
		type: "event",
		event,
		data,
		timestamp: Date.now(),
	})

	let sent = 0
	for (const ws of clients) {
		// Filter by session if specified
		if (sessionId && ws._tgSessionId !== sessionId) continue

		// Filter by subscription if client has set one
		if (ws._tgSubscriptions && ws._tgSubscriptions.length > 0) {
			if (!ws._tgSubscriptions.includes(event) && !ws._tgSubscriptions.includes("*")) continue
		}

		try {
			ws.send(payload)
			sent++
		} catch (err) {
			console.error(`[tg-ws] Failed to send to client:`, err.message)
			clients.delete(ws)
		}
	}

	if (sent > 0) {
		console.log(`[tg-ws] Broadcast ${event} to ${sent} client(s)`)
	}
}

/**
 * Broadcast a task lifecycle event.
 * @param {string} taskId
 * @param {string} status - New status
 * @param {object} [extra] - Additional data
 */
function broadcastTaskEvent(taskId, status, extra) {
	broadcast("task:" + status, {
		taskId,
		status,
		...extra,
		timestamp: Date.now(),
	})
}

/**
 * Broadcast a deployment event.
 * @param {string} taskId
 * @param {string} environment - "staging" or "production"
 * @param {string} status - "started", "completed", "failed"
 * @param {object} [extra]
 */
function broadcastDeployEvent(taskId, environment, status, extra) {
	broadcast("deploy:" + status, {
		taskId,
		environment,
		...extra,
		timestamp: Date.now(),
	})
}

/**
 * Broadcast a notification event (approval request, etc.).
 * @param {string} type - Notification type
 * @param {object} data
 */
function broadcastNotification(type, data) {
	broadcast("notification:" + type, {
		...data,
		timestamp: Date.now(),
	})
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get current WebSocket server stats.
 * @returns {{ connected: number, sessions: string[] }}
 */
function getStats() {
	const sessions = new Set()
	for (const ws of clients) {
		if (ws._tgSessionId) sessions.add(ws._tgSessionId)
	}
	return {
		connected: clients.size,
		sessions: Array.from(sessions),
	}
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Shutdown the WebSocket server and clean up.
 */
function shutdown() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer)
		heartbeatTimer = null
	}

	for (const ws of clients) {
		ws.close(1001, "Server shutting down")
	}
	clients.clear()

	if (wss) {
		wss.close()
		wss = null
	}

	console.log("[tg-ws] WebSocket server shut down")
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Get the internal WebSocketServer instance for upgrade handling.
 * @returns {WebSocketServer|null}
 */
function getWss() {
	return wss
}

module.exports = {
	init,
	broadcast,
	broadcastTaskEvent,
	broadcastDeployEvent,
	broadcastNotification,
	getStats,
	getWss,
	shutdown,
}
