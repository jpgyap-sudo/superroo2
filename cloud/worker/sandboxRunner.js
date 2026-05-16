/**
 * SuperRoo Cloud — Sandbox Runner
 *
 * Executes job commands inside an isolated Docker container.
 * NEVER runs commands directly on the host.
 *
 * Crash resilience features:
 * - Configurable job timeout (default 10 min) to prevent runaway containers
 * - OOM protection with --memory-swap and --oom-kill-disable
 * - Zombie container cleanup on timeout or error
 * - Retry logic with exponential backoff for transient failures
 * - Graceful shutdown via SIGTERM propagation
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = process.env.SUPERROO_ROOT || "/opt/superroo2"
const SANDBOX_DIR = path.join(PROJECT_ROOT, "cloud", "sandbox")
const JOBS_DIR = path.join(SANDBOX_DIR, "jobs")
const LOGS_DIR = path.join(PROJECT_ROOT, "cloud", "logs", "jobs")
const IMAGE_NAME = process.env.SANDBOX_IMAGE || "superroo-sandbox:latest"

// ── Crash resilience configuration ────────────────────────────────────────────

/** Maximum time a single job can run before being killed (default: 10 min). */
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || "600000", 10)

/** Maximum retries for transient Docker failures. */
const MAX_RETRIES = parseInt(process.env.SANDBOX_MAX_RETRIES || "2", 10)

/** Base delay (ms) for exponential backoff between retries. */
const RETRY_BASE_DELAY_MS = parseInt(process.env.SANDBOX_RETRY_BASE_DELAY_MS || "2000", 10)

/** Memory limit per sandbox container (default: 512 MB). */
const CONTAINER_MEMORY = process.env.SANDBOX_MEMORY || "512m"

/** Memory + swap limit (same as memory = no swap, prevents OOM thrashing). */
const CONTAINER_MEMORY_SWAP = process.env.SANDBOX_MEMORY_SWAP || "512m"

/** CPU limit per sandbox container. */
const CONTAINER_CPUS = process.env.SANDBOX_CPUS || "1"

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Block dangerous commands that must never run inside or outside the sandbox.
 */
function isDangerousCommand(cmd) {
	const lower = cmd.toLowerCase()
	const forbidden = [
		"rm -rf /",
		"rm -rf /*",
		"shutdown",
		"reboot",
		"halt",
		"poweroff",
		"mkfs",
		"dd if=/dev/zero",
		":(){ :|:& };:", // fork bomb
	]
	return forbidden.some((f) => lower.includes(f))
}

/**
 * Ensure the logs directory exists.
 */
function ensureLogsDir() {
	if (!fs.existsSync(LOGS_DIR)) {
		fs.mkdirSync(LOGS_DIR, { recursive: true })
	}
}

/**
 * Clean up a zombie container by name. Ignores errors if already removed.
 */
