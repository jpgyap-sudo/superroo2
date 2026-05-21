/**
 * Typed RPC Channel — adapted from openvscode-server/src/vs/platform/remote/common/remoteAgentConnection.ts
 *
 * Replaces ad-hoc WebSocket messages with a structured RPC protocol.
 * Supports: request/response correlation, reconnection tokens, timeouts.
 */

const crypto = require("crypto")

class RpcChannel {
	constructor(ws, options = {}) {
		this.ws = ws
		this.reconnectionToken = options.reconnectionToken || crypto.randomUUID()
		this.timeoutMs = options.timeoutMs || 30000
		this.pendingRequests = new Map() // id -> { resolve, reject, timer }
		this.eventHandlers = new Map() // eventName -> handler[]
		this.closed = false
		this.messageId = 0

		ws.on("message", (data) => this._onMessage(data))
		ws.on("close", () => this._onClose())
		ws.on("error", (err) => this._onError(err))
	}

	_onMessage(data) {
		let msg
		try {
			msg = JSON.parse(data)
		} catch {
			return
		}

		// Response to a pending request
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
					console.error("[RpcChannel] Event handler error:", err)
				}
			})
			return
		}

		// Incoming request (server calling client)
		if (msg.type === "request" && msg.method) {
			this._handleIncomingRequest(msg)
		}
	}

	async _handleIncomingRequest(msg) {
		// Override in subclass to handle server->client calls
		this.sendResponse(msg.reqId, null, "Method not implemented")
	}

	_onClose() {
		this.closed = true
		// Reject all pending requests
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timer)
			pending.reject(new Error("WebSocket closed"))
		}
		this.pendingRequests.clear()
	}

	_onError(err) {
		console.error("[RpcChannel] WS error:", err.message)
	}

	call(method, args) {
		if (this.closed) {
			return Promise.reject(new Error("Channel is closed"))
		}
		const reqId = ++this.messageId
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(reqId)
				reject(new Error(`RPC timeout: ${method}`))
			}, this.timeoutMs)

			this.pendingRequests.set(reqId, { resolve, reject, timer })
			this._send({ type: "request", reqId, method, args })
		})
	}

	sendResponse(reqId, result, error) {
		this._send({ type: "response", reqId, result, error })
	}

	emitEvent(event, payload) {
		this._send({ type: "event", event, payload })
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

	_send(msg) {
		if (this.ws.readyState === 1) {
			this.ws.send(JSON.stringify(msg))
		}
	}

	dispose() {
		this.closed = true
		if (this.ws.readyState <= 1) {
			this.ws.close()
		}
	}
}

module.exports = { RpcChannel }
