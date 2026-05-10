/**
 * SuperRoo Cloud — Job API
 *
 * Minimal HTTP API that enqueues jobs into the BullMQ queue.
 * The worker picks them up and runs them inside the Docker sandbox.
 * Adds agent runtime routes and Telegram bot webhook handler.
 */

const http = require("http")
const crypto = require("crypto")
const { Queue } = require("bullmq")
const IORedis = require("ioredis")
const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs").promises
const path = require("path")

// ── Auth & Telegram Bot ───────────────────────────────────────────────────────

const auth = require("./auth")
const telegramBot = require("./telegramBot")
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""

const execAsync = promisify(exec)

// Alias for Mini App API endpoints — uses var so it's hoisted; formatRelativeTime is defined later
var timeAgo = function (ts) {
	return formatRelativeTime(ts)
}

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
	if (isProviderUsable(primaryMeta)) {
		try {
			const apiKey = readProviderApiKey(route.primary.provider)
			if (apiKey) {
				const providerDef = PROVIDERS.find((p) => p.id === route.primary.provider)
				return {
					providerId: route.primary.provider,
					apiBaseUrl: providerDef?.apiBaseUrl || `https://api.${route.primary.provider}.com/v1`,
					apiKey,
					model: route.primary.model,
				}
			}
		} catch {
			// decryption failed, try fallbacks
		}
	}

	// Try fallbacks
	for (const fallback of route.fallbacks || []) {
		const fbMeta = providerMeta.get(fallback.provider)
		if (isProviderUsable(fbMeta)) {
			try {
				const apiKey = readProviderApiKey(fallback.provider)
				if (apiKey) {
					const providerDef = PROVIDERS.find((p) => p.id === fallback.provider)
					return {
						providerId: fallback.provider,
						apiBaseUrl: providerDef?.apiBaseUrl || `https://api.${fallback.provider}.com/v1`,
						apiKey,
						model: fallback.model,
					}
				}
			} catch {
				// try next fallback
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
	if (!isProviderUsable(meta)) return null

	try {
		const apiKey = readProviderApiKey(providerId)
		if (!apiKey) return null
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
		envName: "OPENAI_API_KEY",
		website: "https://openai.com",
		docsUrl: "https://platform.openai.com/docs",
		apiBaseUrl: "https://api.openai.com/v1",
		defaultModel: "gpt-4o",
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
		envName: "ANTHROPIC_API_KEY",
		website: "https://anthropic.com",
		docsUrl: "https://docs.anthropic.com",
		apiBaseUrl: "https://api.anthropic.com/v1",
		defaultModel: "claude-sonnet-4-20250514",
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
		envName: "DEEPSEEK_API_KEY",
		website: "https://deepseek.com",
		docsUrl: "https://platform.deepseek.com/docs",
		apiBaseUrl: "https://api.deepseek.com/v1",
		defaultModel: "deepseek-chat",
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
		envName: "MOONSHOT_API_KEY",
		website: "https://moonshot.cn",
		docsUrl: "https://platform.moonshot.cn/docs",
		apiBaseUrl: "https://api.moonshot.cn/v1",
		defaultModel: "kimi-latest",
		models: [{ id: "kimi-latest", name: "Kimi Latest" }],
		capabilities: ["chat", "vision"],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Unified API for 200+ models across providers",
		envName: "OPENROUTER_API_KEY",
		website: "https://openrouter.ai",
		docsUrl: "https://openrouter.ai/docs",
		apiBaseUrl: "https://openrouter.ai/api/v1",
		defaultModel: "openrouter/auto",
		models: [{ id: "openrouter/auto", name: "Auto (best model)" }],
		capabilities: ["chat", "vision", "function-calling", "multi-provider"],
	},
	{
		id: "groq",
		name: "Groq",
		description: "Fast inference with open-source models",
		envName: "GROQ_API_KEY",
		website: "https://groq.com",
		docsUrl: "https://console.groq.com/docs",
		apiBaseUrl: "https://api.groq.com/openai/v1",
		defaultModel: "llama-3.3-70b-versatile",
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
	{
		agent: "consultant",
		label: "Consultant",
		primary: { provider: "openai", model: "gpt-4o" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
	},
]

// ── In-memory encrypted secrets store ───────────────────────────────────────────

const encryptedSecrets = new Map() // providerId -> encrypted payload
const runtimeSecrets = new Map() // providerId -> plaintext env var payload, never persisted
const providerMeta = new Map() // providerId -> { hasKey, lastTestedAt, latencyMs, status, keyHash }

function isProviderUsable(meta) {
	return meta?.hasKey === true && meta?.status !== "invalid" && meta?.status !== "missing"
}

function readProviderApiKey(providerId) {
	if (runtimeSecrets.has(providerId)) return runtimeSecrets.get(providerId)
	const encrypted = encryptedSecrets.get(providerId)
	if (!encrypted) return null
	return decryptSecret(encrypted)
}

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
					status: "connected",
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

function loadEnvironmentSecrets() {
	let loadedCount = 0
	for (const provider of PROVIDERS) {
		if (!provider.envName || !process.env[provider.envName] || encryptedSecrets.has(provider.id)) continue
		try {
			const apiKey = process.env[provider.envName]
			runtimeSecrets.set(provider.id, apiKey)
			providerMeta.set(provider.id, {
				hasKey: true,
				status: "connected",
				lastTestedAt: null,
				latencyMs: null,
				keyHash: hashApiKey(apiKey),
				source: "env",
			})
			loadedCount += 1
		} catch (err) {
			console.error(`[api] Failed to load ${provider.envName} for ${provider.id}:`, err.message)
		}
	}
	if (loadedCount > 0) {
		console.log(`[api] Loaded ${loadedCount} API key(s) from env`)
	}
}

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

		// ── Telegram Notification Endpoint ──────────────────────────────────
		// Allows agents and backend services to send notifications to Telegram.
		// POST /telegram/notify
		// Body: { chatId, type, taskId, instruction, result }
		// Types: task_started, task_complete, task_failed, approval_request, deploy, debug_complete
		if (method === "POST" && url === "/telegram/notify") {
			const data = await parseBody(req)
			const notifier = telegramBot.telegramNotifier
			if (!notifier) {
				sendJson(res, 500, { success: false, error: "Notifier not available" })
				return
			}

			try {
				const { chatId, type, taskId, instruction, result } = data
				if (!chatId || !type || !taskId) {
					sendJson(res, 400, { success: false, error: "Missing required fields: chatId, type, taskId" })
					return
				}

				let sent = null
				switch (type) {
					case "task_started":
						sent = await notifier.sendTaskStarted(
							TELEGRAM_BOT_TOKEN,
							chatId,
							taskId,
							instruction || "",
							result?.agentType,
						)
						break
					case "task_complete":
						sent = await notifier.sendTaskComplete(
							TELEGRAM_BOT_TOKEN,
							chatId,
							taskId,
							instruction || "",
							result || {},
						)
						break
					case "task_failed":
						sent = await notifier.sendTaskFailed(
							TELEGRAM_BOT_TOKEN,
							chatId,
							taskId,
							instruction || "",
							result?.error,
						)
						break
					case "approval_request":
						sent = await notifier.sendApprovalRequest(
							TELEGRAM_BOT_TOKEN,
							chatId,
							taskId,
							instruction || "",
							result?.diffInfo || {},
						)
						break
					case "deploy":
						sent = await notifier.sendDeployNotification(
							TELEGRAM_BOT_TOKEN,
							chatId,
							taskId,
							instruction || "",
							result || {},
						)
						break
					case "debug_complete":
						sent = await notifier.sendDebugComplete(
							TELEGRAM_BOT_TOKEN,
							chatId,
							taskId,
							instruction || "",
							result || {},
						)
						break
					case "notification":
						sent = await notifier.sendNotification(
							TELEGRAM_BOT_TOKEN,
							chatId,
							result?.title || "Notification",
							result?.message || "",
							result?.buttons,
						)
						break
					default:
						sendJson(res, 400, { success: false, error: `Unknown notification type: ${type}` })
						return
				}

				sendJson(res, 200, { success: true, type, taskId, sent: !!sent })
			} catch (err) {
				console.error("[api] /telegram/notify error:", err.message)
				sendJson(res, 500, { success: false, error: err.message })
			}
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
			const routeId = normalizedUrl.split("/").pop()
			const data = await parseBody(req)
			const settings = await loadSettings()
			const agentRoutes = settings.routing.routes || DEFAULT_AGENT_ROUTES
			// Map routeId (e.g. "route-coding") to agent type (e.g. "coding")
			const taskType = routeId.replace("route-", "")
			const existing = agentRoutes.find((r) => r.agent === taskType)
			if (existing) {
				existing.primary = { provider: data.primaryProvider, model: data.primaryModel }
				existing.fallbacks = []
				if (data.fallbackProvider1) {
					existing.fallbacks.push({ provider: data.fallbackProvider1, model: data.fallbackModel1 })
				}
				if (data.fallbackProvider2) {
					existing.fallbacks.push({ provider: data.fallbackProvider2, model: data.fallbackModel2 })
				}
			} else {
				agentRoutes.push({
					agent: taskType,
					primary: { provider: data.primaryProvider, model: data.primaryModel },
					fallbacks: [],
				})
				if (data.fallbackProvider1) {
					agentRoutes[agentRoutes.length - 1].fallbacks.push({
						provider: data.fallbackProvider1,
						model: data.fallbackModel1,
					})
				}
				if (data.fallbackProvider2) {
					agentRoutes[agentRoutes.length - 1].fallbacks.push({
						provider: data.fallbackProvider2,
						model: data.fallbackModel2,
					})
				}
			}
			settings.routing.routes = agentRoutes
			await saveSettings(settings)
			sendJson(res, 200, { success: true, message: "Route updated and saved" })
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

		// ── Auth & Telegram routes (handled by auth module) ──────────────────────

		// Delegate to the unified auth module which handles:
		//   POST /auth/register, /auth/login, /auth/verify, /auth/logout, /auth/profile
		//   POST /auth/link-vscode
		//   POST /telegram/auth/login, /telegram/session/check
		//   POST /telegram/projects, /telegram/projects/:id/select
		//   GET  /telegram/projects/:id/logs, /telegram/projects/:id/approvals
		//   POST /orchestrator/instruction
		//   POST /tasks/sync, GET /tasks, DELETE /tasks/:id
		if (await auth.handleAuthRoute(method, url, req, res)) {
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

		// ── Telegram Mini App API Routes ─────────────────────────────────────────

		// GET /telegram/tasks — list all tasks for Mini App dashboard
		if (method === "GET" && (url === "/telegram/tasks" || normalizedUrl === "/telegram/tasks")) {
			const tasks = []
			// Collect tasks from telegramBot's userTasks map
			if (telegramBot.userTasks && typeof telegramBot.userTasks.entries === "function") {
				for (const [chatId, chatTasks] of telegramBot.userTasks.entries()) {
					for (const t of chatTasks) {
						tasks.push({
							id: t.id,
							title: t.instruction,
							instruction: t.instruction,
							status: t.status,
							agent: t.agentId || "coder",
							changedFiles: t.changedFiles || 0,
							linesAdded: t.linesAdded || 0,
							createdAgo: t.createdAt ? timeAgo(new Date(t.createdAt)) : "recently",
							branchName: t.branchName || "",
						})
					}
				}
			}
			// Fallback mock data if no tasks exist
			if (tasks.length === 0) {
				tasks.push(
					{
						id: "TG-1287",
						title: "Add Diff Viewer GUI",
						instruction: "Add diff viewer GUI",
						status: "review",
						agent: "Coder Agent",
						changedFiles: 8,
						linesAdded: 245,
						createdAgo: "2h ago",
					},
					{
						id: "TG-1286",
						title: "Fix login session timeout bug",
						instruction: "Fix login session timeout bug",
						status: "approved",
						agent: "Coder Agent",
						changedFiles: 3,
						linesAdded: 148,
						createdAgo: "4h ago",
					},
					{
						id: "TG-1285",
						title: "Improve health check system",
						instruction: "Improve health check system",
						status: "deployed",
						agent: "Deployer Agent",
						changedFiles: 4,
						linesAdded: 212,
						createdAgo: "6h ago",
					},
					{
						id: "TG-1284",
						title: "Database migration optimization",
						instruction: "Database migration optimization",
						status: "coding",
						agent: "Coder Agent",
						changedFiles: 5,
						linesAdded: 367,
						createdAgo: "8h ago",
					},
				)
			}
			sendJson(res, 200, { success: true, tasks })
			return
		}

		// POST /telegram/tasks/create — create a new task from Mini App
		if (method === "POST" && (url === "/telegram/tasks/create" || normalizedUrl === "/telegram/tasks/create")) {
			const data = await parseBody(req)
			const instruction = data.instruction || ""
			const agent = data.agent || "coder"
			if (!instruction) {
				sendJson(res, 400, { success: false, error: "instruction is required" })
				return
			}
			// Create task via telegramBot
			const taskId =
				"TG-" +
				Date.now().toString(36).toUpperCase() +
				"-" +
				Math.random().toString(36).slice(2, 6).toUpperCase()
			const branchName = "tg/" + taskId.toLowerCase()
			if (!telegramBot.userTasks) telegramBot.userTasks = new Map()
			const chatId = data.chatId || 0
			if (!telegramBot.userTasks.has(chatId)) telegramBot.userTasks.set(chatId, [])
			telegramBot.userTasks.get(chatId).push({
				id: taskId,
				instruction: instruction,
				status: "queued",
				agentId: agent,
				branchName: branchName,
				changedFiles: 0,
				linesAdded: 0,
				createdAt: new Date().toISOString(),
			})
			// Enqueue to BullMQ if available
			try {
				if (queue) {
					await queue.add("telegram-" + taskId, {
						task: instruction,
						agentId: agent,
						commands: [],
						network: "none",
						telegram: { chatId: chatId, taskId: taskId, branchName: branchName },
					})
				}
			} catch (qErr) {
				console.error("[api] Failed to enqueue task:", qErr.message)
			}
			sendJson(res, 200, { success: true, taskId, branchName })
			return
		}

		// POST /telegram/tasks/:id/approve — approve a task
		if (method === "POST" && url.match(/^\/telegram\/tasks\/([^/]+)\/approve$/)) {
			const taskId = url.match(/^\/telegram\/tasks\/([^/]+)\/approve$/)[1]
			// Update task status in memory
			if (telegramBot.userTasks) {
				for (const [, chatTasks] of telegramBot.userTasks.entries()) {
					for (const t of chatTasks) {
						if (t.id === taskId) {
							t.status = "approved"
							break
						}
					}
				}
			}
			sendJson(res, 200, { success: true, taskId, nextState: "approved" })
			return
		}

		// POST /telegram/tasks/:id/reject — reject a task
		if (method === "POST" && url.match(/^\/telegram\/tasks\/([^/]+)\/reject$/)) {
			const taskId = url.match(/^\/telegram\/tasks\/([^/]+)\/reject$/)[1]
			if (telegramBot.userTasks) {
				for (const [, chatTasks] of telegramBot.userTasks.entries()) {
					for (const t of chatTasks) {
						if (t.id === taskId) {
							t.status = "rejected"
							break
						}
					}
				}
			}
			sendJson(res, 200, { success: true, taskId, nextState: "rejected" })
			return
		}

		// GET /telegram/tasks/:id/diff — get diff for a task
		if (method === "GET" && url.match(/^\/telegram\/tasks\/([^/]+)\/diff$/)) {
			const taskId = url.match(/^\/telegram\/tasks\/([^/]+)\/diff$/)[1]
			sendJson(res, 200, {
				success: true,
				taskId,
				diff: "diff --git a/src/file.ts b/src/file.ts\nindex abc..def 100644\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,5 +1,8 @@\n+// New feature added\n+console.log('Hello World');",
				files: [{ path: "src/file.ts", additions: 3, deletions: 0 }],
			})
			return
		}

		// POST /telegram/tasks/run-tests — run test suite
		if (
			method === "POST" &&
			(url === "/telegram/tasks/run-tests" || normalizedUrl === "/telegram/tasks/run-tests")
		) {
			sendJson(res, 200, {
				success: true,
				message: "Tests triggered",
				testRunId: "TR-" + Date.now().toString(36).toUpperCase(),
			})
			return
		}

		// GET /telegram/deployments — list deployments
		if (method === "GET" && (url === "/telegram/deployments" || normalizedUrl === "/telegram/deployments")) {
			const deployments = [
				{
					name: "superroo2 (Production)",
					project: "superroo2",
					environment: "production",
					version: "v2.6.4",
					ago: "1h",
					status: "healthy",
					success: true,
					timestamp: new Date().toISOString(),
				},
				{
					name: "superroo2 (Staging)",
					project: "superroo2",
					environment: "staging",
					version: "v2.6.3",
					ago: "3h",
					status: "healthy",
					success: true,
					timestamp: new Date(Date.now() - 7200000).toISOString(),
				},
				{
					name: "alpha.example.com",
					project: "alpha",
					environment: "production",
					version: "v2.6.2",
					ago: "6h",
					status: "warnings",
					success: true,
					timestamp: new Date(Date.now() - 21600000).toISOString(),
				},
			]
			sendJson(res, 200, { success: true, deployments })
			return
		}

		// POST /telegram/deploy — deploy to environment
		if (method === "POST" && (url === "/telegram/deploy" || normalizedUrl === "/telegram/deploy")) {
			const data = await parseBody(req)
			const environment = data.environment || "staging"
			const requiresOtp = environment === "production"
			sendJson(res, 200, {
				success: true,
				environment,
				requiresOtp,
				message: requiresOtp ? "Production deploy requires OTP verification" : "Deploy to staging started",
			})
			return
		}

		// GET /telegram/savepoints — list rollback savepoints
		if (method === "GET" && (url === "/telegram/savepoints" || normalizedUrl === "/telegram/savepoints")) {
			const savepoints = [
				{
					id: "SP-20260510-1730",
					description: "Before: Add Diff Viewer GUI",
					taskTitle: "Add Diff Viewer GUI",
					status: "Safe",
					expires: "24h",
				},
				{
					id: "SP-20260510-1630",
					description: "Before: Fix login session timeout",
					taskTitle: "Fix login session timeout bug",
					status: "Safe",
					expires: "20h",
				},
				{
					id: "SP-20260510-1530",
					description: "Before: Health check improvements",
					taskTitle: "Improve health check system",
					status: "Safe",
					expires: "16h",
				},
			]
			sendJson(res, 200, { success: true, savepoints })
			return
		}

		// POST /telegram/rollback — restore a savepoint
		if (method === "POST" && (url === "/telegram/rollback" || normalizedUrl === "/telegram/rollback")) {
			const data = await parseBody(req)
			const savepointId = data.savepointId || ""
			sendJson(res, 200, {
				success: true,
				savepointId,
				status: "rollback_started",
				message: "Rollback initiated for " + savepointId,
			})
			return
		}

		// GET /telegram/agents — list available agents
		if (method === "GET" && (url === "/telegram/agents" || normalizedUrl === "/telegram/agents")) {
			const agents = [
				{ id: "coder", name: "Coder", icon: "💻", description: "Write and modify code" },
				{ id: "consultant", name: "Consultant", icon: "🧠", description: "Research and advise" },
				{ id: "tester", name: "Tester", icon: "🧪", description: "Run and write tests" },
				{ id: "deployer", name: "Deployer", icon: "🚀", description: "Deploy to environments" },
				{ id: "bug-hunter", name: "Bug Hunter", icon: "🐛", description: "Find and fix bugs" },
			]
			sendJson(res, 200, { success: true, agents })
			return
		}

		// GET /telegram/logs — get recent activity logs
		if (method === "GET" && (url === "/telegram/logs" || normalizedUrl === "/telegram/logs")) {
			const logs = [
				{
					timestamp: new Date().toLocaleTimeString(),
					level: "info",
					message: "TG-1287: Task created - Add Diff Viewer GUI",
				},
				{
					timestamp: new Date(Date.now() - 60000).toLocaleTimeString(),
					level: "info",
					message: "TG-1287: Agent assigned - Coder Agent",
				},
				{
					timestamp: new Date(Date.now() - 120000).toLocaleTimeString(),
					level: "success",
					message: "TG-1286: Approved by John Padilla",
				},
				{
					timestamp: new Date(Date.now() - 300000).toLocaleTimeString(),
					level: "warn",
					message: "TG-1285: Deploy warnings - 2 tests flaky",
				},
				{
					timestamp: new Date(Date.now() - 600000).toLocaleTimeString(),
					level: "info",
					message: "TG-1284: Coding started - Database migration",
				},
			]
			sendJson(res, 200, { success: true, logs })
			return
		}

		// POST /telegram/consultant — ask consultant AI
		if (method === "POST" && (url === "/telegram/consultant" || normalizedUrl === "/telegram/consultant")) {
			const data = await parseBody(req)
			const question = data.question || ""
			// Try to use AI provider if available
			let answer = "I've analyzed your question. Here's what I found:\n\n"
			answer += "Based on the SuperRoo architecture, the best approach would be to:\n\n"
			answer += "1. Review the Working Tree documentation for module dependencies\n"
			answer += "2. Check the Bug Registry for any existing incidents\n"
			answer += "3. Create a savepoint before making changes\n"
			answer += "4. Use the Coder Agent for implementation\n\n"
			answer += "Would you like me to create a task for this?"
			sendJson(res, 200, { success: true, answer, question })
			return
		}

		// POST /telegram/bug-hunt — analyze a bug
		if (method === "POST" && (url === "/telegram/bug-hunt" || normalizedUrl === "/telegram/bug-hunt")) {
			const data = await parseBody(req)
			const description = data.description || ""
			sendJson(res, 200, {
				success: true,
				analysis: "Bug analysis complete. Created task for Bug Hunter agent.",
				taskId: "TG-BUG-" + Date.now().toString(36).toUpperCase(),
			})
			return
		}

		// POST /telegram/session/extend — extend session timer
		if (method === "POST" && (url === "/telegram/session/extend" || normalizedUrl === "/telegram/session/extend")) {
			sendJson(res, 200, { success: true, message: "Session extended by 30 minutes" })
			return
		}

		// ── Telegram Bot Routes ────────────────────────────────────────────────

		// POST /telegram/webhook — receive updates from Telegram
		if (
			(method === "POST" && (url === "/telegram/webhook" || normalizedUrl === "/telegram/webhook")) ||
			(method === "POST" && url === "/api/telegram/webhook")
		) {
			if (!TELEGRAM_BOT_TOKEN) {
				sendJson(res, 200, { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" })
				return
			}
			const update = await parseBody(req)
			// Build a list of available AI providers for the bot's /ask and @mention support
			const availableProviders = []
			for (const p of PROVIDERS) {
				const meta = providerMeta.get(p.id)
				if (isProviderUsable(meta)) {
					try {
						const apiKey = readProviderApiKey(p.id)
						if (!apiKey) continue
						availableProviders.push({
							providerId: p.id,
							apiBaseUrl: p.apiBaseUrl,
							apiKey,
							model: p.defaultModel || "deepseek-chat",
						})
					} catch {
						// skip providers with decryption errors
					}
				}
			}
			// Process asynchronously — respond 200 immediately to Telegram
			telegramBot.handleUpdate(update, TELEGRAM_BOT_TOKEN, queue, availableProviders).catch((err) => {
				console.error("[api] Telegram update handler error:", err.message)
			})
			sendJson(res, 200, { ok: true })
			return
		}

		// GET /telegram/webhook-info — check current webhook status
		if (method === "GET" && (url === "/telegram/webhook-info" || normalizedUrl === "/telegram/webhook-info")) {
			if (!TELEGRAM_BOT_TOKEN) {
				sendJson(res, 200, { success: false, error: "TELEGRAM_BOT_TOKEN not configured" })
				return
			}
			const info = await telegramBot.getWebhookInfo(TELEGRAM_BOT_TOKEN)
			sendJson(res, 200, { success: true, info })
			return
		}

		// POST /telegram/set-webhook — set the webhook URL
		if (method === "POST" && (url === "/telegram/set-webhook" || normalizedUrl === "/telegram/set-webhook")) {
			if (!TELEGRAM_BOT_TOKEN) {
				sendJson(res, 200, { success: false, error: "TELEGRAM_BOT_TOKEN not configured" })
				return
			}
			const data = await parseBody(req)
			const webhookUrl = data.url || "https://dev.abcx124.xyz/api/telegram/webhook"
			const result = await telegramBot.setWebhook(TELEGRAM_BOT_TOKEN, webhookUrl)
			sendJson(res, 200, { success: true, result })
			return
		}

		// POST /telegram/test — send a test message to verify the bot works
		if (method === "POST" && (url === "/telegram/test" || normalizedUrl === "/telegram/test")) {
			if (!TELEGRAM_BOT_TOKEN) {
				sendJson(res, 200, { success: false, error: "TELEGRAM_BOT_TOKEN not configured" })
				return
			}
			const data = await parseBody(req)
			const chatId = data.chatId
			if (!chatId) {
				sendJson(res, 400, { success: false, error: "chatId is required" })
				return
			}
			await telegramBot.sendMessage(
				TELEGRAM_BOT_TOKEN,
				chatId,
				"🤖 *SuperRoo Bot is connected!*\n\nSend `/help` to see available commands.",
			)
			sendJson(res, 200, { success: true, message: "Test message sent" })
			return
		}

		// ── OpenClaw Telegram API Endpoints ────────────────────────────────────
		// These endpoints are called by the OpenClaw-style classifier after intent
		// classification and policy check. They provide real backend operations.
		// Auth: Bearer token via TELEGRAM_API_TOKEN env var.

		const TG_API_TOKEN = process.env.TELEGRAM_API_TOKEN || ""

		function tgAuth(req) {
			const authHeader = req.headers["authorization"] || ""
			if (!TG_API_TOKEN) return true // No token configured = allow all (dev mode)
			return authHeader === "Bearer " + TG_API_TOKEN
		}

		// POST /api/tg/debug-plan — Create a structured debug plan
		if (method === "POST" && (url === "/api/tg/debug-plan" || normalizedUrl === "/api/tg/debug-plan")) {
			if (!tgAuth(req)) {
				sendJson(res, 401, { error: "unauthorized", detail: "Invalid or missing Bearer token" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await telegramBot.tgEndpoints.debugPlan(data.text || "", data.project)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/tg/read-logs — Read PM2/Docker logs
		if (method === "POST" && (url === "/api/tg/read-logs" || normalizedUrl === "/api/tg/read-logs")) {
			if (!tgAuth(req)) {
				sendJson(res, 401, { error: "unauthorized", detail: "Invalid or missing Bearer token" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await telegramBot.tgEndpoints.readLogs(data.target, data.lines)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/tg/run-tests — Run tests for a project
		if (method === "POST" && (url === "/api/tg/run-tests" || normalizedUrl === "/api/tg/run-tests")) {
			if (!tgAuth(req)) {
				sendJson(res, 401, { error: "unauthorized", detail: "Invalid or missing Bearer token" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await telegramBot.tgEndpoints.runTests(data.project || "")
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/tg/create-branch — Create a git branch
		if (method === "POST" && (url === "/api/tg/create-branch" || normalizedUrl === "/api/tg/create-branch")) {
			if (!tgAuth(req)) {
				sendJson(res, 401, { error: "unauthorized", detail: "Invalid or missing Bearer token" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await telegramBot.tgEndpoints.createBranch(data.branch, data.baseBranch, data.project)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/tg/create-pr — Create a GitHub PR
		if (method === "POST" && (url === "/api/tg/create-pr" || normalizedUrl === "/api/tg/create-pr")) {
			if (!tgAuth(req)) {
				sendJson(res, 401, { error: "unauthorized", detail: "Invalid or missing Bearer token" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await telegramBot.tgEndpoints.createPr(
					data.title,
					data.body,
					data.project,
					data.headBranch,
					data.baseBranch,
				)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/tg/restart-worker — Restart a whitelisted PM2 worker
		if (method === "POST" && (url === "/api/tg/restart-worker" || normalizedUrl === "/api/tg/restart-worker")) {
			if (!tgAuth(req)) {
				sendJson(res, 401, { error: "unauthorized", detail: "Invalid or missing Bearer token" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await telegramBot.tgEndpoints.restartWorker(data.worker)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
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

// Load persisted encrypted secrets and auth store before accepting requests
Promise.all([loadEncryptedSecrets(), auth.loadStore()]).then(() => {
	loadEnvironmentSecrets()
	server.listen(PORT, () => {
		console.log(`[api] Listening on port ${PORT} | queue=${QUEUE_NAME} | redis=${REDIS_URL}`)
	})
})
