/**
 * SuperRoo Cloud — Sandbox Runner
 *
 * Executes job commands inside an isolated Docker container.
 * NEVER runs commands directly on the host.
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = process.env.SUPERROO_ROOT || "/opt/superroo2"
const SANDBOX_DIR = path.join(PROJECT_ROOT, "cloud", "sandbox")
const JOBS_DIR = path.join(SANDBOX_DIR, "jobs")
const LOGS_DIR = path.join(PROJECT_ROOT, "cloud", "logs", "jobs")
const IMAGE_NAME = process.env.SANDBOX_IMAGE || "superroo-sandbox:latest"

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
 * Run a single job inside the Docker sandbox.
 *
 * @param {object} job
 * @param {string} job.id     — BullMQ job id
 * @param {string} job.task   — Human-readable task name
 * @param {string[]} job.commands — Commands to execute inside the container
 *
 * @returns {Promise<{success: boolean, logPath: string, stdout: string, stderr: string}>}
 */
async function runSandboxJob(job) {
	const jobId = job.id || `job-${Date.now()}`
	const taskName = job.task || "untitled"
	const commands = Array.isArray(job.commands) ? job.commands : []
	const network = job.network || "none"

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
		process.stdout.write(text) // also emit to worker stdout for PM2 logs
	}

	log(`=== Job ${jobId} started | task: ${taskName} ===`)

	// Build Docker run arguments
	const dockerArgs = [
		"run",
		"--rm",
		`--network=${network}`, // configurable: none for isolation, host for git clone etc.
		"-v",
		`${jobFolder}:/workspace`,
		"-w",
		"/workspace",
		"--cpus=1",
		"--memory=512m",
		"--name",
		`superroo-sandbox-${jobId}`,
		IMAGE_NAME,
		"bash",
		"-c",
		commands.join(" && "),
	]

	log(`Docker command: docker ${dockerArgs.join(" ")}`)

	return new Promise((resolve, reject) => {
		const proc = spawn("docker", dockerArgs, {
			detached: false,
		})

		let stdout = ""
		let stderr = ""

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
			log(`[error] ${err.message}`)
			logStream.end()
			reject(err)
		})

		proc.on("close", (code) => {
			const success = code === 0
			log(`=== Job ${jobId} finished | exit code: ${code} | success: ${success} ===`)
			logStream.end()
			resolve({
				success,
				logPath,
				stdout,
				stderr,
				exitCode: code,
			})
		})
	})
}

module.exports = { runSandboxJob }
