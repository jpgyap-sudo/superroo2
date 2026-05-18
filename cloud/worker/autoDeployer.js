/**
 * SuperRoo Cloud — Auto-Deployer Worker
 *
 * Self-retrying SSH deploy agent that runs as a PM2 service on the VPS.
 * Features:
 *   - Kills stuck SSH processes before each attempt
 *   - Retries with exponential backoff (10s, 20s, 40s, 80s, 160s)
 *   - Reports status to shared JSON file (readable by API)
 *   - Cooldown timeout (10 min) to prevent spamming
 *   - Max overall duration (30 min) to prevent runaway deploys
 *   - Rate-limiting — ignores duplicate triggers within cooldown
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - Can be triggered via API endpoint
 *
 * Usage (PM2):
 *   pm2 start ecosystem.config.js  (includes superroo-auto-deployer)
 *
 * Manual trigger:
 *   curl -X POST http://localhost:8787/api/auto-deploy/trigger
 *
 * Status:
 *   curl http://localhost:8787/api/auto-deploy/status
 */

const { execSync, exec } = require("child_process")
const fs = require("fs")
const path = require("path")
const http = require("http")

// ── Configuration ──────────────────────────────────────────────────────────────

const STATUS_FILE = path.join(__dirname, "..", "memory", "auto-deploy-status.json")
const LOG_FILE = path.join(__dirname, "..", "logs", "auto-deployer.log")
const PROJECT_ROOT = "/opt/superroo2"
const CLOUD_DIR = path.join(PROJECT_ROOT, "cloud")
const DASHBOARD_DIR = path.join(CLOUD_DIR, "dashboard")
// Using Tailscale IP (100.64.175.88) instead of public IP for secure mesh connection
const SSH_TARGET = "root@100.64.175.88"
const SSH_KEY = "/root/.ssh/id_superroo_vps"
const SSH_OPTS = `-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i ${SSH_KEY}`

const MAX_RETRIES = 5
const RETRY_DELAY = 10 // seconds, doubles each retry
const DEPLOY_TIMEOUT = 600 // seconds per deploy attempt

// ── Anti-Spam / Cooldown Configuration ────────────────────────────────────────
// Prevents the auto-deployer from being triggered too frequently.
// - COOLDOWN_MS: Minimum time between deploy starts (10 minutes)
// - MAX_DURATION_MS: Hard cap on total deploy runtime (30 minutes)
// - After MAX_DURATION_MS, the deploy is force-stopped and marked as failed
const COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes
const MAX_DURATION_MS = 30 * 60 * 1000 // 30 minutes

// ── State ──────────────────────────────────────────────────────────────────────

let isRunning = false
let currentAttempt = 0
let deployStartTime = null // Date.now() when deploy started (for max duration check)
let deployTimer = null // setTimeout reference for max duration enforcement
let status = {
	state: "idle", // idle | running | success | failed | cooldown
	attempts: [],
	startTime: null,
	endTime: null,
	lastError: null,
	triggeredBy: null, // "auto" | "api" | "startup" | "github-webhook"
	cooldownUntil: null, // ISO timestamp when cooldown expires
}

// ── Logging ────────────────────────────────────────────────────────────────────

function log(msg) {
	const line = `[${new Date().toISOString()}] ${msg}`
	console.log(line)
	try {
		fs.appendFileSync(LOG_FILE, line + "\n")
	} catch {
		/* ignore */
	}
}

// ── Status Persistence ─────────────────────────────────────────────────────────

function saveStatus() {
	try {
		const dir = path.dirname(STATUS_FILE)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2))
	} catch (err) {
		log(`[ERROR] Failed to save status: ${err.message}`)
	}
}

function loadStatus() {
	try {
		if (fs.existsSync(STATUS_FILE)) {
			const data = fs.readFileSync(STATUS_FILE, "utf8")
			status = { ...status, ...JSON.parse(data) }
		}
	} catch {
		/* ignore */
	}
}

// ── SSH Helpers ────────────────────────────────────────────────────────────────

function killStuckSSH() {
	try {
		execSync("pkill -9 ssh 2>/dev/null || true", { stdio: "ignore" })
		log("[SSH] Killed all stuck SSH processes")
	} catch {
		/* ignore */
	}
}

function sshCmd(desc, timeout, command) {
	return new Promise((resolve, reject) => {
		const cmd = `ssh ${SSH_OPTS} ${SSH_TARGET} ${JSON.stringify(command)}`
		log(`[SSH] ${desc} (timeout: ${timeout}s)...`)

		const child = exec(cmd, { timeout: timeout * 1000 }, (error, stdout, stderr) => {
			if (error) {
				if (error.killed || error.signal === "SIGTERM") {
					log(`[ERROR] SSH timed out after ${timeout}s during: ${desc}`)
					killStuckSSH()
					reject(new Error(`SSH timed out: ${desc}`))
				} else {
					log(`[ERROR] SSH failed during: ${desc} — ${error.message.slice(0, 100)}`)
					reject(error)
				}
			} else {
				log(`[OK] ${desc}`)
				resolve(stdout)
			}
		})
	})
}

