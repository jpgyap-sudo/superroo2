/**
 * RPC WebSocket Client — adapted from openvscode-server/src/vs/platform/remote/common/remoteAgentConnection.ts
 *
 * Replaces ad-hoc WebSocket message handling with typed RPC:
 *   - Request/response correlation
 *   - Automatic reconnection with exponential backoff
 *   - Promise-based API
 */

class RpcClient {
	constructor(url, options = {}) {
		this.url = url
		this.token = options.token || ""
		this.timeoutMs = options.timeoutMs || 30000
		this.reconnectInterval = options.reconnectInterval || 5000
		this.maxReconnectInterval = options.maxReconnectInterval || 30000
		this.ws = null
		this.pendingRequests = new Map()
		this.eventHandlers = new Map()
		this.messageId = 0
		this.closed = false
		this.reconnectTimer = null
		this.currentInterval = this.reconnectInterval
	}

	connect() {
		if (this.closed) return
		const urlWithToken = this.token ? `${this.url}?tkn=${this.token}` : this.url
		this.ws = new WebSocket(urlWithToken)

		this.ws.onopen = () => {
			console.log("[RpcClient] Connected")
			this.currentInterval = this.reconnectInterval
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer)
				this.reconnectTimer = null
			}
		}

		this.ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data)
				this._handleMessage(msg)
			} catch (err) {
				console.error("[RpcClient] Parse error:", err)
			}
		}

		this.ws.onclose = () => {
			console.log("[RpcClient] Disconnected")
			if (!this.closed) {
				this._scheduleReconnect()
			}
		}

		this.ws.onerror = (err) => {
			console.error("[RpcClient] Error:", err.message || "Unknown")
		}
	}

	_handleMessage(msg) {
		// Response to pending request
		if (msg.type === "response" && msg.reqId !== undefined) {
			const pending = this.pendingRequests.get(msg.reqId)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pendingRequests.delete(msg.reqId)
			if (msg.error) {
				pending.reject(new Error(msg.error))
			} else {
				pending.resolve(msg.result)
			}
			return
		}

		// Event from server
		if (msg.type === "event" && msg.event) {
			const handlers = this.eventHandlers.get(msg.event) || []
			handlers.forEach((h) => {
				try {
					h(msg.payload)
				} catch (err) {
					console.error("[RpcClient] Handler error:", err)
				}
			})
		}
	}

	_scheduleReconnect() {
		if (this.reconnectTimer || this.closed) return
		console.log(`[RpcClient] Reconnecting in ${this.currentInterval}ms...`)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.connect()
			this.currentInterval = Math.min(this.currentInterval * 2, this.maxReconnectInterval)
		}, this.currentInterval)
	}

	call(method, args) {
		if (this.closed) {
			return Promise.reject(new Error("Client is closed"))
		}
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error("WebSocket not connected"))
		}
		const reqId = ++this.messageId
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(reqId)
				reject(new Error(`RPC timeout: ${method}`))
			}, this.timeoutMs)

			this.pendingRequests.set(reqId, { resolve, reject, timer })
			this.ws.send(JSON.stringify({ type: "request", reqId, method, args }))
		})
	}

	on(event, handler) {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, [])
		}
		this.eventHandlers.get(event).push(handler)
		return () => {
			const arr = this.eventHandlers.get(event)
			const idx = arr.indexOf(handler)
			if (idx !== -1) arr.splice(idx, 1)
		}
	}

	close() {
		this.closed = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timer)
			pending.reject(new Error("Client closed"))
		}
		this.pendingRequests.clear()
		if (this.ws) {
			this.ws.close()
		}
	}
}

// ── Legacy broadcast compatibility wrapper ───────────────────────────────────
// So existing app.js code that does `ws.send(JSON.stringify(...))` still works
class LegacyWsBridge {
	constructor(rpcClient) {
		this.rpc = rpcClient
		this._listeners = new Map()
	}

	get readyState() {
		return this.rpc.ws ? this.rpc.ws.readyState : WebSocket.CLOSED
	}

	send(data) {
		// Legacy code sends strings; we just pass through if it's a raw string
		if (typeof data === "string") {
			this.rpc.ws?.send(data)
		} else {
			this.rpc.ws?.send(data)
		}
	}

	close() {
		this.rpc.close()
	}

	set onmessage(fn) {
		// Intercept RPC events and also forward raw messages
		this.rpc.on("terminal-output", (payload) => {
			fn({ data: JSON.stringify({ type: "terminal-output", ...payload }) })
		})
		this.rpc.on("pipeline-update", (payload) => {
			fn({ data: JSON.stringify({ type: "pipeline-update", ...payload }) })
		})
		this.rpc.on("log-entry", (payload) => {
			fn({ data: JSON.stringify({ type: "log-entry", ...payload }) })
		})
		this.rpc.on("connected", (payload) => {
			fn({ data: JSON.stringify({ type: "connected", ...payload }) })
		})
	}

	set onclose(fn) {
		if (this.rpc.ws) this.rpc.ws.onclose = fn
	}

	set onerror(fn) {
		if (this.rpc.ws) this.rpc.ws.onerror = fn
	}
}

// Helper to create from legacy connectWebSocket() usage
function createRpcConnection(workspaceId, token) {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const wsUrl = `${protocol}//${window.location.host}/ws?workspace=${workspaceId}`
	const rpc = new RpcClient(wsUrl, { token })
	rpc.connect()
	return new LegacyWsBridge(rpc)
}
