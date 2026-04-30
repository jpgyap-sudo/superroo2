/**
 * Super Roo — Event log.
 *
 * Append-only structured event stream. Two consumers:
 *
 *   1. Persistent: every event is written to the `events` SQLite table via
 *      MemoryStore.insertEvent. Phase 3's dashboard reads this table.
 *
 *   2. Live: in-process subscribers can `subscribe(fn)` to receive events
 *      synchronously as they are emitted. This is how the future dashboard
 *      tab and Telegram bot get real-time updates without polling.
 *
 * The module is deliberately minimal — no log rotation, no async batching, no
 * external transports. Phase 1 needs nothing more.
 */

import { v4 as uuidv4 } from "uuid"

import type { MemoryStore } from "../memory/MemoryStore"
import type { EventLevel, EventType, LogEvent } from "../types"

export type EventSubscriber = (ev: LogEvent) => void

export interface EventLogOptions {
	/**
	 * If true, also forwards events to console.log/warn/error for debugging.
	 * Off by default to keep test output clean.
	 */
	mirrorToConsole?: boolean
}

export class EventLog {
	private subscribers = new Set<EventSubscriber>()
	private mirror: boolean

	constructor(
		private readonly memory: MemoryStore,
		opts: EventLogOptions = {},
	) {
		this.mirror = opts.mirrorToConsole ?? false
	}

	emit(
		level: EventLevel,
		type: EventType,
		message: string,
		extra: {
			taskId?: string
			agent?: string
			featureId?: string
			bugId?: string
			data?: Record<string, unknown>
		} = {},
	): LogEvent {
		const ev: LogEvent = {
			id: uuidv4(),
			at: Date.now(),
			level,
			type,
			message,
			...extra,
		}

		// Persistence first — if a subscriber throws, we still want the event saved.
		try {
			this.memory.insertEvent(ev)
		} catch (err) {
			// Last-resort warning; never let logging itself crash the orchestrator.
			console.warn("[super-roo/logging] failed to persist event", err)
		}

		if (this.mirror) {
			const fn =
				level === "error" ? console.error : level === "warn" ? console.warn : console.log
			fn(`[super-roo:${type}] ${message}`, extra.data ?? "")
		}

		// Subscribers are isolated from each other so one bad listener can't break the rest.
		for (const sub of this.subscribers) {
			try {
				sub(ev)
			} catch (err) {
				console.warn("[super-roo/logging] subscriber threw", err)
			}
		}

		return ev
	}

	debug(type: EventType, message: string, extra?: Parameters<EventLog["emit"]>[3]): LogEvent {
		return this.emit("debug", type, message, extra)
	}
	info(type: EventType, message: string, extra?: Parameters<EventLog["emit"]>[3]): LogEvent {
		return this.emit("info", type, message, extra)
	}
	warn(type: EventType, message: string, extra?: Parameters<EventLog["emit"]>[3]): LogEvent {
		return this.emit("warn", type, message, extra)
	}
	error(type: EventType, message: string, extra?: Parameters<EventLog["emit"]>[3]): LogEvent {
		return this.emit("error", type, message, extra)
	}

	subscribe(fn: EventSubscriber): () => void {
		this.subscribers.add(fn)
		return () => this.subscribers.delete(fn)
	}

	/** Read recent events from the persistent store. */
	recent(opts: Parameters<MemoryStore["listEvents"]>[0] = {}): LogEvent[] {
		return this.memory.listEvents(opts)
	}
}
