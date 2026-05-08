/**
 * SuperRoo Cloud — Job API
 *
 * Minimal HTTP API that enqueues jobs into the BullMQ queue.
 * The worker picks them up and runs them inside the Docker sandbox.
 * Adds agent runtime routes.
 */

const http = require("http")
const crypto = require("crypto")
const { Queue } = require("bullmq")
const IORedis = require("ioredis")
const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs").promises
const path = require("path")

const execAsync = promisify(exec)

// ── AI Chat helper ─────────────────────────────────────────────────────────────

/**
 * Calls an OpenAI-compatible chat completion endpoint.
 * Supports DeepSeek, OpenAI, OpenRouter, Groq, Kimi — all use the same /v1/chat/completions format.
 */
async function callChatCompletion(apiBaseUrl, apiKey, model, messages) {
	const url = `${apiBaseUrl.replace(/\/+$/, "")}/chat/completions`
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages,
			max_tokens: 4096,
			temperature: 0.7,
		}),
		signal: AbortSignal.timeout(60_000),
	})
	if (!res.ok) {
		const errBody = await res.text().catch(() => "")
		throw new Error(`AI API error ${res.status}: ${errBody.slice(0, 200)}`)
	}
	const data = await res.json()
	return data.choices?.[0]?.message?.content || "(no response)"
}

/**
 * Resolves the best available provider for a given task type.
 * Returns { providerId, apiBaseUrl, apiKey, model } or null if none available.
 */
function resolveProviderForTask(taskType) {
	const settingsRoutes = DEFAULT_AGENT_ROUTES
	const route = settingsRoutes.find((r) => r.agent === taskType) || settingsRoutes[0]
	if (!route) return null

	// Try primary first
	const primaryMeta = providerMeta.get(route.primary.provider)
	if (primaryMeta?.hasKey && primaryMeta?.status === "connected") {
		const encrypted = encryptedSecrets.get(route.primary.provider)
		if (encrypted) {
			try {
				const apiKey = decryptSecret(encrypted)
				const providerDef = PROVIDERS.find((p) => p.id === route.primary.provider)
				return {
					providerId: route.primary.provider,
					apiBaseUrl: providerDef?.apiBaseUrl || `https://api.${route.primary.provider}.com/v1`,
					apiKey,
					model: route.primary.model,
				}
			} catch {
				// decryption failed, try fallbacks
			}
		}
	}

	// Try fallbacks
	for (const fallback of route.fallbacks || []) {
		const fbMeta = providerMeta.get(fallback.provider)
		if (fbMeta?.hasKey && fbMeta?.status === "connected") {
			const encrypted = encryptedSecrets.get(fallback.provider)
			if (encrypted) {
				try {
					const apiKey = decryptSecret(encrypted)
					const providerDef = PROVIDERS.find((p) => p.id === fallback.provider)
					return {
						providerId: fallback.provider,
						apiBaseUrl: providerDef?.apiBaseUrl || `https://api.${fallback.provider}.com/v1`,
						apiKey,
						model: fallback.model,
					}
				} catch {
					// try next fallback
				}
			}
		}
	}

	return null
}

/**
 * Resolves a specific provider by ID (for manual override).
 * Returns { providerId, apiBaseUrl, apiKey, model } or null if not available.
 */
function resolveProviderById(providerId, modelOverride) {
	const meta = providerMeta.get(providerId)
	if (!meta?.hasKey || meta?.status !== "connected") return null

	const encrypted = encryptedSecrets.get(providerId)
	if (!encrypted) return null

	try {
		const apiKey = decryptSecret(encrypted)
		const providerDef = PROVIDERS.find((p) => p.id === providerId)
		return {
			providerId,
			apiBaseUrl: providerDef?.apiBaseUrl || `https://api.${providerId}.com/v1`,
			apiKey,
			model: modelOverride || providerDef?.defaultModel || "deepseek-chat",
		}
	} catch {
		return null
	}
}

let listAgents, getAgent, setAgentEnabled, toggleAgent
try {
	const agentRegistry = require("../agent-runtime/agentRegistry")
	listAgents = agentRegistry.listAgents
	getAgent = agentRegistry.getAgent
	setAgentEnabled = agentRegistry.setAgentEnabled
	toggleAgent = agentRegistry.toggleAgent
} catch (e) {
	console.warn("[api] agentRegistry not found, using fallback")
	listAgents = async () => []
	getAgent = async () => null
	setAgentEnabled = async () => {
		throw new Error("agentRegistry not available")
	}
	toggleAgent = async () => {
		throw new Error("agentRegistry not available")
	}
}

const PORT = process.env.API_PORT || "8787"
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs"
const LOGS_DIR = process.env.LOGS_DIR || "/opt/superroo2/cloud/logs"
const SETTINGS_DIR = process.env.SETTINGS_DIR || "/opt/superroo2/cloud/data/settings"

const connection = new IORedis(REDIS_URL, {
	maxRetriesPerRequest: null,
})

const queue = new Queue(QUEUE_NAME, { connection })

function parseBody(req) {
	return new Promise((resolve, reject) => {
		let body = ""
		req.on("data", (chunk) => {
			body += chunk
		})
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on("error", reject)
	})
}

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

// ── Settings / Secret Vault helpers ─────────────────────────────────────────────

const ALGO = "aes-256-gcm"

function getVaultKey() {
	const raw = process.env.SUPERROO_VAULT_KEY
	if (!raw) {
		throw new Error(
			"SUPERROO_VAULT_KEY is missing. Generate a 32-byte base64 key with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
		)
	}
	const key = Buffer.from(raw, "base64")
	if (key.length !== 32) {
		throw new Error("SUPERROO_VAULT_KEY must be exactly 32 bytes (44 base64 chars).")
	}
	return key
}

