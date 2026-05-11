/**
 * Super Roo — Log Aggregator.
 *
 * Central log aggregation system that collects log entries from multiple
 * sources (VS Code extension, Cloud API, Cloud Worker, Dashboard), buffers
 * them in memory, and flushes to JSONL files with auto-rotation.
 *
 * Features:
 *   - Accepts log entries from multiple sources
 *   - Buffers entries in memory with periodic flush
 *   - Writes to JSONL files (logs/superroo-YYYY-MM-DD.jsonl)
 *   - Supports filtering by source, level, time range
 *   - Provides query() method for retrieving logs
 *   - Auto-rotation: keeps last N days of logs
 */

import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import { v4 as uuidv4 } from "uuid"

// ── Types ────────────────────────────────────────────────────────────────────────

export type LogSource = "extension" | "cloud-api" | "cloud-worker" | "dashboard" | "healing" | "ml" | "agent" | "system"

export type LogLevel = "debug" | "info" | "warn" | "error" | "success"

export interface LogEntry {
	/** Unique identifier */
	id: string
	/** Unix timestamp (ms) when the log was created */
	timestamp: number
	/** Source of the log entry */
	source: LogSource
	/** Log severity level */
	level: LogLevel
	/** Human-readable log message */
	message: string
	/** Optional structured metadata */
	metadata?: Record<string, unknown>
}

export interface LogQueryOptions {
	/** Filter by source(s) */
	source?: LogSource | LogSource[]
	/** Filter by level(s) */
	level?: LogLevel | LogLevel[]
	/** Start of time range (inclusive, Unix ms) */
	from?: number
	/** End of time range (inclusive, Unix ms) */
	to?: number
	/** Maximum number of results (default: 100, max: 1000) */
	limit?: number
	/** Offset for pagination */
	offset?: number
	/** Search string in message */
	search?: string
}

export interface LogQueryResult {
	entries: LogEntry[]
	total: number
	filtered: number
	hasMore: boolean
}

export interface LogAggregatorConfig {
	/** Directory to store log files (default: logs/) */
	logsDir?: string
	/** Flush interval in ms (default: 5000) */
	flushIntervalMs?: number
	/** Max buffer size before forced flush (default: 100) */
	maxBufferSize?: number
	/** Number of days to keep logs (default: 30) */
	retentionDays?: number
}

// ── Defaults ─────────────────────────────────────────────────────────────────────

const DEFAULT_LOGS_DIR = path.resolve(process.cwd(), "logs")
const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_RETENTION_DAYS = 30

// ── LogAggregator ────────────────────────────────────────────────────────────────

export class LogAggregator {
	private buffer: LogEntry[] = []
	private config: Required<LogAggregatorConfig>
	private flushTimer: ReturnType<typeof setInterval> | null = null
	private flushPromise: Promise<void> | null = null

	constructor(config: LogAggregatorConfig = {}) {
		this.config = {
			logsDir: config.logsDir ?? DEFAULT_LOGS_DIR,
			flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
			maxBufferSize: config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
			retentionDays: config.retentionDays ?? DEFAULT_RETENTION_DAYS,
		}
	}

	// ── Public API ──────────────────────────────────────────────────────────────

	/**
	 * Start the aggregator. Begins the periodic flush timer.
	 * Safe to call multiple times.
	 */
	start(): void {
		if (this.flushTimer) return
		this.flushTimer = setInterval(() => {
			this.flush().catch((err) => {
				console.error("[LogAggregator] Periodic flush failed:", err)
			})
		}, this.config.flushIntervalMs)

		// Run retention cleanup on start
		this.cleanupOldLogs().catch((err) => {
			console.error("[LogAggregator] Retention cleanup failed:", err)
		})
	}

