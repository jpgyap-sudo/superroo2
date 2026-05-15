/**
 * Log Rotator
 *
 * Automatic log rotation for JSONL log files.
 * Prevents unbounded disk usage by rotating, compressing, and pruning old logs.
 *
 * Features:
 * - Max file size rotation (default: 50MB per file)
 * - Max age retention (default: 30 days)
 * - Max file count retention (default: 100 files)
 * - Automatic gzip compression of rotated files
 * - Configurable via environment variables
 * - Graceful shutdown support
 *
 * Usage:
 *   const logRotator = require("./logRotator")
 *   logRotator.start() // Starts periodic rotation checks
 *   logRotator.stop()  // Stops rotation (on shutdown)
 */

const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const { promisify } = require("util")

const gzip = promisify(zlib.gzip)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LOGS_DIR = process.env.LOGS_DIR || path.resolve(__dirname, "..", "..", "logs")
const MAX_FILE_SIZE_MB = parseInt(process.env.LOG_MAX_FILE_SIZE_MB || "50", 10)
const MAX_AGE_DAYS = parseInt(process.env.LOG_MAX_AGE_DAYS || "30", 10)
const MAX_FILES = parseInt(process.env.LOG_MAX_FILES || "100", 10)
const CHECK_INTERVAL_MS = parseInt(process.env.LOG_ROTATE_INTERVAL_MS || "3600000", 10) // 1 hour

const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof setInterval>|null} */
let rotationTimer = null
let isRunning = false

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get all JSONL log files in the logs directory, sorted by name.
 * @returns {string[]} Array of full file paths
 */
function getLogFiles() {
	try {
		if (!fs.existsSync(LOGS_DIR)) {
			fs.mkdirSync(LOGS_DIR, { recursive: true })
			return []
		}
		return fs
			.readdirSync(LOGS_DIR)
			.filter((f) => f.startsWith("superroo-") && (f.endsWith(".jsonl") || f.endsWith(".jsonl.gz")))
			.sort()
			.map((f) => path.join(LOGS_DIR, f))
	} catch (/** @type {any} */ err) {
		console.error("[log-rotator] Error listing log files:", err.message)
		return []
	}
}

/**
 * Get the size of a file in bytes.
 * @param {string} filePath
 * @returns {number}
 */
function getFileSize(filePath) {
	try {
		const stat = fs.statSync(filePath)
		return stat.size
	} catch {
		return 0
	}
}

/**
 * Get the age of a file in milliseconds.
 * @param {string} filePath
 * @returns {number}
 */
function getFileAge(filePath) {
	try {
		const stat = fs.statSync(filePath)
		return Date.now() - stat.mtimeMs
	} catch {
		return 0
	}
}

/**
 * Compress a file with gzip.
 * @param {string} sourcePath
 * @param {string} destPath
 */
