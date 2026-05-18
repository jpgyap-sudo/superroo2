/**
 * NoopEventLog — Lightweight EventLog stub for the VS Code extension context.
 *
 * The full EventLog class requires a MemoryStore backed by SQLite (better-sqlite3),
 * which is too heavy for the VS Code extension environment. This stub satisfies
 * the same interface but logs to console only, with no persistence or subscriptions.
 *
 * Used by ModelUsageTracker and WorkflowEnforcer when initialized from extension.ts.
 */

import type { EventLog } from "../logging/EventLog"

type EventLevel = "debug" | "info" | "warn" | "error"
type EventType = string

/**
 * Lightweight EventLog stub that doesn't require SQLite/MemoryStore.
 *
 * Only the methods actually used by ModelUsageTracker and WorkflowEnforcer
 * are implemented. The full EventLog interface includes `subscribe()` and
 * `recent()` which are never called by the product-memory modules.
 */
export class NoopEventLog {
	emit(level: EventLevel, type: EventType, message: string, extra?: Record<string, unknown>): void {
		const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log
		fn(`[super-roo:${type}] ${message}`, extra?.data ?? "")
	}

	debug(type: EventType, message: string, extra?: Record<string, unknown>): void {
		this.emit("debug", type, message, extra)
	}

	info(type: EventType, message: string, extra?: Record<string, unknown>): void {
		this.emit("info", type, message, extra)
	}

	warn(type: EventType, message: string, extra?: Record<string, unknown>): void {
		this.emit("warn", type, message, extra)
	}

	error(type: EventType, message: string, extra?: Record<string, unknown>): void {
		this.emit("error", type, message, extra)
	}
}