	/**
	 * Stop the aggregator. Flushes remaining entries and clears the timer.
	 */
	async stop(): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer)
			this.flushTimer = null
		}
		await this.flush()
	}

	/**
	 * Accept a log entry from any source.
	 * Buffers the entry and flushes if buffer exceeds maxBufferSize.
	 */
	log(source: LogSource, level: LogLevel, message: string, metadata?: Record<string, unknown>): LogEntry {
		const entry: LogEntry = {
			id: uuidv4(),
			timestamp: Date.now(),
			source,
			level,
			message,
			metadata,
		}

		this.buffer.push(entry)

		// Force flush if buffer is too large
		if (this.buffer.length >= this.config.maxBufferSize) {
			// Fire-and-forget flush (don't await to avoid blocking caller)
			this.flush().catch((err) => {
				console.error("[LogAggregator] Buffer overflow flush failed:", err)
			})
		}

		return entry
	}

	/**
	 * Convenience methods for common log levels.
	 */
	debug(source: LogSource, message: string, metadata?: Record<string, unknown>): LogEntry {
		return this.log(source, "debug", message, metadata)
	}

	info(source: LogSource, message: string, metadata?: Record<string, unknown>): LogEntry {
		return this.log(source, "info", message, metadata)
	}

	warn(source: LogSource, message: string, metadata?: Record<string, unknown>): LogEntry {
		return this.log(source, "warn", message, metadata)
	}

	error(source: LogSource, message: string, metadata?: Record<string, unknown>): LogEntry {
		return this.log(source, "error", message, metadata)
	}

	success(source: LogSource, message: string, metadata?: Record<string, unknown>): LogEntry {
		return this.log(source, "success", message, metadata)
	}

	/**
	 * Query logs with filtering.
	 * Searches both the in-memory buffer and persisted JSONL files.
	 */
	async query(options: LogQueryOptions = {}): Promise<LogQueryResult> {
		const { source, level, from, to, limit = 100, offset = 0, search } = options

		const effectiveLimit = Math.min(limit, 1000)

		// Collect entries from persisted files
		const persistedEntries = await this.readPersistedLogs(from, to)

		// Combine with buffer entries
		const allEntries = [...persistedEntries, ...this.buffer]

		// Apply filters
		let filtered = allEntries

		if (source) {
			const sources = Array.isArray(source) ? source : [source]
			filtered = filtered.filter((e) => sources.includes(e.source))
		}

		if (level) {
			const levels = Array.isArray(level) ? level : [level]
			filtered = filtered.filter((e) => levels.includes(e.level))
		}

		if (from !== undefined) {
			filtered = filtered.filter((e) => e.timestamp >= from)
		}

		if (to !== undefined) {
			filtered = filtered.filter((e) => e.timestamp <= to)
		}

		if (search) {
			const q = search.toLowerCase()
			filtered = filtered.filter(
				(e) =>
					e.message.toLowerCase().includes(q) ||
					e.source.toLowerCase().includes(q) ||
					e.level.toLowerCase().includes(q),
			)
		}

		// Sort by timestamp descending (newest first)
		filtered.sort((a, b) => b.timestamp - a.timestamp)

		const total = filtered.length
		const sliced = filtered.slice(offset, offset + effectiveLimit)

		return {
			entries: sliced,
			total,
			filtered: sliced.length,
			hasMore: offset + effectiveLimit < total,
		}
	}

	/**
	 * Get system stats for the monitoring dashboard.
	 */
	async getStats(): Promise<{
		totalLogs: number
		logsBySource: Record<string, number>
		logsByLevel: Record<string, number>
		recentErrors: number
		lastFlush: string | null
		bufferSize: number
	}> {
		const now = Date.now()
		const last24h = now - 24 * 60 * 60 * 1000

		const recentEntries = await this.readPersistedLogs(last24h, now)
		const allRecent = [...recentEntries, ...this.buffer]

		const logsBySource: Record<string, number> = {}
		const logsByLevel: Record<string, number> = {}
		let recentErrors = 0

		for (const entry of allRecent) {
			logsBySource[entry.source] = (logsBySource[entry.source] || 0) + 1
			logsByLevel[entry.level] = (logsByLevel[entry.level] || 0) + 1
			if (entry.level === "error") recentErrors++
		}

		return {
			totalLogs: allRecent.length,
			logsBySource,
			logsByLevel,
			recentErrors,
			lastFlush: null, // Could track last flush time
			bufferSize: this.buffer.length,
		}
	}

	// ── Internal: Flush ────────────────────────────────────────────────────────

	/**
	 * Flush buffered entries to the current day's JSONL file.
	 * Uses a lock to prevent concurrent flushes.
	 */
	async flush(): Promise<void> {
		if (this.buffer.length === 0) return

		// If a flush is already in progress, wait for it
		if (this.flushPromise) {
			await this.flushPromise
			return
		}

		this.flushPromise = this.doFlush()
		try {
			await this.flushPromise
		} finally {
			this.flushPromise = null
		}
	}

	private async doFlush(): Promise<void> {
		const entries = this.buffer.splice(0, this.buffer.length)
		if (entries.length === 0) return

		const logFile = this.getCurrentLogFilePath()

		try {
			// Ensure directory exists
			await fs.mkdir(this.config.logsDir, { recursive: true })

			// Append each entry as a JSONL line
			const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
			await fs.appendFile(logFile, lines, "utf-8")
		} catch (err) {
			// Put entries back in buffer on failure
			this.buffer.unshift(...entries)
			console.error("[LogAggregator] Flush failed:", err)
		}
	}

	// ── Internal: Read persisted logs ───────────────────────────────────────────

	/**
	 * Read log entries from persisted JSONL files within the given time range.
	 */
	private async readPersistedLogs(from?: number, to?: number): Promise<LogEntry[]> {
		const entries: LogEntry[] = []
		const files = await this.getRelevantLogFiles(from, to)

		for (const file of files) {
			try {
				const content = await fs.readFile(file, "utf-8")
				const lines = content.split("\n").filter((l) => l.trim().length > 0)

				for (const line of lines) {
					try {
						const entry = JSON.parse(line) as LogEntry
						// Apply time range filter at file level
						if (from !== undefined && entry.timestamp < from) continue
						if (to !== undefined && entry.timestamp > to) continue
						entries.push(entry)
					} catch {
						// Skip malformed lines
						continue
					}
				}
			} catch {
				// Skip unreadable files
				continue
			}
		}

		return entries
	}

	/**
	 * Get the list of log files that could contain entries within the time range.
	 */
	private async getRelevantLogFiles(from?: number, to?: number): Promise<string[]> {
		try {
			const allFiles = await fs.readdir(this.config.logsDir)
			const logFiles = allFiles
				.filter((f) => f.startsWith("superroo-") && f.endsWith(".jsonl"))
				.sort()
				.map((f) => path.join(this.config.logsDir, f))

			if (!from && !to) {
				// Return all files (up to retention limit)
				return logFiles.slice(-this.config.retentionDays)
			}

			// Filter files by date range based on filename
			return logFiles.filter((file) => {
				const basename = path.basename(file)
				const dateStr = basename.replace("superroo-", "").replace(".jsonl", "")
				const fileDate = new Date(dateStr).getTime()

				if (isNaN(fileDate)) return true // Include files with unparseable dates

				if (from !== undefined && fileDate < from - 86400000) return false
				if (to !== undefined && fileDate > to + 86400000) return false

				return true
			})
		} catch {
			return []
		}
	}

	// ── Internal: Rotation / Cleanup ────────────────────────────────────────────

	/**
	 * Remove log files older than retentionDays.
	 */
	private async cleanupOldLogs(): Promise<void> {
		try {
			const allFiles = await fs.readdir(this.config.logsDir)
			const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000

			for (const file of allFiles) {
				if (!file.startsWith("superroo-") || !file.endsWith(".jsonl")) continue

				const dateStr = file.replace("superroo-", "").replace(".jsonl", "")
				const fileDate = new Date(dateStr).getTime()

				if (!isNaN(fileDate) && fileDate < cutoff) {
					await fs.unlink(path.join(this.config.logsDir, file)).catch(() => {
						// Ignore deletion errors
					})
				}
			}
		} catch {
			// Ignore cleanup errors
		}
	}

	/**
	 * Get the file path for today's log file.
	 */
	private getCurrentLogFilePath(): string {
		const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
		return path.join(this.config.logsDir, `superroo-${dateStr}.jsonl`)
	}
}

// ── Singleton ────────────────────────────────────────────────────────────────────

let globalInstance: LogAggregator | null = null

/**
 * Get or create the global LogAggregator singleton.
 */
export function getLogAggregator(config?: LogAggregatorConfig): LogAggregator {
	if (!globalInstance) {
		globalInstance = new LogAggregator(config)
		globalInstance.start()
	}
	return globalInstance
}
