/**
 * SuperRoo Cloud — Auto-Deployer Worker
 *
 * Self-retrying SSH deploy agent that runs as a PM2 service on the VPS.
 * Features:
 *   - Kills stuck SSH processes before each attempt
 *   - Retries with exponential backoff (10s, 20s, 40s, 80s, 160s)
 *   - Reports status to shared JSON file (readable by API)
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

// ── State ──────────────────────────────────────────────────────────────────────

let isRunning = false
let currentAttempt = 0
let status = {
	state: "idle", // idle | running | success | failed
	attempts: [],
	startTime: null,
	endTime: null,
	lastError: null,
	triggeredBy: null, // "auto" | "api" | "startup"
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

	log("=== Auto-Deployer: Deploy completed ===")
	return true
}

// ── Main Retry Loop ────────────────────────────────────────────────────────────

async function startDeploy(triggeredBy = "auto") {
	if (isRunning) {
		log("[SKIP] Deploy already in progress")
		return { success: false, error: "Deploy already in progress" }
	}

	isRunning = true
	currentAttempt = 0
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
	log(`  Triggered by: ${triggeredBy}`)
	log(`============================================`)

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(
			JSON.stringify({
				success: true,
				data: {
					...status,
					isRunning,
					currentAttempt,
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

	// Auto-start deploy on startup if last state was running/failed
	if (status.state === "running" || status.state === "failed") {
		log("[auto-deployer] Previous deploy was incomplete — auto-restarting")
		startDeploy("startup").catch((err) => log(`[ERROR] Startup deploy failed: ${err.message}`))
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