async function compressFile(sourcePath, destPath) {
	try {
		const content = fs.readFileSync(sourcePath)
		const compressed = await gzip(content)
		fs.writeFileSync(destPath, compressed)
		fs.unlinkSync(sourcePath)
		return true
	} catch (/** @type {any} */ err) {
		console.error(`[log-rotator] Failed to compress ${sourcePath}:`, err.message)
		return false
	}
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Rotation Logic
// ---------------------------------------------------------------------------

/**
 * Rotate a single log file if it exceeds the max size.
 * Renames the current file with a timestamp suffix and compresses it.
 * @param {string} filePath
 * @returns {Promise<boolean>} Whether rotation occurred
 */
async function rotateFile(filePath) {
	const size = getFileSize(filePath)
	if (size < MAX_FILE_SIZE_BYTES) {
		return false
	}

	const dir = path.dirname(filePath)
	const basename = path.basename(filePath, ".jsonl")
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const rotatedPath = path.join(dir, `${basename}-${timestamp}.jsonl`)

	try {
		// Rename current file to rotated name
		fs.renameSync(filePath, rotatedPath)
		console.log(`[log-rotator] Rotated ${basename}.jsonl (${formatBytes(size)}) → ${path.basename(rotatedPath)}`)

		// Compress the rotated file
		const compressedPath = rotatedPath + ".gz"
		await compressFile(rotatedPath, compressedPath)
		console.log(`[log-rotator] Compressed → ${path.basename(compressedPath)}`)

		return true
	} catch (/** @type {any} */ err) {
		console.error(`[log-rotator] Failed to rotate ${filePath}:`, err.message)
		return false
	}
}

/**
 * Prune old log files based on age and count.
 * Removes files older than MAX_AGE_DAYS and keeps at most MAX_FILES.
 */
function pruneOldFiles() {
	const files = getLogFiles()

	// Remove files older than max age
	let pruned = 0
	for (const file of files) {
		const age = getFileAge(file)
		if (age > MAX_AGE_MS) {
			try {
				fs.unlinkSync(file)
				console.log(`[log-rotator] Pruned old file: ${path.basename(file)} (${formatBytes(getFileSize(file))})`)
				pruned++
			} catch (/** @type {any} */ err) {
				console.error(`[log-rotator] Failed to prune ${file}:`, err.message)
			}
		}
	}

	// If still over max files, remove oldest
	const remaining = getLogFiles()
	if (remaining.length > MAX_FILES) {
		const toRemove = remaining.length - MAX_FILES
		for (let i = 0; i < toRemove; i++) {
			try {
				fs.unlinkSync(remaining[i])
				console.log(`[log-rotator] Pruned excess file: ${path.basename(remaining[i])}`)
				pruned++
			} catch (/** @type {any} */ err) {
				console.error(`[log-rotator] Failed to prune ${remaining[i]}:`, err.message)
			}
		}
	}

	if (pruned > 0) {
		console.log(`[log-rotator] Pruned ${pruned} old/excess log files`)
	}

	return pruned
}

/**
 * Run a full rotation cycle: rotate oversized files, then prune old ones.
 */
async function runRotationCycle() {
	if (isRunning) return
	isRunning = true

	try {
		const files = getLogFiles()

		// Rotate oversized files
		let rotated = 0
		for (const file of files) {
			if (file.endsWith(".jsonl") && !file.endsWith(".gz")) {
				const didRotate = await rotateFile(file)
				if (didRotate) rotated++
			}
		}

		// Prune old files
		const pruned = pruneOldFiles()

		if (rotated > 0 || pruned > 0) {
			const stats = getStats()
			console.log(
				`[log-rotator] Cycle complete: ${rotated} rotated, ${pruned} pruned | ` +
					`${stats.fileCount} files, ${stats.totalSize}`,
			)
		}
	} catch (/** @type {any} */ err) {
		console.error("[log-rotator] Rotation cycle error:", err.message)
	} finally {
		isRunning = false
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the log rotation scheduler.
 * Runs immediately, then every CHECK_INTERVAL_MS.
 */
function start() {
	if (rotationTimer) {
		console.log("[log-rotator] Already running")
		return
	}

	console.log(
		`[log-rotator] Starting (max ${MAX_FILE_SIZE_MB}MB/file, ${MAX_AGE_DAYS}d retention, ${MAX_FILES} max files, check every ${CHECK_INTERVAL_MS / 1000}s)`,
	)

	// Run immediately
	runRotationCycle().catch((err) => {
		console.error("[log-rotator] Initial rotation failed:", err.message)
	})

	// Schedule periodic checks
	rotationTimer = setInterval(() => {
		runRotationCycle().catch((err) => {
			console.error("[log-rotator] Scheduled rotation failed:", err.message)
		})
	}, CHECK_INTERVAL_MS)

	if (rotationTimer.unref) {
		rotationTimer.unref()
	}
}

/**
 * Stop the log rotation scheduler.
 */
function stop() {
	if (rotationTimer) {
		clearInterval(rotationTimer)
		rotationTimer = null
		console.log("[log-rotator] Stopped")
	}
}

/**
 * Run a single rotation cycle immediately (for manual/API trigger).
 */
async function rotateNow() {
	await runRotationCycle()
	return getStats()
}

/**
 * Get statistics about the current log state.
 * @returns {{ fileCount: number, totalSize: string, totalBytes: number, oldestFile: string|null, newestFile: string|null, maxFileSize: string, maxAgeDays: number, maxFiles: number }}
 */
function getStats() {
	const files = getLogFiles()
	let totalBytes = 0
	let oldest = null
	let newest = null

	for (const file of files) {
		const size = getFileSize(file)
		totalBytes += size
		const age = getFileAge(file)
		if (oldest === null || age > oldest.age) {
			oldest = { name: path.basename(file), age, size }
		}
		if (newest === null || age < newest.age) {
			newest = { name: path.basename(file), age, size }
		}
	}

	return {
		fileCount: files.length,
		totalSize: formatBytes(totalBytes),
		totalBytes,
		oldestFile: oldest ? `${oldest.name} (${formatBytes(oldest.size)})` : null,
		newestFile: newest ? `${newest.name} (${formatBytes(newest.size)})` : null,
		maxFileSize: formatBytes(MAX_FILE_SIZE_BYTES),
		maxAgeDays: MAX_AGE_DAYS,
		maxFiles: MAX_FILES,
	}
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	start,
	stop,
	rotateNow,
	runRotationCycle,
	getStats,
	getLogFiles,
}