// ── Deploy Steps ───────────────────────────────────────────────────────────────

async function runDeploy() {
	log("=== Auto-Deployer: Starting deploy ===")

	// Step 1: Test connection
	await sshCmd("SSH connection test", 15, "echo 'SSH OK'")

	// Step 2: Git pull
	await sshCmd("git pull", 60, `cd ${PROJECT_ROOT} && git pull origin main`)

	// Step 3: Install deps (filtered)
	await sshCmd(
		"pnpm install (filtered)",
		180,
		`cd ${PROJECT_ROOT} && corepack enable 2>/dev/null; corepack pnpm install --filter cloud/dashboard --frozen-lockfile --prefer-offline`,
	)

	// Step 4: Build
	await sshCmd("pnpm build", 300, `cd ${PROJECT_ROOT} && corepack pnpm --dir ${DASHBOARD_DIR} run build`)

	// Step 5: Restart PM2
	await sshCmd(
		"pm2 restart",
		60,
		`cd ${CLOUD_DIR} && (pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save`,
	)

	// Step 6: Verify
	await sshCmd("pm2 status", 30, "pm2 list")
	await sshCmd(
		"post-deploy health checks",
		45,
		[
			"curl -fsS http://127.0.0.1:8787/api/health >/dev/null",
			"curl -fsS http://127.0.0.1:8787/workflow-compliance/stats >/dev/null",
			"curl -fsS http://127.0.0.1:3001/?page=workflow-compliance >/dev/null",
		].join(" && "),
	)

	log("=== Auto-Deployer: Deploy completed ===")
	return true
}

// ── Cooldown / Rate-Limiting ──────────────────────────────────────────────────

/**
 * Check if we're in cooldown period (after a deploy, wait COOLDOWN_MS before
 * allowing another one). This prevents spamming from GitHub webhooks or
 * auto-retry loops.
 */
function isInCooldown() {
	if (status.cooldownUntil && Date.now() < new Date(status.cooldownUntil).getTime()) {
		return true
	}
	return false
}

/**
 * Set the cooldown period starting now.
 */
function setCooldown() {
	const until = new Date(Date.now() + COOLDOWN_MS).toISOString()
	status.cooldownUntil = until
	status.state = "cooldown"
	saveStatus()
	log(`[COOLDOWN] Set cooldown until ${until} (${COOLDOWN_MS / 1000}s)`)
}

/**
 * Clear the cooldown (e.g., on manual trigger override).
 */
function clearCooldown() {
	status.cooldownUntil = null
	if (status.state === "cooldown") {
		status.state = "idle"
	}
	saveStatus()
}

/**
 * Force-stop a running deploy (called when MAX_DURATION_MS is exceeded).
 */
function forceStopDeploy(reason) {
	log(`[FORCE-STOP] ${reason}`)
	killStuckSSH()
	if (deployTimer) {
		clearTimeout(deployTimer)
		deployTimer = null
	}
	isRunning = false
	deployStartTime = null
	status.state = "failed"
	status.endTime = new Date().toISOString()
	status.lastError = reason
	status.attempts.push({
		attempt: currentAttempt || 0,
		status: "force-stopped",
		error: reason,
		time: new Date().toISOString(),
	})
	saveStatus()
	setCooldown()
}

// ── Main Retry Loop ────────────────────────────────────────────────────────────

