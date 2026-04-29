/**
 * Super Roo — webview message client.
 *
 * Thin wrapper that posts SrWebviewMessage envelopes to the extension host
 * and listens for SrExtensionMessage replies. Subscribers register by message
 * type; the client routes incoming messages to all matching subscribers.
 *
 * We post messages by casting to `unknown` then to the underlying API type
 * because Roo's `vscode.postMessage` is typed against its own `WebviewMessage`
 * union. The extension host's Super Roo handler ignores anything that
 * doesn't have a `superRoo:*` prefix, so the cast is safe in practice.
 */

import type { SrExtensionMessage, SrWebviewMessage } from "./protocol"
import { isSrExtensionMessage } from "./protocol"

type Subscriber = (msg: SrExtensionMessage) => void

export interface VsCodeLike {
	postMessage(message: unknown): void
}

export class SrMessageClient {
	private subs = new Set<Subscriber>()
	private windowListener: ((event: MessageEvent) => void) | null = null

	constructor(private readonly vscode: VsCodeLike) {}

	start(): void {
		if (this.windowListener) return
		this.windowListener = (event: MessageEvent) => {
			const data = event.data as unknown
			if (!isSrExtensionMessage(data)) return
			for (const sub of this.subs) {
				try {
					sub(data)
				} catch (err) {
					// Don't let one subscriber break the others.
					// eslint-disable-next-line no-console
					console.error("[super-roo] subscriber threw", err)
				}
			}
		}
		window.addEventListener("message", this.windowListener)
	}

	stop(): void {
		if (!this.windowListener) return
		window.removeEventListener("message", this.windowListener)
		this.windowListener = null
		this.subs.clear()
	}

	send(msg: SrWebviewMessage): void {
		this.vscode.postMessage(msg)
	}

	subscribe(fn: Subscriber): () => void {
		this.subs.add(fn)
		return () => this.subs.delete(fn)
	}
}
