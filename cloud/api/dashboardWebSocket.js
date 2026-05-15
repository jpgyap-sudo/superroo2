const ptyServer = require("./pty-server")

/**
 * Dashboard WebSocket — Real-Time Data Broadcasting
 *
 * Provides a generic WebSocket server for broadcasting dashboard data updates
 * to connected clients. Replaces polling-based data fetching with push-based
 * real-time updates.
 *
 * Usage:
 *   const dws = require("./dashboardWebSocket")
 *   dws.init(server, "/api/ws/dashboard")
 *   dws.broadcast("overview", { cpu: 45, ram: 60, ... })
 *   dws.broadcast("jobs", { jobs: [...], summary: {...} })
 *
 * Dashboard views subscribe to specific channels and receive updates
 * as soon as data changes, without polling.
 *
 * @typedef {import("ws").WebSocket & { _dashAlive: boolean, _dashSubscriptions: Set<string> }} DashWebSocket
 */

const { WebSocketServer } = require("ws")

// ─── Configuration ──────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 30000 // 30s ping interval
const CLIENT_TIMEOUT = 60000 // 60s without pong = disconnect

// ─── State ──────────────────────────────────────────────────────────────────

/** @type {WebSocketServer|null} */
let wss = null

/** @type {Map<string, Set<DashWebSocket>>} */
const subscribers = new Map() // channel -> Set<WebSocket>

/** @type {Set<DashWebSocket>} */
const allClients = new Set()

/** @type {Map<string, object>} */
const lastData = new Map() // channel -> last broadcast data

/** @type {ReturnType<typeof setInterval>|null} */
let heartbeatTimer = null

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the Dashboard WebSocket server.
 * @param {import("http").Server} server - The parent HTTP server
 * @param {string} path - WebSocket path (default: /api/ws/dashboard)
 */
function init(server, path = "/api/ws/dashboard") {
	if (wss) {
		console.warn("[dash-ws] WebSocket server already initialized")
		return
	}

	wss = new WebSocketServer({ noServer: true })

	wss.on("connection", (/** @type {DashWebSocket} */ ws, req) => {
		const url = new URL(req.url || "", "http://localhost")
		const clientIp = req.socket?.remoteAddress || "unknown"

		// Mark as alive for heartbeat
		ws._dashAlive = true
		ws._dashSubscriptions = new Set()
		allClients.add(ws)

		console.log(`[dash-ws] Client connected: ${clientIp} (total: ${allClients.size})`)

		// Send initial connection confirmation
		ws.send(JSON.stringify({ type: "connected", timestamp: Date.now() }))

		// Send any cached data for auto-subscribed channels
		for (const [channel, data] of lastData) {
			ws.send(JSON.stringify({ type: "data", channel, data }))
		}

		// Handle pong responses for heartbeat
		ws.on("pong", () => {
			ws._dashAlive = true
		})

		// Handle incoming messages (subscribe/unsubscribe)
		ws.on("message", (/** @type {Buffer|string} */ raw) => {
			try {
				/** @type {{ type: string, channels?: string[], [key: string]: any }} */
				const msg = JSON.parse(raw.toString())
				handleMessage(ws, msg)
			} catch (/** @type {any} */ err) {
				ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }))
			}
		})

		// Handle client disconnect
		ws.on("close", () => {
			allClients.delete(ws)
			// Remove from all channel subscriptions
			for (const [, clients] of subscribers) {
				clients.delete(ws)
			}
			console.log(`[dash-ws] Client disconnected (total: ${allClients.size})`)
		})

		// Handle errors
		ws.on("error", (/** @type {any} */ err) => {
			console.error(`[dash-ws] Client error:`, err.message)
			allClients.delete(ws)
			for (const [, clients] of subscribers) {
				clients.delete(ws)
			}
		})
	})

	// Start heartbeat
	heartbeatTimer = setInterval(() => {
		const now = Date.now()
		for (/** @type {DashWebSocket} */ const ws of allClients) {
			if (!ws._dashAlive) {
				// Client missed two heartbeats, terminate
				ws.terminate()
				allClients.delete(ws)
				continue
			}
			ws._dashAlive = false
			ws.ping()
		}
	}, HEARTBEAT_INTERVAL)

	if (heartbeatTimer && heartbeatTimer.unref) {
		heartbeatTimer.unref()
	}

	console.log(`[dash-ws] WebSocket server initialized on path=${path}`)
}

/**
 * Handle incoming messages from dashboard clients.
 * @param {DashWebSocket} ws
 * @param {{ type: string, channels?: string[] }} msg
 */