async function startDeploy(triggeredBy = "auto") {
	// ── Anti-spam checks ──────────────────────────────────────────────────
	if (isRunning) {
		log(`[SKIP] Deploy already in progress (triggered by: ${triggeredBy})`)
		return { success: false, error: "Deploy already in progress", cooldown: true }
	}

	// Check cooldown — skip if we deployed less than COOLDOWN_MS ago
	if (isInCooldown()) {
		const remaining = Math.round((new Date(status.cooldownUntil).getTime() - Date.now()) / 1000)
		log(`[SKIP] In cooldown — ${remaining}s remaining (triggered by: ${triggeredBy})`)
		return { success: false, error: `In cooldown — ${remaining}s remaining`, cooldown: true, remaining }
	}

	// ── Start deploy ──────────────────────────────────────────────────────
	isRunning = true
	currentAttempt = 0
	deployStartTime = Date.now()
	status.state = "running"
	status.startTime = new Date().toISOString()
	status.endTime = null
	status.lastError = null
	status.triggeredBy = triggeredBy
	status.attempts = []
	saveStatus()

	log(`============================================`)
	log(`  SuperRoo Cloud Auto-Deployer`)
	log(`  Target: ${SSH_TARGET}`)
	log(`  Max retries: ${MAX_RETRIES}`)
	log(`  Max duration: ${MAX_DURATION_MS / 1000}s`)
	log(`  Cooldown: ${COOLDOWN_MS / 1000}s`)
	log(`  Triggered by: ${triggeredBy}`)
	log(`============================================`)

	// ── Max duration enforcement ──────────────────────────────────────────
	// If the deploy takes longer than MAX_DURATION_MS, force-stop it.
	// This prevents runaway deploys that keep retrying forever.
	deployTimer = setTimeout(() => {
		if (isRunning) {
			forceStopDeploy(`Deploy exceeded max duration of ${MAX_DURATION_MS / 1000}s`)
		}
	}, MAX_DURATION_MS)
	deployTimer.unref() // Don't keep process alive just for this timer

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		// Check if we were force-stopped by the max duration timer
		if (!isRunning) {
			log(`[ABORT] Deploy was force-stopped during attempt ${attempt}`)
			return { success: false, error: `Force-stopped: ${status.lastError || "max duration exceeded"}` }
		}

		currentAttempt = attempt
		const attemptStart = Date.now()
		log(`=== Attempt ${attempt}/${MAX_RETRIES} ===`)

		killStuckSSH()

		try {
			await runDeploy()
			const duration = Math.round((Date.now() - attemptStart) / 1000)
			status.state = "success"
			status.endTime = new Date().toISOString()
			status.attempts.push({
				attempt,
				status: "success",
				duration: `${duration}s`,
				time: new Date().toISOString(),
			})
			saveStatus()
			log(`✅ DEPLOY SUCCESSFUL on attempt ${attempt} (${duration}s)`)
			isRunning = false
			deployStartTime = null
			if (deployTimer) {
				clearTimeout(deployTimer)
				deployTimer = null
			}
			// Set cooldown after successful deploy
			setCooldown()
			return { success: true, attempt, duration: `${duration}s` }
		} catch (err) {
			const duration = Math.round((Date.now() - attemptStart) / 1000)
			status.attempts.push({
				attempt,
				status: "failed",
				error: err.message,
				duration: `${duration}s`,
				time: new Date().toISOString(),
			})
			status.lastError = err.message
			saveStatus()

			if (attempt < MAX_RETRIES) {
				const delay = RETRY_DELAY * Math.pow(2, attempt - 1)
				log(`❌ Attempt ${attempt} failed. Waiting ${delay}s before retry...`)
				await new Promise((r) => setTimeout(r, delay * 1000))
			} else {
				log(`❌❌❌ ALL ${MAX_RETRIES} ATTEMPTS EXHAUSTED`)
				status.state = "failed"
				status.endTime = new Date().toISOString()
				saveStatus()
			}
		}
	}

	isRunning = false
	deployStartTime = null
	if (deployTimer) {
		clearTimeout(deployTimer)
		deployTimer = null
	}
	// Set cooldown even after failed deploy to prevent immediate re-trigger
	setCooldown()
	return { success: false, error: `All ${MAX_RETRIES} attempts exhausted` }
}

// ── HTTP Server for API (runs on separate port) ────────────────────────────────
// The main API (api.js) proxies requests to this port for auto-deployer endpoints.

const PORT = parseInt(process.env.AUTO_DEPLOYER_PORT || "8790", 10)

// GitHub webhook secret — set via env var for security
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || ""

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 * Returns true if signature matches or no secret is configured.
 */
function verifyGitHubSignature(reqBody, signatureHeader) {
	if (!GITHUB_WEBHOOK_SECRET) {
		log("[WEBHOOK] No GITHUB_WEBHOOK_SECRET set — skipping signature verification")
		return true // allow if no secret configured (dev mode)
	}
	if (!signatureHeader) {
		log("[WEBHOOK] Missing X-Hub-Signature-256 header")
		return false
	}
	const crypto = require("crypto")
	const sig = "sha256=" + crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(reqBody).digest("hex")
	return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signatureHeader))
}