function cleanupContainer(containerName) {
	try {
		const proc = spawn("docker", ["rm", "-f", containerName], {
			stdio: "ignore",
			detached: true,
		})
		proc.unref()
	} catch {
		// Best-effort cleanup — ignore failures
	}
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Core runner ───────────────────────────────────────────────────────────────

/**
 * Run a single job inside the Docker sandbox.
 *
 * @param {object} job
 * @param {string} job.id     — BullMQ job id
 * @param {string} job.task   — Human-readable task name
 * @param {string[]} job.commands — Commands to execute inside the container
 * @param {string} [job.network] — Docker network mode (default: "none")
 *
 * @returns {Promise<{success: boolean, logPath: string, stdout: string, stderr: string, exitCode: number, timedOut: boolean}>}
 */
async function runSandboxJob(job) {
	const jobId = job.id || `job-${Date.now()}`
	const taskName = job.task || "untitled"
	const commands = Array.isArray(job.commands) ? job.commands : []
	const network = job.network || "none"
	const containerName = `superroo-sandbox-${jobId}`

	// Validate commands
	for (const cmd of commands) {
		if (isDangerousCommand(cmd)) {
			throw new Error(`Dangerous command blocked: ${cmd}`)
		}
	}

	// Prepare job folder (mounted into container)
	const jobFolder = path.join(JOBS_DIR, jobId)
	if (!fs.existsSync(jobFolder)) {
		fs.mkdirSync(jobFolder, { recursive: true })
	}

	ensureLogsDir()
	const logPath = path.join(LOGS_DIR, `${jobId}.log`)
	const logStream = fs.createWriteStream(logPath, { flags: "a" })

	const timestamp = () => new Date().toISOString()
	const log = (line) => {
		const text = `[${timestamp()}] ${line}\n`
		logStream.write(text)
		process.stdout.write(text)
	}

	log(`=== Job ${jobId} started | task: ${taskName} | timeout: ${JOB_TIMEOUT_MS}ms ===`)

	// Build Docker run arguments with crash-resilient flags
	const dockerArgs = [
		"run",
		"--rm",
		`--network=${network}`,
		"-v",
		`${jobFolder}:/workspace`,
		"-w",
		"/workspace",
		`--cpus=${CONTAINER_CPUS}`,
		`--memory=${CONTAINER_MEMORY}`,
		`--memory-swap=${CONTAINER_MEMORY_SWAP}`, // no swap = OOM kills fast instead of thrashing
		"--oom-kill-disable=false", // allow OOM killer to terminate runaway processes
		"--stop-timeout=30", // give processes 30s to gracefully shut down
		"--name",
		containerName,
		IMAGE_NAME,
		"bash",
		"-c",
		commands.join(" && "),
	]

	log(`Docker command: docker ${dockerArgs.join(" ")}`)

	// ── Execute with timeout and retry ──────────────────────────────────────

	let lastError = null

	for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
		if (attempt > 1) {
			const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 2)
			log(`[retry] Attempt ${attempt}/${MAX_RETRIES + 1} after ${delay}ms delay...`)
			await sleep(delay)
		}

		try {
			const result = await runSingleContainer(dockerArgs, containerName, log, logStream)
			logStream.end()
			return result
		} catch (err) {
			lastError = err
			log(`[error] Attempt ${attempt} failed: ${err.message}`)
			// Clean up zombie container before retry
			cleanupContainer(containerName)
		}
	}

	logStream.end()
	throw lastError || new Error(`Job ${jobId} failed after ${MAX_RETRIES + 1} attempts`)
}

/**
 * Run a single Docker container with timeout.
 *
 * @param {string[]} dockerArgs
 * @param {string} containerName
 * @param {function} log
 * @param {fs.WriteStream} logStream
 * @returns {Promise<{success: boolean, logPath: string, stdout: string, stderr: string, exitCode: number, timedOut: boolean}>}
 */
function runSingleContainer(dockerArgs, containerName, log, logStream) {
	return new Promise((resolve, reject) => {
		const proc = spawn("docker", dockerArgs, {
			detached: false,
		})

		let stdout = ""
		let stderr = ""
		let timedOut = false
		let resolved = false

		// ── Timeout guard ───────────────────────────────────────────────────
		const timeoutHandle = setTimeout(() => {
			if (resolved) return
			timedOut = true
			log(`[timeout] Job exceeded ${JOB_TIMEOUT_MS}ms limit — killing container`)
			cleanupContainer(containerName)
			// The 'close' event will fire after docker rm -f, so we don't resolve here
		}, JOB_TIMEOUT_MS)

		proc.stdout.on("data", (data) => {
			const chunk = data.toString()
			stdout += chunk
			log(`[stdout] ${chunk.trimEnd()}`)
		})

		proc.stderr.on("data", (data) => {
			const chunk = data.toString()
			stderr += chunk
			log(`[stderr] ${chunk.trimEnd()}`)
		})

		proc.on("error", (err) => {
			if (resolved) return
			clearTimeout(timeoutHandle)
			resolved = true
			log(`[error] ${err.message}`)
			reject(err)
		})

		proc.on("close", (code) => {
			if (resolved) return
			clearTimeout(timeoutHandle)
			resolved = true

			const exitCode = code !== null ? code : timedOut ? 137 : -1 // 137 = SIGKILL (OOM/timeout)
			const success = exitCode === 0

			log(`=== Job finished | exit code: ${exitCode} | success: ${success} | timedOut: ${timedOut} ===`)
			resolve({
				success,
				logPath: logStream.path,
				stdout,
				stderr,
				exitCode,
				timedOut,
			})
		})
	})
}

module.exports = { runSandboxJob }