function handleMessage(ws, msg) {
	// Route PTY messages to the PTY server
	if (msg.type && msg.type.startsWith("pty:")) {
		ptyServer.handleMessage(ws, msg)
		return
	}

	switch (msg.type) {
		case "ping":
			ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }))
			break

		case "subscribe":
			if (Array.isArray(msg.channels)) {
				for (const channel of msg.channels) {
					if (typeof channel !== "string") continue
					ws._dashSubscriptions.add(channel)
					if (!subscribers.has(channel)) {
						subscribers.set(channel, new Set())
					}
					/** @type {Set<DashWebSocket>} */ subscribers.get(channel).add(ws)

					// Send cached data immediately if available
					if (lastData.has(channel)) {
						ws.send(
							JSON.stringify({
								type: "data",
								channel,
								data: lastData.get(channel),
							}),
						)
					}
				}
				ws.send(
					JSON.stringify({
						type: "subscribed",
						channels: Array.from(ws._dashSubscriptions),
					}),
				)
			}
			break

		case "unsubscribe":
			if (Array.isArray(msg.channels)) {
				for (const channel of msg.channels) {
					ws._dashSubscriptions.delete(channel)
					const clients = subscribers.get(channel)
					if (clients) {
						clients.delete(ws)
						if (clients.size === 0) {
							subscribers.delete(channel)
						}
					}
				}
				ws.send(JSON.stringify({ type: "unsubscribed" }))
			}
			break

		default:
			ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${msg.type}` }))
	}
}

// ─── Broadcasting ───────────────────────────────────────────────────────────

/**
 * Broadcast data to all clients subscribed to a channel.
 * @param {string} channel - The data channel name (e.g., "overview", "jobs", "docker")
 * @param {object} data - The data payload to broadcast
 * @returns {number} Number of clients the data was sent to
 */
function broadcast(channel, data) {
	if (!wss) return 0

	// Cache the last data for new subscribers
	lastData.set(channel, data)

	const clients = subscribers.get(channel)
	if (!clients || clients.size === 0) return 0

	const payload = JSON.stringify({ type: "data", channel, data, timestamp: Date.now() })
	let sent = 0

	for (/** @type {DashWebSocket} */ const ws of clients) {
		try {
			if (ws.readyState === 1) {
				// WebSocket.OPEN
				ws.send(payload)
				sent++
			}
		} catch (/** @type {any} */ err) {
			console.error(`[dash-ws] Broadcast error on channel ${channel}:`, err.message)
			clients.delete(ws)
		}
	}

	return sent
}

/**
 * Broadcast to ALL connected clients regardless of subscription.
 * Used for system-wide events.
 * @param {string} channel
 * @param {object} data
 */
function broadcastAll(channel, data) {
	if (!wss) return

	const payload = JSON.stringify({ type: "data", channel, data, timestamp: Date.now() })
	let sent = 0

	for (/** @type {DashWebSocket} */ const ws of allClients) {
		try {
			if (ws.readyState === 1) {
				ws.send(payload)
				sent++
			}
		} catch (/** @type {any} */ err) {
			console.error(`[dash-ws] BroadcastAll error:`, err.message)
		}
	}

	return sent
}

// ─── Stats & Management ─────────────────────────────────────────────────────

/**
 * Get current WebSocket server stats.
 * @returns {{ connected: number, channels: number, subscriptions: Record<string, number> }}
 */
function getStats() {
	/** @type {Record<string, number>} */
	const channelStats = {}
	for (const [channel, clients] of subscribers) {
		channelStats[channel] = clients.size
	}

	return {
		connected: allClients.size,
		channels: subscribers.size,
		subscriptions: channelStats,
	}
}

/**
 * Shutdown the WebSocket server and clean up.
 */
function shutdown() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer)
		heartbeatTimer = null
	}

	if (wss) {
		for (/** @type {DashWebSocket} */ const ws of allClients) {
			try {
				ws.close(1001, "Server shutting down")
			} catch (_) {
				// ignore
			}
		}
		allClients.clear()
		subscribers.clear()
		lastData.clear()
		wss.close()
		wss = null
	}

	console.log("[dash-ws] WebSocket server shut down")
}

/**
 * Get the internal WebSocketServer instance for upgrade handling.
 * @returns {WebSocketServer|null}
 */
function getWss() {
	return wss
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	init,
	broadcast,
	broadcastAll,
	getStats,
	shutdown,
	getWss,
}