function handleRequest(req, res) {
	const url = new URL(req.url, `http://localhost:${PORT}`)
	const method = req.method

	// CORS
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type")

	if (method === "OPTIONS") {
		res.writeHead(204)
		res.end()
		return
	}

	// GET /status — Return current auto-deployer status
	if (method === "GET" && (url.pathname === "/status" || url.pathname === "/api/auto-deploy/status")) {
		const now = Date.now()
		const cooldownRemaining = status.cooldownUntil
			? Math.max(0, Math.round((new Date(status.cooldownUntil).getTime() - now) / 1000))
			: 0
		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(
			JSON.stringify({
				success: true,
				data: {
					...status,
					isRunning,
					currentAttempt,
					cooldownRemaining, // seconds until cooldown expires
					inCooldown: isInCooldown(),
					config: {
						cooldownMs: COOLDOWN_MS,
						maxDurationMs: MAX_DURATION_MS,
						maxRetries: MAX_RETRIES,
						retryDelay: RETRY_DELAY,
					},
				},
			}),
		)
		return
	}

	// POST /trigger — Trigger a deploy
	if (method === "POST" && (url.pathname === "/trigger" || url.pathname === "/api/auto-deploy/trigger")) {
		startDeploy("api")
			.then((result) => {
				res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" })
				res.end(JSON.stringify(result))
			})
			.catch((err) => {
				res.writeHead(500, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: false, error: err.message }))
			})
		return
	}

	// POST /github-webhook — Receive GitHub push webhook and auto-deploy
	if (
		method === "POST" &&
		(url.pathname === "/github-webhook" ||
			url.pathname === "/api/auto-deploy/github-webhook" ||
			url.pathname === "/api/github-webhook")
	) {
		let body = ""
		req.on("data", (chunk) => (body += chunk))
		req.on("end", () => {
			// Verify signature
			const signature = req.headers["x-hub-signature-256"]
			if (!verifyGitHubSignature(body, signature)) {
				res.writeHead(401, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: false, error: "Invalid signature" }))
				return
			}

			try {
				const event = req.headers["x-github-event"]
				const payload = JSON.parse(body)

				if (event === "push" && payload.ref === "refs/heads/main") {
					const pusher = payload.pusher?.name || "unknown"
					const commitCount = payload.commits?.length || 0
					const headCommit = payload.head_commit?.message?.split("\n")[0] || "no message"
					log(`[WEBHOOK] Push to main by ${pusher}: ${commitCount} commit(s) — "${headCommit}"`)

					// Trigger deploy asynchronously (don't block the webhook response)
					startDeploy("github-webhook").catch((err) =>
						log(`[WEBHOOK] Deploy triggered by webhook failed: ${err.message}`),
					)

					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, message: "Deploy triggered by GitHub webhook" }))
				} else if (event === "push") {
					log(`[WEBHOOK] Push to ${payload.ref} (not main) — ignoring`)
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, message: "Ignored — not a push to main" }))
				} else {
					log(`[WEBHOOK] Received ${event} event — ignoring`)
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, message: `Ignored ${event} event` }))
				}
			} catch (err) {
				log(`[WEBHOOK] Error processing webhook: ${err.message}`)
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: false, error: err.message }))
			}
		})
		return
	}

	// 404
	res.writeHead(404, { "Content-Type": "application/json" })
	res.end(JSON.stringify({ error: "not_found" }))
}

const server = http.createServer(handleRequest)

// ── Startup ────────────────────────────────────────────────────────────────────

loadStatus()

// Start HTTP server
server.listen(PORT, () => {
	log(`[auto-deployer] Listening on port ${PORT}`)
	log(`[auto-deployer] Status: http://localhost:${PORT}/api/auto-deploy/status`)
	log(`[auto-deployer] Trigger: POST http://localhost:${PORT}/api/auto-deploy/trigger`)
	log(`[auto-deployer] Cooldown: ${COOLDOWN_MS / 1000}s | Max duration: ${MAX_DURATION_MS / 1000}s`)

	// Auto-start deploy on startup if last state was running/failed
	// Respect cooldown — don't auto-restart if we're still in cooldown
	if (status.state === "running" || status.state === "failed") {
		if (isInCooldown()) {
			const remaining = Math.round((new Date(status.cooldownUntil).getTime() - Date.now()) / 1000)
			log(
				`[auto-deployer] Previous deploy was incomplete but in cooldown (${remaining}s remaining) — skipping auto-restart`,
			)
		} else {
			log("[auto-deployer] Previous deploy was incomplete — auto-restarting")
			startDeploy("startup").catch((err) => log(`[ERROR] Startup deploy failed: ${err.message}`))
		}
	}
})

// ── Graceful Shutdown ──────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
	log("[auto-deployer] SIGTERM received — shutting down")
	isRunning = false
	server.close(() => process.exit(0))
})

process.on("SIGINT", () => {
	log("[auto-deployer] SIGINT received — shutting down")
	isRunning = false
	server.close(() => process.exit(0))
})

// Export for programmatic use
module.exports = { startDeploy, getStatus: () => status }