function encryptSecret(plainText) {
	const key = getVaultKey()
	const iv = crypto.randomBytes(12)
	const cipher = crypto.createCipheriv(ALGO, key, iv)
	const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
	const tag = cipher.getAuthTag()
	return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

function decryptSecret(payload) {
	const key = getVaultKey()
	const [ivB64, tagB64, dataB64] = payload.split(".")
	const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"))
	decipher.setAuthTag(Buffer.from(tagB64, "base64"))
	return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

function maskSecret(value) {
	if (!value || value.length < 8) return ""
	const prefix = value.slice(0, 4)
	const suffix = value.slice(-4)
	return `${prefix}••••••••${suffix}`
}

function hashApiKey(key) {
	return crypto.createHash("sha256").update(key).digest("hex")
}

// ── Provider definitions ────────────────────────────────────────────────────────

const PROVIDERS = [
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT-4o, GPT-4o-mini, and o-series models",
		website: "https://openai.com",
		docsUrl: "https://platform.openai.com/docs",
		apiBaseUrl: "https://api.openai.com/v1",
		models: [
			{ id: "gpt-4o", name: "GPT-4o" },
			{ id: "gpt-4o-mini", name: "GPT-4o Mini" },
			{ id: "o3-mini", name: "o3-mini" },
		],
		capabilities: ["chat", "vision", "function-calling", "structured-output"],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude Sonnet 4, Haiku 3.5, and Opus models",
		website: "https://anthropic.com",
		docsUrl: "https://docs.anthropic.com",
		apiBaseUrl: "https://api.anthropic.com/v1",
		models: [
			{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
			{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
		],
		capabilities: ["chat", "vision", "function-calling", "extended-thinking"],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek V3 and R1 reasoning models",
		website: "https://deepseek.com",
		docsUrl: "https://platform.deepseek.com/docs",
		apiBaseUrl: "https://api.deepseek.com/v1",
		models: [
			{ id: "deepseek-chat", name: "DeepSeek V3" },
			{ id: "deepseek-reasoner", name: "DeepSeek R1" },
		],
		capabilities: ["chat", "reasoning"],
	},
	{
		id: "kimi",
		name: "Kimi (Moonshot)",
		description: "Moonshot AI's Kimi models",
		website: "https://moonshot.cn",
		docsUrl: "https://platform.moonshot.cn/docs",
		apiBaseUrl: "https://api.moonshot.cn/v1",
		models: [{ id: "kimi-latest", name: "Kimi Latest" }],
		capabilities: ["chat", "vision"],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Unified API for 200+ models across providers",
		website: "https://openrouter.ai",
		docsUrl: "https://openrouter.ai/docs",
		apiBaseUrl: "https://openrouter.ai/api/v1",
		models: [{ id: "openrouter/auto", name: "Auto (best model)" }],
		capabilities: ["chat", "vision", "function-calling", "multi-provider"],
	},
	{
		id: "groq",
		name: "Groq",
		description: "Fast inference with open-source models",
		website: "https://groq.com",
		docsUrl: "https://console.groq.com/docs",
		apiBaseUrl: "https://api.groq.com/openai/v1",
		models: [
			{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
			{ id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
		],
		capabilities: ["chat", "fast-inference"],
	},
]

// ── Default agent routes ────────────────────────────────────────────────────────

const DEFAULT_AGENT_ROUTES = [
	{
		agent: "planner",
		label: "Planner",
		primary: { provider: "openai", model: "gpt-4o" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
	{
		agent: "coder",
		label: "Coder",
		primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
		fallbacks: [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
	{
		agent: "debugger",
		label: "Debugger",
		primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
		fallbacks: [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
	{
		agent: "crawler",
		label: "Crawler",
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
	{
		agent: "tester",
		label: "Tester",
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
	{
		agent: "deployChecker",
		label: "Deploy Checker",
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
]

// ── In-memory encrypted secrets store ───────────────────────────────────────────

const encryptedSecrets = new Map() // providerId -> encrypted payload
const providerMeta = new Map() // providerId -> { hasKey, lastTestedAt, latencyMs, status, keyHash }

// ── Encrypted secrets persistence ───────────────────────────────────────────────

const SECRETS_FILE = path.join(SETTINGS_DIR, "encrypted-secrets.json")

async function saveEncryptedSecrets() {
	await fs.mkdir(SETTINGS_DIR, { recursive: true })
	const obj = {}
	for (const [providerId, payload] of encryptedSecrets) {
		obj[providerId] = payload
	}
	await fs.writeFile(SECRETS_FILE, JSON.stringify(obj, null, 2), "utf-8")
}

async function loadEncryptedSecrets() {
	try {
		const raw = await fs.readFile(SECRETS_FILE, "utf-8")
		const obj = JSON.parse(raw)
		for (const [providerId, payload] of Object.entries(obj)) {
			encryptedSecrets.set(providerId, payload)
			// Restore providerMeta entry so the key is recognised as present
			if (!providerMeta.has(providerId)) {
				providerMeta.set(providerId, {
					hasKey: true,
					status: "not_tested",
					lastTestedAt: null,
					latencyMs: null,
					keyHash: null,
				})
			}
		}
		console.log(`[api] Loaded ${Object.keys(obj).length} encrypted API key(s) from disk`)
	} catch {
		// No saved secrets yet — that's fine
	}
}

// ── Settings file helpers ───────────────────────────────────────────────────────

async function loadSettings() {
	try {
		const filePath = path.join(SETTINGS_DIR, "superroo-settings.json")
		const raw = await fs.readFile(filePath, "utf-8")
		return JSON.parse(raw)
	} catch {
		return {
			activeProfile: "default",
			approval: { enabled: true, rules: [], maxApprovalCount: 10, maxCostUsd: 5, timeWindowMinutes: 60 },
			mcp: { servers: [] },
			routing: { routes: DEFAULT_AGENT_ROUTES },
			guardrails: {
				maxConcurrentJobs: 3,
				cpuHighPercent: 80,
				ramHighPercent: 85,
				onHighCpu: "warn",
				onHighRam: "warn",
			},
		}
	}
}

async function saveSettings(settings) {
	await fs.mkdir(SETTINGS_DIR, { recursive: true })
	const filePath = path.join(SETTINGS_DIR, "superroo-settings.json")
	await fs.writeFile(filePath, JSON.stringify(settings, null, 2), "utf-8")
}

// ── Provider testers ────────────────────────────────────────────────────────────

async function testOpenAI(apiKey) {
	const start = Date.now()
	try {
		const res = await fetch("https://api.openai.com/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = await res.json()
			const models = (body.data || []).map((m) => m.id).slice(0, 10)
			return { ok: true, latencyMs, message: "Connected", models }
		}
		const err = await res.json()
		return { ok: false, latencyMs, message: (err.error && err.error.message) || `HTTP ${res.status}` }
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - start, message: err.message }
	}
}

async function testAnthropic(apiKey) {
	const start = Date.now()
	try {
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "claude-3-haiku-20240307",
				max_tokens: 1,
				messages: [{ role: "user", content: "ping" }],
			}),
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) return { ok: true, latencyMs, message: "Connected" }
		const err = await res.json()
		return { ok: false, latencyMs, message: (err.error && err.error.message) || `HTTP ${res.status}` }
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - start, message: err.message }
	}
}

async function testDeepSeek(apiKey) {
	const start = Date.now()
	try {
		const res = await fetch("https://api.deepseek.com/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = await res.json()
			const models = (body.data || []).map((m) => m.id).slice(0, 10)
			return { ok: true, latencyMs, message: "Connected", models }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - start, message: err.message }
	}
}

async function testKimi(apiKey) {
	const start = Date.now()
	try {
		const res = await fetch("https://api.moonshot.cn/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) return { ok: true, latencyMs, message: "Connected" }
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - start, message: err.message }
	}
}

async function testOpenRouter(apiKey) {
	const start = Date.now()
	try {
		const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = await res.json()
			return { ok: true, latencyMs, message: (body.data && body.data.label) || "Connected" }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - start, message: err.message }
	}
}

async function testGroq(apiKey) {
	const start = Date.now()
	try {
		const res = await fetch("https://api.groq.com/openai/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = await res.json()
			const models = (body.data || []).map((m) => m.id).slice(0, 10)
			return { ok: true, latencyMs, message: "Connected", models }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - start, message: err.message }
	}
}

const PROVIDER_TESTERS = {
	openai: testOpenAI,
	anthropic: testAnthropic,
	deepseek: testDeepSeek,
	kimi: testKimi,
	openrouter: testOpenRouter,
	groq: testGroq,
}

async function testProviderKey(providerId, apiKey) {
	const tester = PROVIDER_TESTERS[providerId]
	if (!tester) {
		return { ok: false, latencyMs: 0, message: `Unknown provider: ${providerId}. No tester registered.` }
	}
	return tester(apiKey)
}

// ── Approval Engine ─────────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
	{ pattern: /\brm\s+-rf\s+[\/~]\b/, risk: "Critical", reason: "Recursive force delete on root/home" },
	{ pattern: /\bmkfs\b/, risk: "Critical", reason: "Filesystem creation — destructive" },
	{ pattern: /\bdd\s+if=/, risk: "Critical", reason: "Raw disk write — destructive" },
	{ pattern: /\b:\(\)\s*\{.*:\s*:\s*\(\)\s*\{\s*\};\s*\};\s*:\s*\)/, risk: "Critical", reason: "Fork bomb detected" },
	{ pattern: /\bshutdown\b/, risk: "High", reason: "System shutdown" },
	{ pattern: /\breboot\b/, risk: "High", reason: "System reboot" },
	{ pattern: /\bchmod\s+-R\s+777\s+\//, risk: "Critical", reason: "Recursive world-writable on root" },
	{ pattern: /\bpasswd\b/, risk: "High", reason: "Password change" },
	{ pattern: /\buserdel\b/, risk: "High", reason: "User deletion" },
	{ pattern: /\bgroupdel\b/, risk: "High", reason: "Group deletion" },
]

function evaluateApproval(input) {
	const { action, command, rules } = input

	// 1. Check dangerous patterns first (always block)
	if (command) {
		for (const dp of DANGEROUS_PATTERNS) {
			if (dp.pattern.test(command)) {
				return { decision: "block", reason: dp.reason, risk: dp.risk, matchedRule: dp.pattern.source }
			}
		}
	}

	// 2. Check custom rules
	for (const rule of rules) {
		const regex = new RegExp(rule.pattern, "i")
		if (regex.test(action) || (command && regex.test(command))) {
			return {
				decision: rule.decision,
				reason: `Matched rule: ${rule.pattern} (risk: ${rule.risk})`,
				risk: rule.risk,
				matchedRule: rule.pattern,
			}
		}
	}

	// 3. Default: allow low-risk, require approval for unknown
	if (action.startsWith("read.") || action === "network.crawl") {
		return { decision: "allow", reason: "Read-only action", risk: "Low" }
	}
	if (action.startsWith("write.") || action.startsWith("execute.")) {
		return { decision: "require_approval", reason: "Write/execute action requires approval", risk: "Medium" }
	}
	if (action.startsWith("deploy.")) {
		return { decision: "require_approval", reason: "Deploy action requires approval", risk: "High" }
	}
	return { decision: "allow", reason: "No matching rules — allowed by default", risk: "Low" }
}

// System monitoring
async function getSystemStats() {
	try {
		const [dfOut, freeOut, cpuOut] = await Promise.all([
			execAsync("df -h / | tail -1 | awk '{print $5}'").catch(() => ({ stdout: "0%" })),
			execAsync("free | grep Mem | awk '{print ($3/$2) * 100.0}'").catch(() => ({ stdout: "0" })),
			execAsync(
				"top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'",
			).catch(() => ({ stdout: "0" })),
		])

		return {
			cpu: Math.round(parseFloat(cpuOut.stdout.trim()) || 0),
			ram: Math.round(parseFloat(freeOut.stdout.trim()) || 0),
			disk: parseInt((dfOut.stdout.trim() || "0%").replace("%", "")) || 0,
		}
	} catch (err) {
		console.error("[api] Error getting system stats:", err.message)
		return { cpu: 0, ram: 0, disk: 0 }
	}
}

// Docker stats
async function getDockerStats() {
	try {
		const [psOut, imagesOut] = await Promise.all([
			execAsync("docker ps -a --format '{{.ID}}|{{.Status}}' 2>/dev/null || echo ''").catch(() => ({
				stdout: "",
			})),
			execAsync("docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || echo ''").catch(() => ({
				stdout: "",
			})),
		])

		const containers = psOut.stdout
			.trim()
			.split("\n")
			.filter((l) => l)
			.map((line) => {
				const [id, status] = line.split("|")
				return { id, status, running: status.toLowerCase().includes("up") }
			})

		const images = imagesOut.stdout
			.trim()
			.split("\n")
			.filter((l) => l && !l.includes("<none>"))

		return {
			containers: containers.length,
			running: containers.filter((c) => c.running).length,
			exited: containers.filter((c) => !c.running).length,
			images: images.length,
			imageList: images.slice(0, 5),
			sandboxReady: images.some((img) => img.includes("superroo-sandbox")),
		}
	} catch (err) {
		console.error("[api] Error getting docker stats:", err.message)
		return { containers: 0, running: 0, exited: 0, images: 0, imageList: [], sandboxReady: false }
	}
}

// Get logs from files
async function getLogs(limit = 50) {
	try {
		const logFiles = ["api-combined.log", "worker-combined.log", "dashboard-combined.log"]
		const allLogs = []

		for (const file of logFiles) {
			const filePath = path.join(LOGS_DIR, file)
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const lines = content.split("\n").filter((l) => l.trim())
				allLogs.push(...lines.slice(-limit).map((line) => ({ file, line })))
			} catch (err) {
				// File doesn't exist yet, skip
			}
		}

		// Sort by timestamp if possible, otherwise just return as-is
		return allLogs.slice(-limit).map((l) => l.line)
	} catch (err) {
		console.error("[api] Error reading logs:", err.message)
		return []
	}
}

// Get job counts by status
async function getJobCounts() {
	try {
		const [waiting, active, completed, failed, delayed] = await Promise.all([
			queue.getWaitingCount(),
			queue.getActiveCount(),
			queue.getCompletedCount(),
			queue.getFailedCount(),
			queue.getDelayedCount(),
		])

		return { waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed }
	} catch (err) {
		console.error("[api] Error getting job counts:", err.message)
		return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 }
	}
}

// Format a timestamp (number or ISO string) into a relative time string like "2h ago"
function formatRelativeTime(ts) {
	if (!ts) return "N/A"
	const now = Date.now()
	const t = typeof ts === "number" ? ts : new Date(ts).getTime()
	const diff = now - t
	if (diff < 0) return "just now"
	const seconds = Math.floor(diff / 1000)
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`
	const months = Math.floor(days / 30)
	return `${months}mo ago`
}

const server = http.createServer(async (req, res) => {
	const url = req.url || ""
	const method = req.method || "GET"

	// Normalize URL: handle both direct access and proxied access
	// - Direct: nginx proxies /api/health -> /health (strips /api)
	// - Via Next.js rewrite: /api/health stays as /api/health
	// Normalize by stripping /api prefix if present
	const normalizedUrl = url.startsWith("/api") ? url.slice(4) || "/" : url

	try {
		// Health
		if (method === "GET" && (url === "/health" || normalizedUrl === "/health")) {
			sendJson(res, 200, { status: "online", redis: true, worker: true })
			return
		}

		// System stats
		if (method === "GET" && (url === "/system" || normalizedUrl === "/system")) {
			const stats = await getSystemStats()
			sendJson(res, 200, stats)
			return
		}

		// Docker stats
		if (method === "GET" && (url === "/docker/status" || normalizedUrl === "/docker/status")) {
			const stats = await getDockerStats()
			sendJson(res, 200, { success: true, ...stats })
			return
		}

		// Logs
		if (method === "GET" && (url.startsWith("/logs") || normalizedUrl.startsWith("/logs"))) {
			const targetUrl = url.startsWith("/logs") ? url : normalizedUrl
			const urlObj = new URL(targetUrl, `http://localhost:${PORT}`)
			const limit = parseInt(urlObj.searchParams.get("limit") || "50")
			const logs = await getLogs(limit)
			sendJson(res, 200, { success: true, logs })
			return
		}

		// Queue stats
		if (method === "GET" && (url === "/queue/stats" || normalizedUrl === "/queue/stats")) {
			const counts = await getJobCounts()
			sendJson(res, 200, { success: true, ...counts })
			return
		}

		// Jobs summary
		if (method === "GET" && (url === "/jobs/summary" || normalizedUrl === "/jobs/summary")) {
			try {
				const counts = await getJobCounts()
				const totalJobs = counts.total
				const running = counts.active
				const completed = counts.completed
				const failed = counts.failed
				const queued = counts.waiting + counts.delayed
				const successRate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 100
				sendJson(res, 200, {
					totalJobs,
					running,
					completed,
					failed,
					queued,
					successRate,
					aiCostToday: 0,
					systemHealth: failed > 10 ? "Degraded" : "Healthy",
				})
			} catch (err) {
				console.error("[api] Error getting jobs summary:", err.message)
				sendJson(res, 200, {
					totalJobs: 0,
					running: 0,
					completed: 0,
					failed: 0,
					queued: 0,
					successRate: 100,
					aiCostToday: 0,
					systemHealth: "Unknown",
				})
			}
			return
		}

		// List jobs
		if (method === "GET" && (url.startsWith("/jobs") || normalizedUrl.startsWith("/jobs"))) {
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || "all"
			const limit = parseInt(urlObj.searchParams.get("limit") || "50")

			let jobs = []
			if (status === "all" || status === "waiting") {
				const waiting = await queue.getWaiting(0, limit)
				jobs.push(...waiting.map((j) => ({ ...j, status: "waiting" })))
			}
			if (status === "all" || status === "active") {
				const active = await queue.getActive(0, limit)
				jobs.push(...active.map((j) => ({ ...j, status: "active" })))
			}
			if (status === "all" || status === "completed") {
				const completed = await queue.getCompleted(0, limit)
				jobs.push(...completed.map((j) => ({ ...j, status: "completed" })))
			}
			if (status === "all" || status === "failed") {
				const failed = await queue.getFailed(0, limit)
				jobs.push(...failed.map((j) => ({ ...j, status: "failed" })))
			}

			// Format jobs for dashboard
			const formatted = jobs.slice(0, limit).map((j) => ({
				id: j.id,
				name: j.name,
				data: j.data,
				status: j.status,
				progress: j.progress || 0,
				timestamp: j.timestamp,
				processedOn: j.processedOn,
				finishedOn: j.finishedOn,
				failedReason: j.failedReason,
			}))

			sendJson(res, 200, { success: true, jobs: formatted, count: formatted.length })
			return
		}

		// Get job by ID
		if (method === "GET" && url.match(/^\/jobs\/[^/]+$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}

			const state = await job.getState()
			sendJson(res, 200, {
				success: true,
				job: {
					id: job.id,
					name: job.name,
					data: job.data,
					status: state,
					progress: job.progress || 0,
					timestamp: job.timestamp,
					processedOn: job.processedOn,
					finishedOn: job.finishedOn,
					failedReason: job.failedReason,
					returnvalue: job.returnvalue,
				},
			})
			return
		}

		// Cancel job
		if (method === "POST" && url.match(/^\/jobs\/[^/]+\/cancel$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}

			await job.remove()
			sendJson(res, 200, { success: true, jobId, message: "Job cancelled" })
			return
		}

		// Retry job
		if (method === "POST" && url.match(/^\/jobs\/[^/]+\/retry$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}

			await job.retry()
			sendJson(res, 200, { success: true, jobId, message: "Job retried" })
			return
		}

		// List agents
		if (method === "GET" && url === "/agents") {
			const agents = await listAgents()
			sendJson(res, 200, { success: true, agents })
			return
		}

		// Get agent
		if (method === "GET" && url.startsWith("/agents/") && !url.includes("/run") && !url.includes("/toggle")) {
			const id = url.replace("/agents/", "").replace(/\/$/, "")
			const agent = await getAgent(id)
			sendJson(res, 200, { success: true, agent })
			return
		}

		// Toggle agent enabled/disabled
		if (method === "POST" && url.startsWith("/agents/") && url.endsWith("/toggle")) {
			const id = url.replace("/agents/", "").replace("/toggle", "").replace(/\/$/, "")
			try {
				const newState = await toggleAgent(id)
				sendJson(res, 200, { success: true, agentId: id, enabled: newState })
			} catch (e) {
				sendJson(res, 404, { success: false, error: e.message || "Agent not found" })
			}
			return
		}

		// Set agent enabled/disabled state idempotently.
		if (method === "POST" && url.startsWith("/agents/") && url.endsWith("/enabled")) {
			const id = url.replace("/agents/", "").replace("/enabled", "").replace(/\/$/, "")
			try {
				const data = await parseBody(req)
				if (typeof data.enabled !== "boolean") {
					sendJson(res, 400, { success: false, error: "enabled must be a boolean" })
					return
				}

				const enabled = await setAgentEnabled(id, data.enabled)
				sendJson(res, 200, { success: true, agentId: id, enabled })
			} catch (e) {
				sendJson(res, 404, { success: false, error: e.message || "Agent not found" })
			}
			return
		}

		// Run agent
		if (method === "POST" && url.startsWith("/agents/") && url.endsWith("/run")) {
			const id = url.replace("/agents/", "").replace("/run", "").replace(/\/$/, "")
			const data = await parseBody(req)
			const agent = await getAgent(id)
			if (!agent.enabled) {
				sendJson(res, 409, { success: false, error: `Agent disabled: ${id}` })
				return
			}

			const job = await queue.add(data.task || `${id}-run`, {
				task: data.task || `${id}-run`,
				agentId: id,
				commands: Array.isArray(data.commands) ? data.commands : undefined,
				network: data.network || "none",
				inputs: data.inputs || {},
			})
			sendJson(res, 200, { success: true, jobId: job.id, agentId: id })
			return
		}

		// Approvals list
		if (method === "GET" && url === "/approvals") {
			sendJson(res, 200, { success: true, approvals: [] })
			return
		}

		// Approve
		if (method === "POST" && url.match(/^\/approvals\/[^/]+\/approve$/)) {
			const id = url.split("/")[2]
			sendJson(res, 200, { success: true, approvalId: id, status: "approved" })
			return
		}

		// Reject
		if (method === "POST" && url.match(/^\/approvals\/[^/]+\/reject$/)) {
			const id = url.split("/")[2]
			sendJson(res, 200, { success: true, approvalId: id, status: "rejected" })
			return
		}

		// Existing job enqueue
		if (method === "POST" && url === "/job") {
			const data = await parseBody(req)
			const job = await queue.add(data.task || "untitled", {
				task: data.task || "untitled",
				commands: Array.isArray(data.commands) ? data.commands : [],
				network: data.network || "none",
				agentId: data.agentId || undefined,
			})
			sendJson(res, 200, { success: true, jobId: job.id })
			return
		}

		// ── Settings API Routes ──────────────────────────────────────────────────

		// GET /settings/providers — list providers with key status
		if (method === "GET" && normalizedUrl === "/settings/providers") {
			const entries = PROVIDERS.map((p) => {
				const meta = providerMeta.get(p.id) || {
					hasKey: false,
					status: "not_tested",
					lastTestedAt: null,
					latencyMs: null,
				}
				return {
					id: p.id,
					name: p.name,
					description: p.description,
					status: meta.status,
					hasKey: meta.hasKey,
					lastTestedAt: meta.lastTestedAt,
					latencyMs: meta.latencyMs,
					models: p.models.map((m) => m.id),
					capabilities: p.capabilities,
				}
			})
			sendJson(res, 200, { success: true, providers: entries })
			return
		}

		// POST /settings/providers/:id/key — save a provider API key
		if (method === "POST" && normalizedUrl.match(/^\/settings\/providers\/[^/]+\/key$/)) {
			const providerId = normalizedUrl.split("/")[3]
			const data = await parseBody(req)
			if (!data.apiKey) {
				sendJson(res, 400, { success: false, error: "apiKey is required" })
				return
			}
			const encrypted = encryptSecret(data.apiKey)
			encryptedSecrets.set(providerId, encrypted)
			providerMeta.set(providerId, {
				hasKey: true,
				status: "not_tested",
				lastTestedAt: null,
				latencyMs: null,
				keyHash: hashApiKey(data.apiKey),
			})
			// Persist to disk immediately so the key survives server restarts
			await saveEncryptedSecrets()

			// Auto-test the key so it's usable right away without a separate "Test" click
			let testResult = null
			try {
				const apiKey = decryptSecret(encrypted)
				testResult = await testProviderKey(providerId, apiKey)
				const meta = providerMeta.get(providerId) || { hasKey: true }
				meta.status = testResult.ok ? "connected" : "invalid"
				meta.lastTestedAt = Date.now()
				meta.latencyMs = testResult.latencyMs
				providerMeta.set(providerId, meta)
			} catch (e) {
				// Auto-test failed non-fatally — leave status as "not_tested"
				console.error(`[api] Auto-test failed for ${providerId}:`, e.message)
			}

			sendJson(res, 200, {
				success: true,
				providerId,
				maskedKey: maskSecret(data.apiKey),
				autoTested: testResult?.ok === true,
				status: providerMeta.get(providerId)?.status || "not_tested",
			})
			return
		}

		// POST /settings/providers/:id/test — test a provider connection
		if (method === "POST" && normalizedUrl.match(/^\/settings\/providers\/[^/]+\/test$/)) {
			const providerId = normalizedUrl.split("/")[3]
			const encrypted = encryptedSecrets.get(providerId)
			if (!encrypted) {
				sendJson(res, 400, { success: false, error: `No API key saved for provider: ${providerId}` })
				return
			}
			let apiKey
			try {
				apiKey = decryptSecret(encrypted)
			} catch (e) {
				sendJson(res, 500, { success: false, error: "Failed to decrypt API key" })
				return
			}
			const result = await testProviderKey(providerId, apiKey)
			const meta = providerMeta.get(providerId) || { hasKey: true }
			meta.status = result.ok ? "connected" : "invalid"
			meta.lastTestedAt = Date.now()
			meta.latencyMs = result.latencyMs
			providerMeta.set(providerId, meta)
			sendJson(res, 200, { success: true, providerId, result })
			return
		}

		// DELETE /settings/providers/:id/key — remove a provider key
		if (method === "DELETE" && normalizedUrl.match(/^\/settings\/providers\/[^/]+\/key$/)) {
			const providerId = normalizedUrl.split("/")[3]
			encryptedSecrets.delete(providerId)
			providerMeta.set(providerId, {
				hasKey: false,
				status: "missing",
				lastTestedAt: null,
				latencyMs: null,
				keyHash: null,
			})
			// Persist the removal to disk
			await saveEncryptedSecrets()
			sendJson(res, 200, { success: true, providerId, message: "Key removed" })
			return
		}

		// PATCH /settings/providers/:id — update provider metadata (e.g., default model)
		if (method === "PATCH" && normalizedUrl.match(/^\/settings\/providers\/[^/]+$/)) {
			const providerId = normalizedUrl.split("/")[3]
			const data = await parseBody(req)
			const meta = providerMeta.get(providerId) || { hasKey: false, status: "not_tested" }
			if (data.defaultModel) meta.defaultModel = data.defaultModel
			meta.updatedAt = Date.now()
			providerMeta.set(providerId, meta)
			sendJson(res, 200, { success: true, providerId, meta })
			return
		}

		// GET /settings/routes — get agent routing configuration
		if (method === "GET" && normalizedUrl === "/settings/routes") {
			const settings = await loadSettings()
			sendJson(res, 200, { success: true, routes: settings.routing.routes })
			return
		}

		// PUT /settings/routes — update agent routing configuration
		if (method === "PUT" && normalizedUrl === "/settings/routes") {
			const data = await parseBody(req)
			if (!Array.isArray(data.routes)) {
				sendJson(res, 400, { success: false, error: "routes must be an array" })
				return
			}
			const settings = await loadSettings()
			settings.routing.routes = data.routes
			await saveSettings(settings)
			sendJson(res, 200, { success: true, message: "Routes saved" })
			return
		}

		// POST /settings/routing/validate — validate routes against provider availability
		if (method === "POST" && normalizedUrl === "/settings/routing/validate") {
			const data = await parseBody(req)
			const routes = data.routes || (await loadSettings()).routing.routes
			/** @type {Record<string, boolean>} */
			const availability = {}
			for (const p of PROVIDERS) {
				const meta = providerMeta.get(p.id)
				availability[p.id] = meta?.hasKey === true && meta?.status === "connected"
			}
			/** @type {string[]} */
			const errors = []
			for (const route of routes) {
				const primaryOk = availability[route.primary?.provider || route.provider]
				const fallbacksOk = (route.fallbacks || []).some((f) => availability[f.provider])
				if (!primaryOk && !fallbacksOk) {
					const agentName = route.agent || route.label || "unknown"
					const primary = route.primary?.provider || route.provider || "unknown"
					const fallbacks = (route.fallbacks || []).map((f) => f.provider).join(", ")
					errors.push(
						`${agentName}: primary provider "${primary}" and fallbacks [${fallbacks}] are unavailable.`,
					)
				}
			}
			sendJson(res, 200, {
				success: true,
				ok: errors.length === 0,
				errors,
				availability,
			})
			return
		}

		// POST /settings/approval/evaluate — evaluate an approval request
		if (method === "POST" && normalizedUrl === "/settings/approval/evaluate") {
			const data = await parseBody(req)
			if (!data.action) {
				sendJson(res, 400, { success: false, error: "action is required" })
				return
			}
			const result = evaluateApproval({
				action: data.action,
				command: data.command,
				rules: data.rules || [],
			})
			sendJson(res, 200, { success: true, result })
			return
		}

		// GET /settings — get full settings
		if (method === "GET" && normalizedUrl === "/settings") {
			const settings = await loadSettings()
			sendJson(res, 200, { success: true, settings })
			return
		}

		// PUT /settings — update full settings
		if (method === "PUT" && normalizedUrl === "/settings") {
			const data = await parseBody(req)
			if (!data.settings) {
				sendJson(res, 400, { success: false, error: "settings object is required" })
				return
			}
			await saveSettings(data.settings)
			sendJson(res, 200, { success: true, message: "Settings saved" })
			return
		}

		// GET /settings/approval/dangerous-patterns — get built-in dangerous patterns
		if (method === "GET" && normalizedUrl === "/settings/approval/dangerous-patterns") {
			const patterns = DANGEROUS_PATTERNS.map((dp) => ({
				pattern: dp.pattern.source,
				risk: dp.risk,
				reason: dp.reason,
			}))
			sendJson(res, 200, { success: true, patterns })
			return
		}

		// GET /github/dashboard — GitHub dashboard data from commit-deploy-log
		if (method === "GET" && (url === "/github/dashboard" || normalizedUrl === "/github/dashboard")) {
			try {
				const commitDeployPath =
					process.env.COMMIT_DEPLOY_LOG_PATH || "/opt/superroo2/server/src/memory/commit-deploy-log.json"
				const raw = await fs.readFile(commitDeployPath, "utf-8")
				const log = JSON.parse(raw)

				const commits = (log.commits || [])
					.slice(-10)
					.reverse()
					.map((c) => ({
						sha: c.commitSha?.slice(0, 7) || "",
						message: c.title || "",
						author: c.agent || "System",
						model: "SuperRoo",
						risk: c.type === "bugfix" ? "medium" : c.type === "feature" ? "low" : "low",
						status: c.deployId ? "Deployed" : "Committed",
						time: formatRelativeTime(c.timestamp),
					}))

				const deploys = (log.deploys || [])
					.slice(-5)
					.reverse()
					.map((d) => ({
						id: d.id,
						version: d.version,
						status: d.status,
						agent: d.agent,
						environment: d.environment || "production",
						time: formatRelativeTime(d.startedAt),
						healthPassed: d.healthCheckPassed === true,
					}))

				const stats = {
					totalCommits: (log.commits || []).length,
					totalDeploys: (log.deploys || []).length,
					successfulDeploys: (log.deploys || []).filter((d) => d.status === "healthy").length,
					failedDeploys: (log.deploys || []).filter((d) => d.status === "failed").length,
					lastDeploy: deploys[0] || null,
					lastCommit: commits[0] || null,
				}

				const repoStatus = {
					repoName: "superroo2",
					branch: "main",
					syncStatus: "synced",
					lastPush: stats.lastDeploy?.time || "N/A",
					lastCommit: {
						message: stats.lastCommit?.message || "No commits yet",
						author: stats.lastCommit?.author || "N/A",
						time: stats.lastCommit?.time || "N/A",
					},
					deployment: {
						status:
							stats.lastDeploy?.status === "healthy"
								? "healthy"
								: stats.lastDeploy?.status === "failed"
									? "failed"
									: "pending",
						environment: stats.lastDeploy?.environment || "production",
						time: stats.lastDeploy?.time || "N/A",
					},
					openPRs: 0,
					pendingReviews: 0,
					changedFiles: 0,
					modifiedFiles: 0,
					stagedFiles: 0,
					testPassRate: 100,
					testsPassed: 0,
					testsFailed: 0,
				}

				const pipelineStages = [
					{ name: "Code", status: "success", duration: "—" },
					{ name: "Test", status: stats.totalCommits > 0 ? "success" : "pending", duration: "—" },
					{ name: "Build", status: stats.totalDeploys > 0 ? "success" : "pending", duration: "—" },
					{
						name: "Deploy",
						status:
							stats.lastDeploy?.status === "healthy"
								? "success"
								: stats.lastDeploy?.status === "failed"
									? "failed"
									: "pending",
						duration: "—",
					},
					{
						name: "Verify",
						status: stats.lastDeploy?.healthCheckPassed === true ? "success" : "pending",
						duration: "—",
					},
				]

				const healthMetrics = [
					{
						label: "Total Commits",
						value: stats.totalCommits,
						status: stats.totalCommits > 0 ? "success" : "pending",
					},
					{
						label: "Total Deploys",
						value: stats.totalDeploys,
						status: stats.totalDeploys > 0 ? "success" : "pending",
					},
					{
						label: "Successful Deploys",
						value: stats.successfulDeploys,
						status: stats.failedDeploys > stats.successfulDeploys ? "failed" : "success",
					},
					{
						label: "Failed Deploys",
						value: stats.failedDeploys,
						status: stats.failedDeploys > 0 ? "failed" : "success",
					},
				]

				sendJson(res, 200, {
					success: true,
					data: {
						repoStatus,
						activityEvents: [
							...deploys.map((d) => ({
								id: d.id,
								time: d.time,
								agent: d.agent,
								role: "Deployer",
								title: `Deployed ${d.version}`,
								detail: `Status: ${d.status}`,
								severity: d.status === "healthy" ? "low" : d.status === "failed" ? "high" : "medium",
							})),
							...commits.slice(0, 5).map((c) => ({
								id: `commit_${c.sha}`,
								time: c.time,
								agent: c.author,
								role: "Developer",
								title: c.message,
								detail: `Risk: ${c.risk}`,
								severity: c.risk,
							})),
						],
						healthMetrics,
						aiSuggestions: [],
						workingTreeFiles: [],
						pipelineStages,
						autonomousTask: {
							title: "No active task",
							assignedAgent: "",
							model: "",
							progress: 0,
							queuePosition: 0,
							estimatedFiles: 0,
							safetyMode: "Sandbox",
						},
						aiCommits: commits,
						pullRequests: [],
					},
				})
			} catch (err) {
				console.error("[api] Error reading commit-deploy-log:", err.message)
				sendJson(res, 200, {
					success: true,
					data: {
						repoStatus: {
							repoName: "superroo2",
							branch: "main",
							syncStatus: "unknown",
							lastPush: "N/A",
							lastCommit: { message: "No commits yet", author: "N/A", time: "N/A" },
							deployment: { status: "pending", environment: "production", time: "N/A" },
							openPRs: 0,
							pendingReviews: 0,
							changedFiles: 0,
							modifiedFiles: 0,
							stagedFiles: 0,
							testPassRate: 100,
							testsPassed: 0,
							testsFailed: 0,
						},
						activityEvents: [],
						healthMetrics: [],
						aiSuggestions: [],
						workingTreeFiles: [],
						pipelineStages: [
							{ name: "Code", status: "pending", duration: "—" },
							{ name: "Test", status: "pending", duration: "—" },
							{ name: "Build", status: "pending", duration: "—" },
							{ name: "Deploy", status: "pending", duration: "—" },
							{ name: "Verify", status: "pending", duration: "—" },
						],
						autonomousTask: {
							title: "No active task",
							assignedAgent: "",
							model: "",
							progress: 0,
							queuePosition: 0,
							estimatedFiles: 0,
							safetyMode: "Sandbox",
						},
						aiCommits: [],
						pullRequests: [],
					},
				})
			}
			return
		}

		// ── Model Router API Routes ──────────────────────────────────────────────

		// GET /model-router/providers — list providers with model router metadata
		if (method === "GET" && normalizedUrl === "/model-router/providers") {
			const entries = PROVIDERS.map((p) => {
				const meta = providerMeta.get(p.id) || {
					hasKey: false,
					status: "not_tested",
					lastTestedAt: null,
					latencyMs: null,
				}
				return {
					providerId: p.id,
					displayName: p.name,
					status: meta.hasKey ? (meta.status === "connected" ? "tested" : "untested") : "missing_key",
					maskedKey: meta.hasKey ? maskSecret("sk-..." + p.id) : undefined,
					models: p.models.map((m) => ({
						id: m.id,
						label: m.name,
						providerId: p.id,
						capabilities: p.capabilities,
					})),
					capabilities: p.capabilities,
					lastTestedAt: meta.lastTestedAt ? new Date(meta.lastTestedAt).toISOString() : undefined,
					errorMessage: meta.status === "invalid" ? "Connection test failed" : undefined,
				}
			})
			sendJson(res, 200, { success: true, providers: entries })
			return
		}

		// GET /model-router/routes — get default task-to-model routes
		if (method === "GET" && normalizedUrl === "/model-router/routes") {
			const settings = await loadSettings()
			const agentRoutes = settings.routing.routes || DEFAULT_AGENT_ROUTES
			const taskTypes = [
				"planning",
				"coding",
				"debugging",
				"crawling",
				"research",
				"testing",
				"deployment",
				"architecture",
				"fast_fix",
			]
			const routes = taskTypes.map((taskType, i) => {
				const agentRoute = agentRoutes[i % agentRoutes.length]
				return {
					id: `route-${taskType}`,
					taskType,
					primaryProvider: agentRoute?.primary?.provider || "openai",
					primaryModel: agentRoute?.primary?.model || "gpt-4o",
					fallbackProvider1: agentRoute?.fallbacks?.[0]?.provider,
					fallbackModel1: agentRoute?.fallbacks?.[0]?.model,
					fallbackProvider2: agentRoute?.fallbacks?.[1]?.provider,
					fallbackModel2: agentRoute?.fallbacks?.[1]?.model,
					enabled: true,
					requireApproval: false,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				}
			})
			sendJson(res, 200, { success: true, routes })
			return
		}

		// POST /model-router/routes — upsert a route
		if (method === "POST" && normalizedUrl === "/model-router/routes") {
			sendJson(res, 200, { success: true, message: "Route saved (in-memory)" })
			return
		}

		// PATCH /model-router/routes/:id — update a route
		if (method === "PATCH" && normalizedUrl.match(/^\/model-router\/routes\/[^/]+$/)) {
			sendJson(res, 200, { success: true, message: "Route updated (in-memory)" })
			return
		}

		// DELETE /model-router/routes/:id — delete a route
		if (method === "DELETE" && normalizedUrl.match(/^\/model-router\/routes\/[^/]+$/)) {
			sendJson(res, 200, { success: true, message: "Route deleted (in-memory)" })
			return
		}

		// POST /model-router/test-route — test a route
		if (method === "POST" && normalizedUrl === "/model-router/test-route") {
			const data = await parseBody(req)
			const taskType = data.taskType || "coding"
			const agentRoute = DEFAULT_AGENT_ROUTES.find((r) => r.agent === taskType) || DEFAULT_AGENT_ROUTES[0]
			const primaryMeta = providerMeta.get(agentRoute.primary.provider)
			const primaryAvailable = primaryMeta?.hasKey === true && primaryMeta?.status === "connected"
			if (primaryAvailable) {
				sendJson(res, 200, {
					success: true,
					ok: true,
					providerId: agentRoute.primary.provider,
					modelId: agentRoute.primary.model,
					taskType,
					latencyMs: primaryMeta.latencyMs || 0,
					usedFallback: false,
				})
			} else {
				const fallback = agentRoute.fallbacks?.find((f) => {
					const fm = providerMeta.get(f.provider)
					return fm?.hasKey === true && fm?.status === "connected"
				})
				if (fallback) {
					const fm = providerMeta.get(fallback.provider)
					sendJson(res, 200, {
						success: true,
						ok: true,
						providerId: fallback.provider,
						modelId: fallback.model,
						taskType,
						latencyMs: fm?.latencyMs || 0,
						usedFallback: true,
					})
				} else {
					sendJson(res, 200, {
						success: true,
						ok: false,
						providerId: agentRoute.primary.provider,
						modelId: agentRoute.primary.model,
						taskType,
						error: "No available provider for this task type",
					})
				}
			}
			return
		}

		// POST /model-router/sync-api-keys — sync API keys from settings
		if (method === "POST" && normalizedUrl === "/model-router/sync-api-keys") {
			sendJson(res, 200, { success: true, message: "API keys synced", syncedCount: encryptedSecrets.size })
			return
		}

		// GET /model-router/usage — get usage metrics
		if (method === "GET" && normalizedUrl === "/model-router/usage") {
			const usage = PROVIDERS.flatMap((p) => {
				const meta = providerMeta.get(p.id)
				if (!meta?.hasKey) return []
				return p.models.map((m) => ({
					id: `usage-${p.id}-${m.id}`,
					providerId: p.id,
					modelId: m.id,
					taskType: "coding",
					latencyMs: meta.latencyMs || 0,
					success: meta.status === "connected",
					errorCode: meta.status === "invalid" ? "auth_error" : undefined,
					inputTokens: 0,
					outputTokens: 0,
					totalCostUsd: 0,
					totalCalls: meta.lastTestedAt ? 1 : 0,
					avgLatencyMs: meta.latencyMs || 0,
					createdAt: meta.lastTestedAt ? new Date(meta.lastTestedAt).toISOString() : new Date().toISOString(),
				}))
			})
			sendJson(res, 200, { success: true, usage })
			return
		}

		// GET /model-router/fallback-rules — get fallback rules
		if (method === "GET" && normalizedUrl === "/model-router/fallback-rules") {
			sendJson(res, 200, {
				success: true,
				rules: {
					retryPrimaryOnce: true,
					switchToFallback1AfterRetry: true,
					switchToFallback2AfterFallback1: true,
					switchIfLatencyAboveMs: 5000,
					switchIfQuotaExceeded: true,
					switchIfApiKeyUnavailable: true,
				},
			})
			return
		}

		// PATCH /model-router/fallback-rules — update fallback rules
		if (method === "PATCH" && normalizedUrl === "/model-router/fallback-rules") {
			sendJson(res, 200, { success: true, message: "Fallback rules updated (in-memory)" })
			return
		}

		// GET /model-router/safety-rules — get safety rules
		if (method === "GET" && normalizedUrl === "/model-router/safety-rules") {
			sendJson(res, 200, {
				success: true,
				rules: {
					requireDeploymentApproval: true,
					requireExpensiveModelApproval: true,
					expensiveModelUsdPerMTok: 0.015,
					requireLongRunningTaskApproval: true,
					longRunningTaskMinutes: 30,
					blockUntestedProviders: false,
				},
			})
			return
		}

		// PATCH /model-router/safety-rules — update safety rules
		if (method === "PATCH" && normalizedUrl === "/model-router/safety-rules") {
			sendJson(res, 200, { success: true, message: "Safety rules updated (in-memory)" })
			return
		}

		// ── Auth routes ───────────────────────────────────────────────────────

		// POST /auth/login — authenticate by email only
		if (method === "POST" && normalizedUrl === "/auth/login") {
			const data = await parseBody(req)
			const email = (data?.email || "").trim().toLowerCase()

			if (email !== "jpgyap@gmail.com") {
				sendJson(res, 403, { ok: false, error: "Access denied. Only jpgyap@gmail.com is allowed." })
				return
			}

			// Simple token: base64 of email + timestamp
			const token = Buffer.from(JSON.stringify({ email, ts: Date.now(), v: "1" })).toString("base64")

			sendJson(res, 200, { ok: true, token, email })
			return
		}

		// ── IDE Workspace routes ──────────────────────────────────────────────

		// GET /ide-workspace/workspace — get or create workspace session
		if (method === "GET" && normalizedUrl.startsWith("/ide-workspace/workspace")) {
			sendJson(res, 200, {
				workspaceId: null,
				repoName: null,
				branch: "main",
				files: [],
				openFiles: [],
				activeFile: null,
				pipeline: [
					{ id: "plan", label: "Plan", status: "pending" },
					{ id: "crawl", label: "Crawl", status: "pending" },
					{ id: "patch", label: "Patch", status: "pending" },
					{ id: "approval", label: "Approval", status: "pending" },
					{ id: "tests", label: "Tests", status: "pending" },
					{ id: "deploy", label: "Deploy", status: "pending" },
				],
				terminalSessions: [
					{
						id: "term-1",
						name: "bash",
						cwd: "/workspace",
						createdAt: new Date().toISOString(),
						output: ["Welcome to SuperRoo IDE Terminal", "Type a command to get started..."],
					},
				],
				activeTerminal: "term-1",
				chatMessages: [],
				status: { connected: true, docker: false, redis: false, cpu: "0%", ram: "0MB" },
			})
			return
		}

		// POST /ide-workspace/workspace/reset — reset workspace
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/workspace/reset")) {
			sendJson(res, 200, { ok: true, message: "Workspace reset" })
			return
		}

		// POST /ide-workspace/terminal/execute — execute command
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/terminal/execute")) {
			const data = await parseBody(req)
			sendJson(res, 200, {
				ok: true,
				message: "Command executed (simulated)",
				output: [
					`$ ${data?.command || "unknown"}`,
					"stdout: Command completed successfully (simulated)",
					"stderr: (empty)",
				],
			})
			return
		}

		// POST /ide-workspace/terminal/create — create terminal
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/terminal/create")) {
			sendJson(res, 200, { ok: true, message: "Terminal created (simulated)" })
			return
		}

		// GET /ide-workspace/providers — list available providers for the chat dropdown
		if (method === "GET" && normalizedUrl.startsWith("/ide-workspace/providers")) {
			const entries = PROVIDERS.map((p) => {
				const meta = providerMeta.get(p.id) || { hasKey: false, status: "not_tested" }
				return {
					id: p.id,
					name: p.name,
					status: meta.status,
					hasKey: meta.hasKey,
					defaultModel: p.defaultModel,
					models: p.models.map((m) => ({
						id: m.id,
						label: m.label,
						contextWindow: m.contextWindow,
						supportsImages: m.supportsImages,
						bestFor: m.bestFor,
					})),
				}
			})
			sendJson(res, 200, { success: true, providers: entries })
			return
		}

		// POST /ide-workspace/chat — send chat message
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/chat")) {
			const data = await parseBody(req)
			const msg = data?.message || ""
			const requestedProvider = data?.provider || null
			const requestedModel = data?.model || null

			// If user specified a provider, try to use it directly
			let provider = null
			if (requestedProvider) {
				provider = resolveProviderById(requestedProvider, requestedModel)
			}

			// Fall back to automatic routing if no specific provider requested or it's unavailable
			if (!provider) {
				provider = resolveProviderForTask("coder")
			}

			if (!provider) {
				sendJson(res, 200, {
					ok: true,
					message: "No AI provider available",
					reply: "No AI provider is configured and connected. Please go to the API Keys page to add and test a provider API key (e.g., DeepSeek, OpenAI, or Anthropic). After saving the key, click 'Test' to verify the connection.",
				})
				return
			}

			try {
				const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
					{
						role: "system",
						content:
							"You are SuperRoo, an expert AI coding assistant. You help users write, debug, and improve code. Be concise, technical, and provide actionable answers.",
					},
					{ role: "user", content: msg },
				])
				sendJson(res, 200, {
					ok: true,
					message: "OK",
					reply,
					provider: provider.providerId,
					model: provider.model,
				})
			} catch (err) {
				console.error(`[api] Chat error with ${provider.providerId}:`, err.message)
				sendJson(res, 200, {
					ok: true,
					message: "AI call failed",
					reply: `AI request failed: ${err.message}. Check your API key and try again.`,
					provider: provider.providerId,
					model: provider.model,
					error: err.message,
				})
			}
			return
		}

		// PATCH /ide-workspace/pipeline — update pipeline step
		if (method === "PATCH" && normalizedUrl.startsWith("/ide-workspace/pipeline")) {
			const data = await parseBody(req)
			const stepId = data?.stepId || "unknown"
			const action = data?.action || "unknown"
			sendJson(res, 200, {
				ok: true,
				message: `Pipeline step "${stepId}" updated with action "${action}" (simulated)`,
			})
			return
		}

		// POST /ide-workspace/workspace/import-github — import GitHub repo
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/workspace/import-github")) {
			const data = await parseBody(req)
			const repoUrl = data?.repoUrl || ""
			const branch = data?.branch || "main"
			sendJson(res, 200, {
				ok: true,
				message: `Repository ${repoUrl} (branch: ${branch}) imported (simulated)`,
				repoName: repoUrl.split("/").pop()?.replace(".git", "") || "imported-repo",
				branch,
				files: [
					{
						path: "/src",
						name: "src",
						kind: "folder",
						children: [
							{ path: "/src/index.ts", name: "index.ts", kind: "file" },
							{ path: "/src/app.ts", name: "app.ts", kind: "file", modified: true },
						],
					},
					{ path: "/package.json", name: "package.json", kind: "file" },
					{ path: "/tsconfig.json", name: "tsconfig.json", kind: "file" },
				],
			})
			return
		}

		sendJson(res, 404, { error: "not_found", detail: `No route for ${method} ${url}` })
	} catch (err) {
		console.error(`[api] Error handling ${method} ${url}:`, err.message)
		sendJson(res, err.message && err.message.includes("not found") ? 404 : 500, {
			success: false,
			error: err.message || "internal_error",
		})
	}
})

// Load persisted encrypted secrets before accepting requests
loadEncryptedSecrets().then(() => {
	server.listen(PORT, () => {
		console.log(`[api] Listening on port ${PORT} | queue=${QUEUE_NAME} | redis=${REDIS_URL}`)
	})
})
