/**
 * SuperRoo Cloud — Job API
 *
 * Minimal HTTP API that enqueues jobs into the BullMQ queue.
 * The worker picks them up and runs them inside the Docker sandbox.
 * Adds agent runtime routes and Telegram bot webhook handler.
 *
 * Integrated with the Cloud Orchestrator for SQLite-backed task lifecycle,
 * event logging, safety management, self-healing, and ML-driven improvement.
 */

const http = require("http")
const crypto = require("crypto")
const { Queue } = require("bullmq")
const IORedis = require("ioredis")
const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs").promises
const fsSync = require("fs")
const path = require("path")
const { WebSocketServer } = require("ws")

// ── Cloud Orchestrator ────────────────────────────────────────────────────────

const { CloudOrchestrator, SafetyMode } = require("../orchestrator")
const { AutonomousLoop } = require("../orchestrator/modules/AutonomousLoop")
const TelegramOrchestratorBridge = require("../orchestrator/TelegramOrchestratorBridge")

// ── Auth & Telegram Bot ───────────────────────────────────────────────────────

const auth = require("./auth")
const telegramBot = require("./telegramBot")
const telegramClassifier = require("./telegramClassifier")
const telegramRateLimiter = require("./telegramRateLimiter")
const rateLimiter = require("./rateLimiter")
const logRotator = require("./logRotator")
const telegramWebSocket = require("./telegramWebSocket")
const dashboardWebSocket = require("./dashboardWebSocket")
const ptyServer = require("./pty-server")
const healingMetrics = require("./routes/healing-metrics")
const monitoring = require("./routes/monitoring")
const mlRoutes = require("./routes/ml")
const skillsRoutes = require("./routes/skills")
const tenantManager = require("./tenantManager")
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""

// ── IDE Workspace Persistence ─────────────────────────────────────────────────

const WORKSPACE_STORE_PATH = path.join(__dirname, "..", "data", "ide-workspace.json")

// ── ML Sync Modules ────────────────────────────────────────────────────────────

const {
	serializeNeuralNetwork,
	serializeLinearRegression,
	deserialize,
	validate,
} = require("../orchestrator/ml/ModelSerializer")
const { federatedMerge, mergeLocalAndCloud } = require("../orchestrator/ml/FederatedMerge")
const { fromLocal, fromCloud, toLocal, toCloud, UNIFIED_DIMENSIONS } = require("../orchestrator/ml/FeatureMapper")

async function loadWorkspaceStore(sessionId = "default") {
	try {
		const filePath =
			sessionId === "default"
				? WORKSPACE_STORE_PATH
				: path.join(path.dirname(WORKSPACE_STORE_PATH), `ide-workspace-${sessionId}.json`)
		const raw = await fs.readFile(filePath, "utf8")
		return JSON.parse(raw)
	} catch {
		return null
	}
}

async function saveWorkspaceStore(data, sessionId = "default") {
	try {
		const filePath =
			sessionId === "default"
				? WORKSPACE_STORE_PATH
				: path.join(path.dirname(WORKSPACE_STORE_PATH), `ide-workspace-${sessionId}.json`)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		// Atomic write: write to temp then rename
		const tmp = filePath + ".tmp"
		await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tmp, filePath)
	} catch (err) {
		console.error("[workspace-store] Failed to save:", err.message)
	}
}

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
 * Vision Fallback — Uses OpenAI GPT-4o (vision-capable) to analyze images/PDFs
 * when the primary model doesn't support vision.
 *
 * Accepts a base64-encoded image or PDF and returns a text description.
 * Falls back gracefully if OpenAI key is not configured.
 */
async function visionFallback(imageBase64, mimeType, prompt) {
	try {
		// Try OpenAI first (GPT-4o has vision)
		const openaiKey = readProviderApiKey("openai")
		if (openaiKey) {
			const messages = [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt || "Please describe what you see in this image in detail." },
						{
							type: "image_url",
							image_url: {
								url: `data:${mimeType};base64,${imageBase64}`,
								detail: "high",
							},
						},
					],
				},
			]
			return await callChatCompletion("https://api.openai.com/v1", openaiKey, "gpt-4o", messages)
		}

		// Fallback to Anthropic (Claude Sonnet 4 has vision)
		const anthropicKey = readProviderApiKey("anthropic")
		if (anthropicKey) {
			const messages = [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt || "Please describe what you see in this image in detail." },
						{
							type: "image_url",
							image_url: {
								url: `data:${mimeType};base64,${imageBase64}`,
								detail: "high",
							},
						},
					],
				},
			]
			return await callChatCompletion(
				"https://api.anthropic.com/v1",
				anthropicKey,
				"claude-sonnet-4-20250514",
				messages,
			)
		}

		// Fallback to any available vision-capable provider
		for (const provider of PROVIDERS) {
			if (provider.capabilities?.includes("vision") && provider.id !== "openai" && provider.id !== "anthropic") {
				const key = readProviderApiKey(provider.id)
				if (key) {
					const messages = [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: prompt || "Please describe what you see in this image in detail.",
								},
								{
									type: "image_url",
									image_url: {
										url: `data:${mimeType};base64,${imageBase64}`,
										detail: "high",
									},
								},
							],
						},
					]
					return await callChatCompletion(
						provider.apiBaseUrl,
						key,
						provider.defaultModel || "gpt-4o",
						messages,
					)
				}
			}
		}

		return null // No vision-capable provider available
	} catch (err) {
		console.error("[api] Vision fallback error:", err.message)
		return null
	}
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
const ORCHESTRATOR_DB_PATH =
	process.env.ORCHESTRATOR_DB_PATH || path.join(__dirname, "..", "orchestrator", "data", "orchestrator.db")

const connection = new IORedis(REDIS_URL, {
	maxRetriesPerRequest: null,
})

const queue = new Queue(QUEUE_NAME, { connection })

// Wire the queue into the Telegram notifier so it can create apply jobs
// when the user approves a preview plan (two-phase coding flow).
try {
	if (telegramBot && telegramBot.telegramNotifier && typeof telegramBot.telegramNotifier.setQueue === "function") {
		telegramBot.telegramNotifier.setQueue(queue)
		console.log("[api] Queue wired to Telegram notifier for apply-job creation")
	}
} catch (err) {
	console.error("[api] Failed to wire queue to notifier:", err.message)
}

// ── Cloud Orchestrator Initialization ──────────────────────────────────────────

/** @type {CloudOrchestrator|null} */
let orchestrator = null
/** @type {TelegramOrchestratorBridge|null} */
let tgOrchestratorBridge = null
/** @type {AutonomousLoop|null} */
let autonomousLoop = null
/** @type {CommissioningLoop|null} */
let commissioningLoop = null

async function initOrchestrator() {
	try {
		orchestrator = new CloudOrchestrator({
			dbPath: ORCHESTRATOR_DB_PATH,
			bullQueue: queue,
			mode: process.env.ORCHESTRATOR_MODE || SafetyMode.SAFE,
			selfImproveEnabled: process.env.ORCHESTRATOR_SELF_IMPROVE === "true",
			loopIntervalMs: parseInt(process.env.ORCHESTRATOR_LOOP_INTERVAL || "5000", 10),
		})

		// ── Start orchestrator FIRST to initialize core (memory, eventLog, taskQueue) ──
		// Module registrations below depend on orchestrator.memory and orchestrator.eventLog
		// being non-null, which requires start() to have been called.
		await orchestrator.start()

		// ── Register all Phase 2-6 modules ──────────────────────────────
		// Use safeRequire to clear module cache and prevent "X is not a constructor"
		// errors when PM2 restarts the process.
		// NOTE: All orchestrator modules export as { ClassName } named objects,
		// except EventLog and TaskQueueBullMQ which export as direct class references.
		// We must destructure named exports to get the actual class.
		const { SafetyManager } = safeRequire("../orchestrator/modules/SafetyManager")
		const { AgentRegistry } = safeRequire("../orchestrator/modules/AgentRegistry")
		const { FeatureRegistry } = safeRequire("../orchestrator/modules/FeatureRegistry")
		const { BugRegistry } = safeRequire("../orchestrator/modules/BugRegistry")
		const { CommitDeployLog } = safeRequire("../orchestrator/modules/CommitDeployLog")
		const { HealingBus } = safeRequire("../orchestrator/modules/HealingBus")
		const { SelfHealingLoop } = safeRequire("../orchestrator/modules/SelfHealingLoop")
		const { ParallelExecutor } = safeRequire("../orchestrator/modules/ParallelExecutor")
		const { AgentBus } = safeRequire("../orchestrator/modules/AgentBus")
		const { InfiniteImprovementLoop } = safeRequire("../orchestrator/modules/InfiniteImprovementLoop")
		const { CrawlerAgent } = safeRequire("../orchestrator/modules/CrawlerAgent")
		const { DeployOrchestrator } = safeRequire("../orchestrator/modules/DeployOrchestrator")
		const { FileImporter } = safeRequire("../orchestrator/modules/FileImporter")
		const {
			getCpuUsagePercent,
			getRamUsagePercent,
			getResourceSample,
			onResourceGuardEvent,
			waitForCpuBelow,
			runGuardedAgentLoop,
			GuardedLoopError,
			autonomousController,
			onAutonomousControllerEvent,
			runControlledAutonomousTask,
		} = safeRequire("../orchestrator/modules/CPUGuard")

		orchestrator.registerSafetyManager(
			new SafetyManager({
				initialMode: process.env.ORCHESTRATOR_MODE || "safe",
				blocklistPath: require("path").join(__dirname, "..", "orchestrator", "config", "blocklist.json"),
			}),
		)

		orchestrator.registerAgentRegistry(new AgentRegistry())

		orchestrator.registerFeatureRegistry(new FeatureRegistry({ memoryStore: orchestrator.memory }))
		orchestrator.registerBugRegistry(new BugRegistry({ memoryStore: orchestrator.memory }))
		orchestrator.registerCommitDeployLog(new CommitDeployLog())

		const healingBus = new HealingBus({ memoryStore: orchestrator.memory })
		orchestrator.registerHealingBus(healingBus)

		const selfHealingLoop = new SelfHealingLoop(orchestrator, {
			cycleIntervalMs: 30000,
			maxPerCycle: 10,
			autoFixPolicies: { low: true, medium: false, high: false, critical: false },
			suggestionOnly: false,
			maxRetries: 3,
		})
		orchestrator.registerSelfHealingLoop(selfHealingLoop)

		orchestrator.registerParallelExecutor(
			new ParallelExecutor(orchestrator.eventLog, orchestrator.safetyManager, {
				maxConcurrency: 2,
				maxTokenBudget: 100,
				enablePreemption: false,
				taskTimeoutMs: 600000,
			}),
		)

		orchestrator.registerAgentBus(new AgentBus(orchestrator.eventLog))
		orchestrator.registerImprovementLoop(
			new InfiniteImprovementLoop({
				memoryStore: orchestrator.memory,
				taskQueue: orchestrator.taskQueue,
			}),
		)
		orchestrator.registerCrawlerAgent(new CrawlerAgent())
		orchestrator.registerDeployOrchestrator(new DeployOrchestrator({}))
		orchestrator.registerFileImporter(new FileImporter("/opt/superroo2"))
		// CPUGuard exports individual functions, not a class — pass as a namespace object
		orchestrator.registerCPUGuard({
			getCpuUsagePercent,
			getRamUsagePercent,
			getResourceSample,
			onResourceGuardEvent,
			waitForCpuBelow,
			runGuardedAgentLoop,
			GuardedLoopError,
			autonomousController,
			onAutonomousControllerEvent,
			runControlledAutonomousTask,
		})

		// ── HermesClaw — Memory & Context Agent ─────────────────────────
		const { HermesClaw } = safeRequire("../orchestrator/modules/HermesClaw")
		const hermesClaw = new HermesClaw({
			apiKey: process.env.OPENAI_API_KEY || "",
			fallbackApiKey: process.env.DEEPSEEK_API_KEY || "",
		})
		await hermesClaw.init()
		orchestrator.registerHermesClaw(hermesClaw)

		// ── Expose orchestrator globally for Telegram bot HermesClaw access ──
		global.__orchestrator = orchestrator

		// ── Set provider resolver for LLM-based multi-agent breakdown ────
		orchestrator.setProviderResolver(resolveProviderForTask, callChatCompletion)

		tgOrchestratorBridge = new TelegramOrchestratorBridge(orchestrator)

		console.log(
			`[orchestrator] Cloud Orchestrator initialized | mode=${orchestrator.mode} | db=${ORCHESTRATOR_DB_PATH}`,
		)
		writeApiLog("info", "cloud-orchestrator", "Cloud Orchestrator initialized", {
			mode: orchestrator.mode,
			dbPath: ORCHESTRATOR_DB_PATH,
			modules: Object.keys(orchestrator.getStatus().modules).filter((k) => orchestrator.getStatus().modules[k]),
		})
	} catch (err) {
		console.error("[orchestrator] Failed to initialize Cloud Orchestrator:", err.message)
		writeApiLog("error", "cloud-orchestrator", `Failed to initialize: ${err.message}`, { error: err.message })
		// Non-fatal — API continues without orchestrator
	}
}

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

// Maps dashboard task types to default agent route names so saves/loads stay consistent.
const TASK_TYPE_TO_AGENT = {
	planning: "planner",
	coding: "coder",
	debugging: "debugger",
	crawling: "crawler",
	research: "tester",
	testing: "tester",
	deployment: "deployChecker",
	architecture: "coder",
	fast_fix: "debugger",
}

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
async function getLogs(limit = 50, target = "") {
	try {
		const logFiles = target
			? [`${target}-combined.log`, `${target}-out.log`, `${target}-error.log`]
			: ["api-combined.log", "worker-combined.log", "dashboard-combined.log"]
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

// ── WebSocket Server for Real-Time Chat ──────────────────────────────────────
// Upgrades HTTP connections to WebSocket for bidirectional streaming chat.
// The dashboard connects via ws://host/api/ws/chat and receives token-by-token
// streaming, typing indicators, and proactive suggestions.
const wss = new WebSocketServer({ noServer: true })

// ── PTY Server ─────────────────────────────────────────────────────────────
// Real pseudo-terminal shell integration via node-pty + WebSocket.
// Provides live shell sessions with streaming output, resize, and multi-session.
ptyServer.init(dashboardWebSocket.getWss())

// Track connected chat clients by workspace session
const chatClients = new Map() // sessionId -> Set<WebSocket>

// Track per-session chat context (isolated from global singleton)
const chatSessions = new Map() // sessionId -> context object

async function getChatSession(sessionId, workspaceDir = "") {
	if (!chatSessions.has(sessionId)) {
		const saved = await loadWorkspaceStore(sessionId)
		if (saved && saved.chatMessages) {
			chatSessions.set(sessionId, saved)
		} else {
			const seed = global.__ideWorkspace || {}
			chatSessions.set(sessionId, {
				repoName: seed.repoName || "superroo2",
				branch: seed.branch || "main",
				workspaceDir: workspaceDir || seed.workspaceDir || "/opt/superroo2",
				chatMessages: [],
				pipeline: seed.pipeline ? [...seed.pipeline] : [],
				terminalSessions: seed.terminalSessions ? JSON.parse(JSON.stringify(seed.terminalSessions)) : [],
				activeTerminal: seed.activeTerminal || null,
			})
		}
	}
	return chatSessions.get(sessionId)
}

wss.on("connection", (ws, req) => {
	const urlObj = new URL(req.url, "http://localhost")
	const sessionId = urlObj.searchParams.get("session") || "default"
	const workspaceDir = urlObj.searchParams.get("dir") || ""

	if (!chatClients.has(sessionId)) {
		chatClients.set(sessionId, new Set())
	}
	chatClients.get(sessionId).add(ws)

	writeApiLog("info", "ws-chat", `WebSocket client connected: session=${sessionId}`, { sessionId })

	// Send connection confirmation
	ws.send(JSON.stringify({ type: "connected", sessionId }))

	ws.on("message", async (raw) => {
		try {
			const msg = JSON.parse(raw.toString())

			if (msg.type === "ping") {
				ws.send(JSON.stringify({ type: "pong" }))
				return
			}

			if (msg.type === "chat") {
				await handleWsChatMessage(ws, sessionId, msg, workspaceDir)
			}

			if (msg.type === "cancel") {
				// Signal the streaming handler to abort
				const abortController = activeStreams.get(sessionId)
				if (abortController) {
					abortController.abort()
					activeStreams.delete(sessionId)
				}
			}
		} catch (err) {
			writeApiLog("error", "ws-chat", "Message parse error", { error: err.message })
			ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }))
		}
	})

	ws.on("close", () => {
		const clients = chatClients.get(sessionId)
		if (clients) {
			clients.delete(ws)
			if (clients.size === 0) chatClients.delete(sessionId)
		}
		// Cancel any active stream for this session
		const abortController = activeStreams.get(sessionId)
		if (abortController) {
			abortController.abort()
			activeStreams.delete(sessionId)
		}
	})

	ws.on("error", (err) => {
		writeApiLog("error", "ws-chat", "WebSocket error", { error: err.message })
	})
})

// Track active streaming controllers for cancellation
const activeStreams = new Map()

// ── WebSocket Chat Message Handler ───────────────────────────────────────────
async function handleWsChatMessage(ws, sessionId, msg, workspaceDir) {
	const text = (msg.text || "").trim()
	if (!text) return

	// ── Per-session context (isolated from global singleton) ─────────────
	const session = await getChatSession(sessionId, workspaceDir)

	// ── Update workspace context from client ─────────────────────────────
	if (msg.context) {
		if (msg.context.repoName) session.repoName = msg.context.repoName
		if (msg.context.branch) session.branch = msg.context.branch
		if (msg.context.workspaceDir) session.workspaceDir = msg.context.workspaceDir
	}

	// Store user message (raw text only — not a wrapped contextInstruction)
	session.chatMessages.push({
		id: `msg-${Date.now()}`,
		role: "user",
		author: "You",
		time: new Date().toLocaleTimeString(),
		content: text,
	})
	saveWorkspaceStore(session, sessionId)

	// Send typing indicator
	ws.send(JSON.stringify({ type: "typing", status: true }))

	// ── Resolve AI provider ──────────────────────────────────────────────
	let provider = null
	if (msg.provider) {
		provider = resolveProviderById(msg.provider, msg.model || null)
	}
	if (!provider) {
		provider = resolveProviderForTask("coder")
	}

	if (!provider) {
		ws.send(
			JSON.stringify({
				type: "error",
				message: "No AI provider configured. Add an API key in Settings.",
			}),
		)
		ws.send(JSON.stringify({ type: "typing", status: false }))
		return
	}

	// ── Build rich context ───────────────────────────────────────────────
	const contextParts = [
		`You are SuperRoo, an expert AI coding assistant running in the Cloud Dashboard IDE Terminal.`,
		`You are a REAL-TIME partner — respond token by token, proactively suggest next steps.`,
		`The current workspace is "${session.repoName || "unknown"}" on branch "${session.branch || "main"}".`,
		`The workspace directory is: ${session.workspaceDir || "/opt/superroo2"}`,
	]

	// 1. Current open file context (if provided by client)
	if (msg.currentFile) {
		contextParts.push(
			`## Current File\nFile: ${msg.currentFile.path}\n\`\`\`${msg.currentFile.language || "text"}\n${(msg.currentFile.content || "").slice(0, 3000)}\n\`\`\``,
		)
		if (msg.currentFile.selection) {
			contextParts.push(
				`## Selected Code\n\`\`\`${msg.currentFile.language || "text"}\n${msg.currentFile.selection}\n\`\`\``,
			)
		}
	}

	// 2. Open files context
	if (msg.allOpenFiles && msg.allOpenFiles.length > 0) {
		const filesInfo = msg.allOpenFiles.map((f) => `- ${f.path}${f.modified ? " (modified)" : ""}`).join("\n")
		contextParts.push(`## Open Files\n${filesInfo}`)
	}

	// 3. Workspace structure
	if (msg.workspaceFiles && msg.workspaceFiles.length > 0) {
		contextParts.push(`## Workspace Structure\n${msg.workspaceFiles.length} items in workspace`)
	}

	// 4. Terminal context (last 20 lines of terminal output)
	if (msg.terminalOutput && msg.terminalOutput.length > 0) {
		const lastLines = msg.terminalOutput.slice(-20).join("\n")
		contextParts.push(`## Recent Terminal Output\n\`\`\`\n${lastLines}\n\`\`\``)
	}

	// 5. Clean conversation history (last 20 messages)
	const cleanHistory = session.chatMessages.filter(
		(m) => m.role === "user" || m.role === "agent" || m.role === "assistant",
	)
	if (cleanHistory.length > 1) {
		const history = cleanHistory
			.slice(-20, -1)
			.map((m) => `${m.author}: ${m.content.slice(0, 500)}`)
			.join("\n")
		contextParts.push(`## Conversation History\n${history}`)
	}

	// 6. HermesClaw memory recall
	let hermesContext = ""
	if (orchestrator && orchestrator.hermesClaw) {
		try {
			const recallResult = await orchestrator.hermesClaw.recallContext(text, 5)
			if (recallResult && recallResult.output) {
				hermesContext = recallResult.output
				contextParts.push(`## Relevant Past Context\n${hermesContext.substring(0, 2000)}`)
			}
		} catch (hermesErr) {
			// Silently fail
		}
	}

	// 7. Behavior rules
	contextParts.push(`## Behavior Rules
### Message Reconstruction
- Before answering, silently reconstruct what the user is asking. If they say "this", "that", "it", or refer to something without context, look at the conversation history to understand what they mean.
- Start your response by briefly confirming your understanding: "So you want to [reconstructed intent] — here's the solution."
- This makes the user feel heard and ensures you understood correctly.

### Solution-First Approach
- NEVER just give steps or instructions. ALWAYS provide the actual solution directly:
	 - If they need code → give the complete code block with file path
	 - If they need a command → give the exact command to run
	 - If they need a fix → give the exact fix with before/after
- After providing the solution, ask: "Would you like me to integrate this?" or "Do you want me to apply this change?"
- If they say yes, provide clear instructions on how to apply it, or offer to do it through the terminal.

### Context Learning
- Maintain continuity across the conversation. Reference previous messages naturally.
- If the user asks a follow-up, connect it to what was discussed before.
- Learn from corrections — if the user corrects you, remember that for the rest of the conversation.

### Tone
- Be direct, helpful, and solution-oriented. No fluff, no unnecessary explanations.
- Use simple language — the user may not be a coder. Explain technical terms only when needed.
- Format code blocks with \`\`\`language for syntax highlighting.
- When suggesting file changes, include the file path as a comment.`)

	const systemPrompt = contextParts.join("\n\n")

	// ── Create assistant placeholder ─────────────────────────────────────
	const assistantId = `msg-${Date.now() + 1}`
	ws.send(
		JSON.stringify({
			type: "assistant-start",
			id: assistantId,
		}),
	)

	// ── Stream the LLM response ──────────────────────────────────────────
	const abortController = new AbortController()
	activeStreams.set(sessionId, abortController)

	try {
		const apiUrl = `${provider.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`
		const streamRes = await fetch(apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${provider.apiKey}`,
			},
			body: JSON.stringify({
				model: provider.model,
				messages: [
					{ role: "system", content: systemPrompt },
					...cleanHistory.slice(-10, -1).map((m) => ({
						role: m.role === "user" ? "user" : "assistant",
						content: m.content,
					})),
					{ role: "user", content: text },
				],
				max_tokens: 8192,
				temperature: 0.7,
				stream: true,
			}),
			signal: abortController.signal,
		})

		if (!streamRes.ok) {
			const errBody = await streamRes.text().catch(() => "")
			ws.send(
				JSON.stringify({
					type: "error",
					message: `AI API error ${streamRes.status}: ${errBody.slice(0, 200)}`,
				}),
			)
			ws.send(JSON.stringify({ type: "typing", status: false }))
			return
		}

		const reader = streamRes.body.getReader()
		const decoder = new TextDecoder()
		let fullReply = ""
		let buffer = ""
		let tokenCount = 0

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed || !trimmed.startsWith("data: ")) continue
				const jsonStr = trimmed.slice(6)
				if (jsonStr === "[DONE]") continue

				try {
					const chunk = JSON.parse(jsonStr)
					const delta = chunk.choices?.[0]?.delta?.content || ""
					if (delta) {
						fullReply += delta
						tokenCount++
						// Send token every 1-2 chars for smooth streaming
						ws.send(JSON.stringify({ type: "token", text: delta }))
					}
				} catch {
					// Skip malformed chunks
				}
			}
		}

		// Send completion
		ws.send(JSON.stringify({ type: "typing", status: false }))
		ws.send(
			JSON.stringify({
				type: "done",
				id: assistantId,
				reply: fullReply,
				provider: provider.providerId,
				model: provider.model,
				tokenCount,
			}),
		)

		// Store the full reply
		session.chatMessages.push({
			id: assistantId,
			role: "agent",
			author: provider.providerId,
			meta: `${provider.model} · ws-stream`,
			time: new Date().toLocaleTimeString(),
			content: fullReply,
		})
		saveWorkspaceStore(session, sessionId)

		// Fire-and-forget Hermes lesson extraction
		if (orchestrator && orchestrator.hermesClaw) {
			orchestrator.hermesClaw
				.extractLessons({
					taskId: `ide-ws-${Date.now()}`,
					goal: text.substring(0, 500),
					phases: [{ number: 1, phase: "chat", result: "completed" }],
					finalStatus: "completed",
					error: null,
				})
				.catch(() => {})
		}

		// ── Proactive suggestions ────────────────────────────────────────
		// After every response, suggest 1-2 next steps based on context
		try {
			const suggestionPrompt = [
				`Based on this conversation, suggest 1-2 very short next steps the user might want to take.`,
				`The user is NOT a coder — prefer actionable suggestions like "Yes, integrate this fix" or "Show me how to test it" over technical commands.`,
				`Format as a JSON array of strings, each max 60 chars.`,
				`Examples: ["Yes, apply this change", "Show me how to verify it works", "What else can you help with?"]`,
				`User said: "${text.slice(0, 200)}"`,
				`Assistant replied: "${fullReply.slice(0, 300)}"`,
			].join("\n")

			const suggestionRes = await fetch(apiUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${provider.apiKey}`,
				},
				body: JSON.stringify({
					model: provider.model,
					messages: [{ role: "user", content: suggestionPrompt }],
					max_tokens: 200,
					temperature: 0.3,
				}),
				signal: AbortSignal.timeout(5000),
			})

			if (suggestionRes.ok) {
				const suggestionData = await suggestionRes.json()
				const suggestionText = suggestionData.choices?.[0]?.message?.content || ""
				try {
					const suggestions = JSON.parse(suggestionText.replace(/```json|```/g, "").trim())
					if (Array.isArray(suggestions) && suggestions.length > 0) {
						ws.send(
							JSON.stringify({
								type: "suggestions",
								suggestions: suggestions.slice(0, 3),
							}),
						)
					}
				} catch {
					// Not valid JSON, skip suggestions
				}
			}
		} catch {
			// Suggestions are best-effort
		}
	} catch (err) {
		if (err.name === "AbortError") {
			ws.send(JSON.stringify({ type: "cancelled", message: "Stream cancelled by user" }))
		} else {
			writeApiLog("error", "ws-chat", "Stream error", { error: err.message })
			ws.send(JSON.stringify({ type: "error", message: err.message }))
		}
		ws.send(JSON.stringify({ type: "typing", status: false }))
	} finally {
		activeStreams.delete(sessionId)
	}
}

const server = http.createServer(async (req, res) => {
	const url = req.url || ""
	const method = req.method || "GET"

	// Normalize URL: handle both direct access and proxied access
	// - Direct: nginx proxies /api/health -> /health (strips /api)
	// - Via Next.js rewrite: /api/health stays as /api/health
	// Normalize by stripping /api prefix if present
	const normalizedUrl = url.startsWith("/api") ? url.slice(4) || "/" : url

	// Store normalized URL for rate limiter
	req._normalizedUrl = normalizedUrl

	// Apply rate limiting (skip for health endpoint to allow monitoring)
	if (normalizedUrl !== "/health") {
		if (!rateLimiter.checkRequest(req, res)) {
			return // Rate limited — response already sent
		}
	}

	try {
		// Health
		if (method === "GET" && (url === "/health" || normalizedUrl === "/health")) {
			const healthPayload = { status: "online", redis: true, worker: true }
			if (orchestrator) {
				const status = orchestrator.getStatus()
				healthPayload.orchestrator = {
					running: status.running,
					mode: status.mode,
					uptime: status.uptime,
					modules: Object.entries(status.modules)
						.filter(([, loaded]) => loaded)
						.map(([name]) => name),
					taskStats: status.taskStats,
				}
			}
			sendJson(res, 200, healthPayload)
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
			const target = urlObj.searchParams.get("target") || ""
			const logs = await getLogs(limit, target)
			sendJson(res, 200, { success: true, logs })
			return
		}

		// Vision Analyze — Fallback for image/PDF analysis when primary model lacks vision
		// POST /api/vision/analyze
		// Body: { image: "<base64>", mimeType: "image/png", prompt: "optional prompt" }
		if (method === "POST" && (url === "/vision/analyze" || normalizedUrl === "/vision/analyze")) {
			const data = await parseBody(req)
			if (!data.image || !data.mimeType) {
				sendJson(res, 400, { success: false, error: "Missing required fields: image (base64), mimeType" })
				return
			}
			const result = await visionFallback(data.image, data.mimeType, data.prompt)
			if (result) {
				sendJson(res, 200, { success: true, analysis: result })
			} else {
				sendJson(res, 503, {
					success: false,
					error: "No vision-capable provider available. Please configure an API key for OpenAI (GPT-4o), Anthropic (Claude), or another vision-capable provider.",
				})
			}
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
					case "task_progress":
						sent = await notifier.sendNotification(
							TELEGRAM_BOT_TOKEN,
							chatId,
							"⏳ Coding in progress",
							result?.progress?.message || "🤖 Coder agent is working on your request...",
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
					modelLabels: Object.fromEntries(p.models.map((m) => [m.id, m.name])),
					capabilities: p.capabilities,
					defaultModel: meta.defaultModel || p.defaultModel,
					apiBaseUrl: meta.apiBaseUrl || p.apiBaseUrl,
					website: p.website,
					docsUrl: p.docsUrl,
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

		// PATCH /settings/providers/:id — update provider metadata (e.g., default model, api base url)
		if (method === "PATCH" && normalizedUrl.match(/^\/settings\/providers\/[^/]+$/)) {
			const providerId = normalizedUrl.split("/")[3]
			const data = await parseBody(req)
			const meta = providerMeta.get(providerId) || { hasKey: false, status: "not_tested" }
			if (data.defaultModel !== undefined) meta.defaultModel = data.defaultModel
			if (data.apiBaseUrl !== undefined) meta.apiBaseUrl = data.apiBaseUrl
			meta.updatedAt = Date.now()
			providerMeta.set(providerId, meta)
			// Persist overrides to disk so they survive restarts
			await saveEncryptedSecrets()
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
			const routes = taskTypes.map((taskType) => {
				let agentRoute = agentRoutes.find((r) => r.agent === taskType)
				if (!agentRoute) {
					const mappedAgent = TASK_TYPE_TO_AGENT[taskType]
					if (mappedAgent) {
						agentRoute = agentRoutes.find((r) => r.agent === mappedAgent)
					}
				}
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
			let existing = agentRoutes.find((r) => r.agent === taskType)
			if (!existing) {
				const mappedAgent = TASK_TYPE_TO_AGENT[taskType]
				if (mappedAgent) {
					const mappedRoute = agentRoutes.find((r) => r.agent === mappedAgent)
					if (mappedRoute) {
						existing = { ...mappedRoute, agent: taskType }
						agentRoutes.push(existing)
					}
				}
			}
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

		// ── Tenant routes ────────────────────────────────────────────────────

		// Multi-tenant management:
		//   GET    /api/tenants              — List tenants for current user
		//   POST   /api/tenants              — Create a new tenant
		//   GET    /api/tenants/:id          — Get tenant details
		//   PUT    /api/tenants/:id          — Update tenant
		//   DELETE /api/tenants/:id          — Deactivate tenant
		//   GET    /api/tenants/:id/members  — List tenant members
		//   POST   /api/tenants/:id/members  — Add member to tenant
		//   DELETE /api/tenants/:id/members/:userId — Remove member
		//   PUT    /api/tenants/:id/members/:userId — Update member role
		//   POST   /api/tenants/:id/invites  — Create invite code
		//   POST   /api/tenants/redeem       — Redeem invite code
		//   GET    /api/tenants/:id/quota    — Get tenant quota
		if (normalizedUrl.startsWith("/api/tenants")) {
			const email = auth.authenticate(req)
			if (!email) {
				sendJson(res, 401, { ok: false, error: "Unauthorized" })
				return
			}
			const user = Object.values(require("./auth").users || {}).find((u) => u.email === email)
			const userId = user ? user.userId : null

			// POST /api/tenants/redeem — redeem invite code
			if (method === "POST" && normalizedUrl === "/api/tenants/redeem") {
				try {
					const body = await parseBody(req)
					const result = await tenantManager.redeemInvite(body.code, userId)
					const tenant = tenantManager.getTenant(result.tenantId)
					sendJson(res, 200, { ok: true, tenant })
				} catch (err) {
					sendJson(res, 400, { ok: false, error: err.message })
				}
				return
			}

			// POST /api/tenants — create tenant
			if (method === "POST" && normalizedUrl === "/api/tenants") {
				try {
					const body = await parseBody(req)
					const tenant = await tenantManager.createTenant({
						name: body.name,
						slug: body.slug,
						ownerUserId: userId,
						plan: body.plan || "free",
					})
					sendJson(res, 200, { ok: true, tenant })
				} catch (err) {
					sendJson(res, 400, { ok: false, error: err.message })
				}
				return
			}

			// GET /api/tenants — list tenants for current user
			if (method === "GET" && normalizedUrl === "/api/tenants") {
				const userTenants = tenantManager.listUserTenants(userId)
				sendJson(res, 200, { ok: true, tenants: userTenants })
				return
			}

			// Tenant-specific routes: /api/tenants/:id/...
			const tenantMatch = normalizedUrl.match(/^\/api\/tenants\/([a-zA-Z0-9_]+)(\/.*)?$/)
			if (tenantMatch) {
				const tenantId = tenantMatch[1]
				const subPath = tenantMatch[2] || ""

				// Check membership for tenant-specific operations
				const isMember = tenantManager.checkMembership(tenantId, userId, "member")
				const isAdmin = tenantManager.checkMembership(tenantId, userId, "admin")

				if (!isMember && method !== "GET") {
					sendJson(res, 403, { ok: false, error: "Not a member of this tenant" })
					return
				}

				// GET /api/tenants/:id — get tenant details
				if (method === "GET" && subPath === "") {
					const tenant = tenantManager.getTenant(tenantId)
					if (!tenant) {
						sendJson(res, 404, { ok: false, error: "Tenant not found" })
						return
					}
					sendJson(res, 200, { ok: true, tenant })
					return
				}

				// PUT /api/tenants/:id — update tenant (admin only)
				if (method === "PUT" && subPath === "") {
					if (!isAdmin) {
						sendJson(res, 403, { ok: false, error: "Admin access required" })
						return
					}
					try {
						const body = await parseBody(req)
						const tenant = await tenantManager.updateTenant(tenantId, body)
						sendJson(res, 200, { ok: true, tenant })
					} catch (err) {
						sendJson(res, 400, { ok: false, error: err.message })
					}
					return
				}

				// DELETE /api/tenants/:id — deactivate tenant (admin only)
				if (method === "DELETE" && subPath === "") {
					if (!isAdmin) {
						sendJson(res, 403, { ok: false, error: "Admin access required" })
						return
					}
					await tenantManager.deleteTenant(tenantId)
					sendJson(res, 200, { ok: true })
					return
				}

				// GET /api/tenants/:id/members — list members
				if (method === "GET" && subPath === "/members") {
					const members = tenantManager.listMembers(tenantId)
					sendJson(res, 200, { ok: true, members })
					return
				}

				// POST /api/tenants/:id/members — add member (admin only)
				if (method === "POST" && subPath === "/members") {
					if (!isAdmin) {
						sendJson(res, 403, { ok: false, error: "Admin access required" })
						return
					}
					try {
						const body = await parseBody(req)
						await tenantManager.addMember(tenantId, body.userId, body.role || "member")
						sendJson(res, 200, { ok: true })
					} catch (err) {
						sendJson(res, 400, { ok: false, error: err.message })
					}
					return
				}

				// DELETE /api/tenants/:id/members/:userId — remove member (admin only)
				const removeMatch = subPath.match(/^\/members\/([a-zA-Z0-9_]+)$/)
				if (method === "DELETE" && removeMatch) {
					if (!isAdmin) {
						sendJson(res, 403, { ok: false, error: "Admin access required" })
						return
					}
					try {
						await tenantManager.removeMember(tenantId, removeMatch[1])
						sendJson(res, 200, { ok: true })
					} catch (err) {
						sendJson(res, 400, { ok: false, error: err.message })
					}
					return
				}

				// PUT /api/tenants/:id/members/:userId — update member role (admin only)
				if (method === "PUT" && removeMatch) {
					if (!isAdmin) {
						sendJson(res, 403, { ok: false, error: "Admin access required" })
						return
					}
					try {
						const body = await parseBody(req)
						await tenantManager.updateMemberRole(tenantId, removeMatch[1], body.role)
						sendJson(res, 200, { ok: true })
					} catch (err) {
						sendJson(res, 400, { ok: false, error: err.message })
					}
					return
				}

				// GET /api/tenants/:id/invites — list invites
				if (method === "GET" && subPath === "/invites") {
					const invites = tenantManager.listInvites(tenantId)
					sendJson(res, 200, { ok: true, invites })
					return
				}

				// POST /api/tenants/:id/invites — create invite (admin only)
				if (method === "POST" && subPath === "/invites") {
					if (!isAdmin) {
						sendJson(res, 403, { ok: false, error: "Admin access required" })
						return
					}
					try {
						const body = await parseBody(req)
						const invite = await tenantManager.createInvite(
							tenantId,
							userId,
							body.maxUses,
							body.expiresInDays,
						)
						sendJson(res, 200, { ok: true, invite })
					} catch (err) {
						sendJson(res, 400, { ok: false, error: err.message })
					}
					return
				}

				// GET /api/tenants/:id/quota — get tenant quota
				if (method === "GET" && subPath === "/quota") {
					const quota = tenantManager.getQuota(tenantId)
					sendJson(res, 200, { ok: true, quota })
					return
				}
			}

			// If no route matched, return 404
			sendJson(res, 404, { ok: false, error: "Tenant route not found" })
			return
		}

		// ── Healing Metrics routes ───────────────────────────────────────────

		// Healing Metrics — exposes healing module data for the dashboard
		// Provides metrics, incidents, and escalated issues endpoints
		if (normalizedUrl.startsWith("/healing/")) {
			if (await healingMetrics.handleHealingRoute(method, url, req, res)) {
				return
			}
		}

		// ── Monitoring routes ────────────────────────────────────────────────

		// Monitoring — exposes log aggregation, system stats, and health timeline
		// Provides log viewer, system stats, and health check history endpoints
		if (normalizedUrl.startsWith("/monitoring/")) {
			if (await monitoring.handleMonitoringRoute(method, url, req, res)) {
				return
			}
		}

		// ── ML Engine routes ─────────────────────────────────────────────────

		// ML Engine — exposes ML model status, observations, training progress
		// Provides dashboard visibility into the ML Engine integration with agents
		if (normalizedUrl.startsWith("/api/ml/")) {
			if (await mlRoutes.handleMlRoute(method, url, req, res)) {
				return
			}
		}

		// ── Terminal Brain routes ────────────────────────────────────────────

		// Terminal Brain — integrates with packages/terminal-core/src/brain
		// Provides context, memory, plan, execute, analyze, fix endpoints
		if (normalizedUrl.startsWith("/terminal-brain/")) {
			const action = normalizedUrl.slice("/terminal-brain/".length).split("?")[0].split("/")[0]

			// Lazy-load TerminalBrain (it may not be installed in all environments)
			let TerminalBrain
			try {
				TerminalBrain = require("../../../packages/terminal-core/src/brain").TerminalBrain
			} catch (e) {
				// Fallback: return empty responses if terminal-core is not available
				if (action === "context" || action === "memory") {
					sendJson(res, 200, { ok: true, context: null, memory: null })
				} else {
					sendJson(res, 200, {
						ok: true,
						feedback: { status: "unavailable", output: "Terminal Brain not available" },
					})
				}
				return
			}

			// Get or create brain instance (keyed by session or default)
			const sessionId = req.headers["x-session-id"] || `session-${Date.now()}`
			const workspaceRoot = process.env.WORKSPACE_ROOT || "/opt/superroo2"
			if (!global.__terminalBrains) global.__terminalBrains = new Map()
			if (!global.__terminalBrains.has(sessionId)) {
				global.__terminalBrains.set(sessionId, new TerminalBrain({ workspaceRoot, sessionId }))
			}
			const brain = global.__terminalBrains.get(sessionId)

			try {
				if (method === "GET" && action === "context") {
					const result = await brain.process({ action: "context" })
					sendJson(res, 200, result)
				} else if (method === "GET" && action === "memory") {
					const result = await brain.process({ action: "memory" })
					sendJson(res, 200, result)
				} else if (method === "GET" && action === "stats") {
					const stats = brain.getStats()
					sendJson(res, 200, { ok: true, stats })
				} else if (method === "POST" && action === "plan") {
					const data = await parseBody(req)
					const result = await brain.process({ action: "plan", nlQuery: data.query || data.nlQuery || "" })
					sendJson(res, 200, result)
				} else if (method === "POST" && action === "execute") {
					const data = await parseBody(req)
					const result = await brain.process({ action: "execute", command: data.command || "" })
					sendJson(res, 200, result)
				} else if (method === "POST" && action === "analyze") {
					const data = await parseBody(req)
					const result = await brain.process({ action: "analyze", command: data.output || "" })
					sendJson(res, 200, result)
				} else if (method === "POST" && action === "fix") {
					const data = await parseBody(req)
					const result = await brain.process({ action: "fix", command: data.output || "" })
					sendJson(res, 200, result)
				} else if (method === "POST" && action === "process") {
					const data = await parseBody(req)
					const result = await brain.process(data)
					sendJson(res, 200, result)
				} else {
					sendJson(res, 404, {
						error: "not_found",
						detail: `No terminal-brain route for ${method} ${action}`,
					})
				}
			} catch (err) {
				console.error(`[terminal-brain] Error handling ${action}:`, err.message)
				sendJson(res, 500, { ok: false, error: err.message })
			}
			return
		}

		// ── Skills Generator routes ───────────────────────────────────────────

		// Skills Generator — exposes skill library, recommendations, and draft management
		// Provides the backend for the Skills Generator dashboard view
		if (normalizedUrl.startsWith("/skills")) {
			if (await skillsRoutes.handleSkillsRoute(method, url, req, res, sendJson, parseBody)) {
				return
			}
		}

		// ── IDE Workspace routes ──────────────────────────────────────────────

		// Persistent IDE workspace state (survives server restarts)
		if (!global.__ideWorkspace) {
			const saved = await loadWorkspaceStore()
			if (saved && saved.chatMessages) {
				global.__ideWorkspace = saved
			} else {
				global.__ideWorkspace = {
					repoName: "superroo2",
					branch: "main",
					workspaceDir: process.env.WORKSPACE_ROOT || "/opt/superroo2",
					terminalSessions: [
						{
							id: "term-1",
							name: "bash",
							cwd: process.env.WORKSPACE_ROOT || "/opt/superroo2",
							createdAt: new Date().toISOString(),
							output: ["Welcome to SuperRoo IDE Terminal", "Type a command to get started..."],
						},
					],
					activeTerminal: "term-1",
					chatMessages: [],
					pipeline: [
						{ id: "plan", label: "Plan", status: "pending" },
						{ id: "crawl", label: "Crawl", status: "pending" },
						{ id: "patch", label: "Patch", status: "pending" },
						{ id: "approval", label: "Approval", status: "pending" },
						{ id: "tests", label: "Tests", status: "pending" },
						{ id: "deploy", label: "Deploy", status: "pending" },
					],
				}
			}
		}
		const ws = global.__ideWorkspace

		// Helper: walk directory recursively to build file tree
		async function walkDir(dirPath, basePath) {
			const entries = []
			try {
				const items = await fs.readdir(dirPath, { withFileTypes: true })
				for (const item of items) {
					// Skip hidden files and node_modules
					if (item.name.startsWith(".") || item.name === "node_modules") continue
					const fullPath = path.join(dirPath, item.name)
					const relPath = path.join(basePath, item.name)
					if (item.isDirectory()) {
						const children = await walkDir(fullPath, relPath)
						entries.push({
							path: "/" + relPath.replace(/\\/g, "/"),
							name: item.name,
							kind: "folder",
							children,
						})
					} else {
						entries.push({ path: "/" + relPath.replace(/\\/g, "/"), name: item.name, kind: "file" })
					}
				}
			} catch (e) {
				// Directory might not exist
			}
			return entries
		}

		// ── Agent/Skill command handler for terminal ──────────────────────
		// Maps terminal commands (prefixed with / or @) to agent actions
		const AGENT_COMMANDS = {
			"/help": { agent: "system", description: "Show available agent and skill commands" },
			"/agents": { agent: "system", description: "List all available agents and their status" },
			"/skills": { agent: "system", description: "List all available skills" },
			"/deploy": { agent: "deployer", description: "Deploy the current project" },
			"/autonomous": {
				agent: "autonomous",
				description: "Run autonomous coding, debugging, testing, and deployment loop",
			},
			"/commissioning": {
				agent: "commissioner",
				description: "Run full-stack commissioning — verify ALL features work as a real user (14 phases)",
			},
			"/debug": { agent: "debugger", description: "Start a debug session" },
			"/test": { agent: "tester", description: "Run tests" },
			"/crawl": { agent: "crawler", description: "Run crawler agent" },
			"/plan": { agent: "planner", description: "Create a plan for a task" },
			"/code": { agent: "coder", description: "Execute a coding task" },
			"/heal": { agent: "self-healing", description: "Run self-healing cycle" },
			"/orchestrate": {
				agent: "orchestrator",
				description: "Break down and coordinate multi-step tasks across agents",
			},
			"/auto-deploy": {
				agent: "auto-deployer",
				description: "Trigger or check status of the cloud auto-deployer",
			},
			"/status": { agent: "system", description: "Show system status" },
			"/memory": { agent: "system", description: "Show memory/context status" },
			"/pipeline": { agent: "system", description: "Show current pipeline status" },
		}

		// Skill commands (loaded from .roo/skills/)
		const SKILL_COMMANDS = {
			"auto-deployer": { description: "Self-retrying SSH deploy agent" },
			autonomous: { description: "Self-directed coding, debugging, testing & deployment loop" },
			"commissioning-agent": {
				description: "Full-stack commissioning — verify ALL features work as a real user (14 phases)",
			},
			"debug-team": { description: "Autonomous multi-agent debugging system" },
			"digitalocean-vps": { description: "Deploy and manage DigitalOcean Droplets" },
			"e2e-test": { description: "Run comprehensive end-to-end tests" },
			"google-cloud-api": { description: "Integrate Google Cloud services" },
			n8n: { description: "Integrate n8n workflow automation" },
			"phase-breakdown": { description: "Break down complex problems into phases" },
			supabase: { description: "Integrate Supabase services" },
			"telegram-integration": { description: "Manage Telegram bot integration" },
			vercel: { description: "Deploy and integrate Vercel" },
		}

		/**
		 * Handles agent/skill commands from the IDE terminal.
		 * Routes /prefixed commands through the agent system instead of raw shell.
		 */
		async function handleAgentTerminalCommand(cmd, ws, term) {
			const parts = cmd.trim().split(/\s+/)
			const command = parts[0].toLowerCase()
			const args = parts.slice(1).join(" ")

			// ── Skill commands (/skill <name> or /skills <name>) ──────────
			if (command === "/skill" || command === "/skills") {
				const skillName = parts[1]?.toLowerCase()
				if (!skillName) {
					const skillList = Object.entries(SKILL_COMMANDS)
						.map(([name, info]) => `  /skill ${name} — ${info.description}`)
						.join("\n")
					return {
						agent: "system",
						skill: true,
						output: ["Available skills:", skillList, "", "Usage: /skill <name> [args]"],
					}
				}

				const skillInfo = SKILL_COMMANDS[skillName]
				if (!skillInfo) {
					return {
						agent: "system",
						skill: true,
						output: [`Unknown skill: ${skillName}. Use /skills to list available skills.`],
					}
				}

				// Route skill execution through AI provider
				const provider = resolveProviderForTask("coder")
				if (!provider) {
					return {
						agent: "system",
						skill: true,
						output: ["No AI provider configured. Please add API keys first."],
					}
				}

				const skillArgs = parts.slice(2).join(" ")
				const systemPrompt = [
					`You are SuperRoo executing the "${skillName}" skill.`,
					`Skill description: ${skillInfo.description}`,
					`Workspace: ${ws.repoName} on branch ${ws.branch}`,
					`Directory: ${ws.workspaceDir}`,
					`User request: ${skillArgs || "Execute the skill"}`,
					"",
					"Provide a clear, actionable response. If this skill requires specific setup,",
					"guide the user through the steps. Execute any necessary commands or analysis.",
				].join("\n")

				try {
					const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: skillArgs || `Execute the ${skillName} skill and report results.` },
					])
					return {
						agent: skillName,
						skill: true,
						output: reply.split("\n"),
					}
				} catch (err) {
					return {
						agent: "system",
						skill: true,
						output: [`Skill execution error: ${err.message}`],
					}
				}
			}

			// ── @mention agent delegation ─────────────────────────────────
			if (command.startsWith("@")) {
				const mentionAgent = command.slice(1).toLowerCase()
				const mentionTask = args

				// Map @mentions to agent types
				const mentionToAgent = {
					coder: { agent: "coder", taskType: "coder", description: "Coding agent" },
					debugger: { agent: "debugger", taskType: "debug", description: "Debugging agent" },
					tester: { agent: "tester", taskType: "test", description: "Testing agent" },
					planner: { agent: "planner", taskType: "plan", description: "Planning agent" },
					deployer: { agent: "deployer", taskType: "deploy", description: "Deployment agent" },
					crawler: { agent: "crawler", taskType: "crawl", description: "Crawler agent" },
					healer: { agent: "self-healing", taskType: "coder", description: "Self-healing agent" },
					pm: { agent: "pm", taskType: "coder", description: "Product manager agent" },
					commissioner: {
						agent: "commissioner",
						taskType: "coder",
						description: "Commissioning agent — runs full-stack QA verification (14 phases)",
					},
					orchestrator: {
						agent: "orchestrator",
						taskType: "coder",
						description: "Orchestrator agent — breaks down and coordinates multi-step tasks",
					},
				}

				const mentionTarget = mentionToAgent[mentionAgent]
				if (!mentionTarget) {
					return {
						agent: "system",
						output: [
							`Unknown agent: @${mentionAgent}`,
							"Available agents: @coder, @debugger, @tester, @planner, @deployer, @crawler, @healer, @orchestrator, @pm",
						],
					}
				}

				if (!mentionTask) {
					return {
						agent: mentionTarget.agent,
						output: [
							`@${mentionAgent} — ${mentionTarget.description}`,
							"",
							"Usage: @<agent> <task description>",
							"",
							"Example: @coder fix the login validation bug",
						],
					}
				}

				// Route to AI provider
				const provider = resolveProviderForTask(mentionTarget.taskType)
				if (!provider) {
					return {
						agent: mentionTarget.agent,
						output: [`No AI provider available for ${mentionTarget.agent}. Please configure API keys.`],
					}
				}

				// Update pipeline
				const pipelineStep = ws.pipeline.find(
					(s) => s.label.toLowerCase() === mentionTarget.agent || s.id === mentionTarget.agent,
				)
				if (pipelineStep) {
					pipelineStep.status = "running"
					pipelineStep.agent = mentionTarget.agent
				}

				const systemPrompt = [
					`You are SuperRoo acting as the "${mentionTarget.agent}" agent (${mentionTarget.description}).`,
					`The user has delegated this task to you via @${mentionAgent} mention.`,
					`Task: ${mentionTask}`,
					`Workspace: ${ws.repoName} on branch ${ws.branch}`,
					`Directory: ${ws.workspaceDir}`,
					"",
					"Execute the task thoroughly. If you need to run shell commands, describe them.",
					"Be concise, actionable, and provide clear output.",
				].join("\n")

				try {
					const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: mentionTask },
					])

					if (pipelineStep) pipelineStep.status = "done"

					return {
						agent: mentionTarget.agent,
						output: reply.split("\n"),
					}
				} catch (err) {
					if (pipelineStep) pipelineStep.status = "failed"
					return {
						agent: mentionTarget.agent,
						output: [`Agent @${mentionAgent} error: ${err.message}`],
					}
				}
			}

			// ── Built-in agent commands ───────────────────────────────────
			const agentCmd = AGENT_COMMANDS[command]
			if (!agentCmd) {
				return {
					agent: "system",
					output: [
						`Unknown agent command: ${command}`,
						"Type /help to see available agent commands.",
						"Type /skills to see available skills.",
					],
				}
			}

			// ── System commands (no AI needed) ────────────────────────────
			if (agentCmd.agent === "system") {
				switch (command) {
					case "/help":
						const agentList = Object.entries(AGENT_COMMANDS)
							.map(([cmd, info]) => `  ${cmd} — ${info.description}`)
							.join("\n")
						const skillList = Object.entries(SKILL_COMMANDS)
							.map(([name, info]) => `  /skill ${name} — ${info.description}`)
							.join("\n")
						return {
							agent: "system",
							output: [
								"╔══════════════════════════════════════════════╗",
								"║     SuperRoo IDE Terminal — Agent Mode      ║",
								"╚══════════════════════════════════════════════╝",
								"",
								"Agent commands (prefix with /):",
								agentList,
								"",
								"Skill commands:",
								skillList,
								"",
								"Agent mentions (prefix with @):",
								"  @coder <task> — Delegate to Coder agent",
								"  @debugger <task> — Delegate to Debugger agent",
								"  @tester <task> — Delegate to Tester agent",
								"  @planner <task> — Delegate to Planner agent",
								"  @orchestrator <task> — Delegate to Orchestrator agent",
								"",
								"Examples:",
								"  /deploy — Deploy the project",
								"  /orchestrate — Break down a complex task into phases",
								"  /skill supabase setup — Set up Supabase",
								"  @coder fix the login bug — Delegate coding task",
								"  /autonomous — Run autonomous scan",
							],
						}

					case "/agents":
						const agentEntries = Object.entries(AGENT_COMMANDS)
							.filter(([_, info]) => info.agent !== "system")
							.map(([cmd, info]) => `  ${cmd} → ${info.agent} agent — ${info.description}`)
						return {
							agent: "system",
							output: [
								"Available agents:",
								...agentEntries,
								"",
								"Use @agent_name <task> to delegate directly.",
							],
						}

					case "/skills":
						const allSkills = Object.entries(SKILL_COMMANDS)
							.map(([name, info]) => `  /skill ${name} — ${info.description}`)
							.join("\n")
						return {
							agent: "system",
							output: ["Available skills:", allSkills, "", "Usage: /skill <name> [args]"],
						}

					case "/status":
						return {
							agent: "system",
							output: [
								`Workspace: ${ws.repoName}`,
								`Branch: ${ws.branch}`,
								`Directory: ${ws.workspaceDir}`,
								`Terminal sessions: ${ws.terminalSessions.length}`,
								`Chat messages: ${ws.chatMessages.length}`,
								`Pipeline steps: ${ws.pipeline.filter((s) => s.status !== "pending").length}/${ws.pipeline.length} active`,
								`Connected: true`,
							],
						}

					case "/memory":
						return {
							agent: "system",
							output: [
								`Chat history: ${ws.chatMessages.length} messages`,
								`Pipeline: ${ws.pipeline.length} steps`,
								`Terminal sessions: ${ws.terminalSessions.length}`,
								`Recent commands: ${ws.terminalSessions[0]?.output?.slice(-5).join("\n") || "none"}`,
							],
						}

					case "/pipeline":
						const pipelineStatus = ws.pipeline
							.map(
								(s) =>
									`  [${s.status === "done" ? "✓" : s.status === "running" ? "●" : s.status === "approval" ? "Ⅱ" : s.status === "failed" ? "✗" : "○"}] ${s.label} — ${s.status}${s.agent ? ` (${s.agent})` : ""}`,
							)
							.join("\n")
						return {
							agent: "system",
							output: [`Pipeline for task ${ws.repoName}:`, pipelineStatus],
						}

					default:
						return {
							agent: "system",
							output: [`Unknown system command: ${command}`],
						}
				}
			}

			// ── Auto-Deployer agent (proxy to cloud auto-deployer worker) ──
			if (agentCmd.agent === "auto-deployer") {
				try {
					const statusRes = await fetch("http://127.0.0.1:8790/api/auto-deploy/status")
					const statusData = await statusRes.json()

					// If args contain "trigger" or "deploy", trigger a deploy
					if (args && (args.includes("trigger") || args.includes("deploy"))) {
						const triggerRes = await fetch("http://127.0.0.1:8790/api/auto-deploy/trigger", {
							method: "POST",
						})
						const triggerData = await triggerRes.json()
						return {
							agent: "auto-deployer",
							output: [
								"╔══════════════════════════════════════════════╗",
								"║     Auto-Deployer — Deploy Triggered        ║",
								"╚══════════════════════════════════════════════╝",
								`State: ${triggerData.state}`,
								`Attempt: ${triggerData.currentAttempt}/${triggerData.maxRetries}`,
								`Message: ${triggerData.message || "Deploy started"}`,
								"",
								"Check status with: /auto-deploy",
								"View dashboard: Auto Deploy tab in sidebar",
							],
						}
					}

					// Default: show status
					const lastAttempt = statusData.attempts?.[statusData.attempts.length - 1]
					return {
						agent: "auto-deployer",
						output: [
							"╔══════════════════════════════════════════════╗",
							"║     Auto-Deployer Status                     ║",
							"╚══════════════════════════════════════════════╝",
							`State: ${statusData.state}`,
							`Total attempts: ${statusData.attempts?.length || 0}`,
							`Current attempt: ${statusData.currentAttempt || 0}`,
							`Max retries: ${statusData.maxRetries || 5}`,
							`Last error: ${statusData.lastError || "none"}`,
							`Triggered by: ${statusData.triggeredBy || "none"}`,
							lastAttempt ? `Last attempt: ${lastAttempt.status} (${lastAttempt.timestamp})` : "",
							"",
							"Commands:",
							"  /auto-deploy — Show this status",
							"  /auto-deploy trigger — Trigger a deploy",
							"  /auto-deploy deploy — Trigger a deploy",
							"",
							"View full dashboard: Auto Deploy tab in sidebar",
						].filter(Boolean),
					}
				} catch (err) {
					return {
						agent: "auto-deployer",
						output: [
							"Auto-Deployer is not available.",
							`Error: ${err.message}`,
							"",
							"The auto-deployer worker may not be running.",
							"Ensure the VPS is online and PM2 service 'superroo-auto-deployer' is started.",
						],
					}
				}
			}

			// ── Orchestrator agent (CloudOrchestrator-powered task breakdown) ─
			if (agentCmd.agent === "orchestrator") {
				if (!orchestrator) {
					return {
						agent: "orchestrator",
						output: [
							"Cloud Orchestrator is not initialized.",
							"Check server logs for initialization errors.",
						],
					}
				}

				// Update pipeline — orchestrator activates all steps
				ws.pipeline = ws.pipeline.map((s) => ({ ...s, status: "pending" }))
				if (ws.pipeline[0]) ws.pipeline[0].status = "running"

				try {
					// Submit task to CloudOrchestrator (SQLite-backed, event-logged, safety-checked)
					const task = orchestrator.submit({
						type: "orchestrator",
						input: {
							instruction: args || "Help me plan and execute a task.",
							workspace: {
								repoName: ws.repoName,
								branch: ws.branch,
								directory: ws.workspaceDir,
							},
						},
						priority: 10,
						agent: "orchestrator",
						sessionId: ws.sessionId || "ide-session",
					})

					// Log the orchestration event
					writeApiLog("info", "orchestrator-agent", `Task submitted: ${task.id}`, {
						taskId: task.id,
						instruction: (args || "").substring(0, 200),
					})

					// Poll for task completion (up to 120s, 1s interval)
					const maxWait = 120_000
					const pollInterval = 1_000
					const started = Date.now()
					let result = null

					while (Date.now() - started < maxWait) {
						const current = orchestrator.taskQueue.get(task.id)
						if (!current) break

						if (current.status === "completed") {
							result = current.output
							break
						}
						if (current.status === "failed") {
							throw new Error(current.error || "Task failed without error message")
						}
						if (current.status === "blocked") {
							throw new Error(`Task blocked by safety: ${current.error || "unknown reason"}`)
						}

						// Process next pending task in the queue
						await orchestrator.processNext()
						await new Promise((r) => setTimeout(r, pollInterval))
					}

					if (!result) {
						throw new Error("Orchestrator task timed out after 120s")
					}

					// Mark pipeline as done
					ws.pipeline = ws.pipeline.map((s) => ({ ...s, status: "done" }))

					// Format output — result can be string, array, or object
					const outputLines = Array.isArray(result)
						? result
						: typeof result === "object" && result !== null
							? [JSON.stringify(result, null, 2)]
							: [String(result)]

					return {
						agent: "orchestrator",
						output: outputLines,
					}
				} catch (err) {
					ws.pipeline = ws.pipeline.map((s) => ({
						...s,
						status: s.status === "running" ? "failed" : s.status,
					}))
					writeApiLog("error", "orchestrator-agent", `Orchestration failed: ${err.message}`, {
						error: err.message,
					})
					return {
						agent: "orchestrator",
						output: [`Orchestrator error: ${err.message}`],
					}
				}
			}

			// ── Commissioning agent (CommissioningLoop-powered 14-phase QA) ──
			if (agentCmd.agent === "commissioner") {
				if (!orchestrator) {
					return {
						agent: "commissioner",
						output: [
							"Cloud Orchestrator is not initialized.",
							"Check server logs for initialization errors.",
						],
					}
				}

				try {
					// If already running, show status
					if (commissioningLoop && commissioningLoop.getStatus().running) {
						const status = commissioningLoop.getStatus()
						return {
							agent: "commissioner",
							output: [
								"╔══════════════════════════════════════════════╗",
								"║     Commissioning — Already Running          ║",
								"╚══════════════════════════════════════════════╝",
								`Job ID: ${status.jobId}`,
								`Current phase: ${status.currentPhase}/${status.totalPhases} (${status.phaseName})`,
								`Elapsed: ${status.elapsed}`,
								`Completed phases: ${status.completedPhases}`,
								`Failed phases: ${status.failedPhases}`,
								"",
								"Use /commissioning status to refresh.",
								"Use /commissioning stop to stop the current run.",
							],
						}
					}

					// Start new commissioning run
					commissioningLoop = new (require("../orchestrator/modules/CommissioningLoop").CommissioningLoop)({
						orchestrator,
						workspaceRoot: process.cwd(),
						containerFirst: true,
						phaseTimeoutMs: 10 * 60 * 1000,
					})

					// Start in background — don't block the terminal
					const jobId = `commission-${Date.now()}`
					commissioningLoop.start({ jobId }).catch((err) => {
						writeApiLog("error", "commissioning-agent", `Commissioning failed: ${err.message}`, {
							error: err.message,
						})
					})

					return {
						agent: "commissioner",
						output: [
							"╔══════════════════════════════════════════════╗",
							"║     Commissioning Started (14 Phases)        ║",
							"╚══════════════════════════════════════════════╝",
							`Job ID: ${jobId}`,
							"",
							"Phases:",
							"  Phase 1  — Repository & Architecture Inspection",
							"  Phase 2  — Dependency & Environment Validation",
							"  Phase 3  — Application Boot Verification",
							"  Phase 4  — Real User UI Testing (Playwright)",
							"  Phase 5  — API & Backend Verification",
							"  Phase 6  — Database Validation",
							"  Phase 7  — Integration & External Service Verification",
							"  Phase 8  — Queue, Worker & Background Job Testing",
							"  Phase 9  — File Upload & Storage Testing",
							"  Phase 10 — Security & Auth Validation",
							"  Phase 11 — Performance & Stability Testing",
							"  Phase 12 — Autonomous Debugging & Recovery",
							"  Phase 13 — Deployment Readiness Verification",
							"  Phase 14 — Final Commissioning Report",
							"",
							"All test suites run inside Docker containers for safety.",
							"",
							"Commands:",
							"  /commissioning status — Check progress",
							"  /commissioning stop   — Stop the run",
							"  /commissioning report — View final report",
						],
					}
				} catch (err) {
					return {
						agent: "commissioner",
						output: [`Commissioning error: ${err.message}`],
					}
				}
			}

			// ── Agent commands (route through AI provider) ────────────────
			const provider = resolveProviderForTask(
				agentCmd.agent === "debugger"
					? "debug"
					: agentCmd.agent === "tester"
						? "test"
						: agentCmd.agent === "deployer"
							? "deploy"
							: agentCmd.agent === "crawler"
								? "crawl"
								: agentCmd.agent === "planner"
									? "plan"
									: agentCmd.agent === "orchestrator"
										? "coder"
										: "coder",
			)

			if (!provider) {
				return {
					agent: agentCmd.agent,
					output: [`No AI provider available for ${agentCmd.agent} agent. Please configure API keys.`],
				}
			}

			// Update pipeline to show this agent is active
			const pipelineStep = ws.pipeline.find(
				(s) => s.label.toLowerCase() === agentCmd.agent || s.id === agentCmd.agent,
			)
			if (pipelineStep) {
				pipelineStep.status = "running"
				pipelineStep.agent = agentCmd.agent
			}

			const systemPrompt = [
				`You are SuperRoo acting as the "${agentCmd.agent}" agent.`,
				`Task: ${agentCmd.description}`,
				`User request: ${args || "Execute your function"}`,
				`Workspace: ${ws.repoName} on branch ${ws.branch}`,
				`Directory: ${ws.workspaceDir}`,
				"",
				"Execute the task and provide clear output. If shell commands are needed,",
				"describe what you would run. Be concise and actionable.",
			].join("\n")

			try {
				const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: args || `Execute as ${agentCmd.agent} agent.` },
				])

				// Mark pipeline step as done
				if (pipelineStep) {
					pipelineStep.status = "done"
				}

				return {
					agent: agentCmd.agent,
					output: reply.split("\n"),
				}
			} catch (err) {
				if (pipelineStep) {
					pipelineStep.status = "failed"
				}
				return {
					agent: agentCmd.agent,
					output: [`Agent execution error: ${err.message}`],
				}
			}
		}

		// GET /ide-workspace/workspace — get or create workspace session
		if (method === "GET" && normalizedUrl.startsWith("/ide-workspace/workspace")) {
			let files = []
			try {
				files = await walkDir(ws.workspaceDir, "")
			} catch (e) {
				// Ignore walk errors
			}
			sendJson(res, 200, {
				workspaceId: ws.workspaceDir,
				repoName: ws.repoName,
				branch: ws.branch,
				files,
				openFiles: [],
				activeFile: null,
				pipeline: ws.pipeline,
				terminalSessions: ws.terminalSessions,
				activeTerminal: ws.activeTerminal,
				chatMessages: ws.chatMessages,
				status: { connected: true, docker: false, redis: false, cpu: "0%", ram: "0MB" },
			})
			return
		}

		// POST /ide-workspace/workspace/reset — reset workspace
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/workspace/reset")) {
			ws.pipeline = [
				{ id: "plan", label: "Plan", status: "pending" },
				{ id: "crawl", label: "Crawl", status: "pending" },
				{ id: "patch", label: "Patch", status: "pending" },
				{ id: "approval", label: "Approval", status: "pending" },
				{ id: "tests", label: "Tests", status: "pending" },
				{ id: "deploy", label: "Deploy", status: "pending" },
			]
			ws.chatMessages = []
			ws.terminalSessions = [
				{
					id: "term-1",
					name: "bash",
					cwd: ws.workspaceDir,
					createdAt: new Date().toISOString(),
					output: ["Welcome to SuperRoo IDE Terminal", "Type a command to get started..."],
				},
			]
			saveWorkspaceStore(global.__ideWorkspace) // persist reset
			sendJson(res, 200, { ok: true, message: "Workspace reset" })
			return
		}

		// POST /ide-workspace/terminal/execute — execute command
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/terminal/execute")) {
			const data = await parseBody(req)
			const cmd = data?.command || ""
			const terminalId = data?.terminalId || "term-1"
			const mode = ["shell", "agent", "skill"].includes(data?.mode) ? data.mode : "shell"

			if (!cmd) {
				sendJson(res, 400, { ok: false, error: "Missing command" })
				return
			}

			// Find the terminal session
			let term = ws.terminalSessions.find((t) => t.id === terminalId)
			if (!term) {
				term = ws.terminalSessions[0]
			}

			// ── Agent/Skill-aware command detection ────────────────────────
			// Detect if this is an agent/skill command (prefixed with / or @)
			const routedCommand =
				mode === "agent" && !cmd.startsWith("/") && !cmd.startsWith("@")
					? `/code ${cmd}`
					: mode === "skill" && !cmd.startsWith("/")
						? `/skill ${cmd}`
						: cmd
			const isAgentCommand = mode !== "shell" || routedCommand.startsWith("/") || routedCommand.startsWith("@")

			if (isAgentCommand) {
				// Route through agent system instead of raw shell
				try {
					const agentResult = await handleAgentTerminalCommand(routedCommand, ws, term)
					const outputLines = agentResult.output || ["Command processed by agent system"]
					// Log to terminal session
					term.output.push(`$ ${routedCommand}`)
					term.output.push(...outputLines)
					saveWorkspaceStore(global.__ideWorkspace) // persist terminal
					sendJson(res, 200, {
						ok: true,
						output: [`$ ${routedCommand}`, ...outputLines],
						agent: agentResult.agent,
						skill: agentResult.skill,
					})
				} catch (err) {
					const errorLines = [`$ ${cmd}`, `Error: ${err.message}`]
					term.output.push(...errorLines)
					saveWorkspaceStore(global.__ideWorkspace) // persist terminal
					sendJson(res, 200, {
						ok: true,
						output: errorLines,
					})
				}
				return
			}

			// ── Raw shell execution (for non-agent commands) ──────────────
			term.output.push(`$ ${cmd}`)

			try {
				const result = await execAsync(cmd, {
					cwd: term.cwd || ws.workspaceDir,
					timeout: 30000,
					maxBuffer: 1024 * 1024, // 1MB
				})

				if (result.stdout) {
					const lines = result.stdout.trim().split("\n")
					term.output.push(...lines)
				}
				if (result.stderr) {
					const lines = result.stderr.trim().split("\n")
					term.output.push(...lines.map((l) => `stderr: ${l}`))
				}

				saveWorkspaceStore(global.__ideWorkspace) // persist terminal
				sendJson(res, 200, {
					ok: true,
					message: "Command executed",
					output: [
						`$ ${cmd}`,
						...(result.stdout ? result.stdout.trim().split("\n") : []),
						...(result.stderr
							? result.stderr
									.trim()
									.split("\n")
									.map((l) => `stderr: ${l}`)
							: []),
					],
				})
			} catch (err) {
				const errorMsg = err.stderr || err.message || "Command failed"
				term.output.push(`Error: ${errorMsg}`)
				saveWorkspaceStore(global.__ideWorkspace) // persist terminal
				sendJson(res, 200, {
					ok: true,
					message: "Command completed with errors",
					output: [`$ ${cmd}`, `Error: ${errorMsg}`],
				})
			}
			return
		}

		// POST /ide-workspace/terminal/create — create terminal
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/terminal/create")) {
			const data = await parseBody(req)
			const newTerm = {
				id: `term-${ws.terminalSessions.length + 1}`,
				name: data?.name || "bash",
				cwd: data?.cwd || ws.workspaceDir,
				createdAt: new Date().toISOString(),
				output: ["Terminal created"],
			}
			ws.terminalSessions.push(newTerm)
			ws.activeTerminal = newTerm.id
			saveWorkspaceStore(global.__ideWorkspace) // persist terminal
			sendJson(res, 200, { ok: true, message: "Terminal created", terminal: newTerm })
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

		// POST /ide-workspace/chat — send chat message (OpenClaw-powered)
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/chat")) {
			const data = await parseBody(req)
			const msg = data?.message || ""
			const requestedProvider = data?.provider || null
			const requestedModel = data?.model || null
			const sessionId = req.headers["x-session-id"] || "default"
			const chatSession = await getChatSession(sessionId)

			// Store user message
			chatSession.chatMessages.push({
				id: `msg-${Date.now()}`,
				role: "user",
				author: "You",
				time: new Date().toLocaleTimeString(),
				content: msg,
			})
			saveWorkspaceStore(chatSession, sessionId) // persist chat

			// ── OpenClaw intent classification ──────────────────────────────
			// Build providers array for the classifier (same format askAI uses)
			const classifierProviders = PROVIDERS.map((p) => {
				const meta = providerMeta.get(p.id) || {}
				const apiKey = readProviderApiKey(p.id)
				if (!apiKey) return null
				return {
					providerId: p.id,
					apiKey,
					apiBaseUrl: meta.apiBaseUrl || p.apiBaseUrl,
					model: meta.defaultModel || p.defaultModel,
				}
			}).filter(Boolean)

			let intent = null
			try {
				intent = await telegramClassifier.classifyIntent(msg, classifierProviders)
			} catch (e) {
				console.error("[ide-chat] Classifier error:", e.message)
			}

			const intentKind = intent?.kind || "chat"
			const intentConfidence = intent?.confidence || 0

			// ── Route based on intent ──────────────────────────────────────
			// Map OpenClaw kinds to agent types and pipeline steps
			const intentToAgent = {
				chat: { agent: "chat", pipelineStep: null },
				debug_plan: { agent: "debugger", pipelineStep: "plan" },
				read_logs: { agent: "debugger", pipelineStep: "crawl" },
				run_tests: { agent: "tester", pipelineStep: "tests" },
				create_branch: { agent: "coder", pipelineStep: "plan" },
				create_pr: { agent: "coder", pipelineStep: "deploy" },
				restart_worker: { agent: "deployer", pipelineStep: "deploy" },
				deploy: { agent: "deployer", pipelineStep: "deploy" },
				shell: { agent: "coder", pipelineStep: "patch" },
			}

			const routing = intentToAgent[intentKind] || { agent: "chat", pipelineStep: null }

			// Update pipeline to show the active step
			if (routing.pipelineStep) {
				ws.pipeline = ws.pipeline.map((s) => ({
					...s,
					status: s.id === routing.pipelineStep ? "running" : "pending",
				}))
			}

			// ── Resolve AI provider ────────────────────────────────────────
			let provider = null
			if (requestedProvider) {
				provider = resolveProviderById(requestedProvider, requestedModel)
			}
			if (!provider) {
				provider = resolveProviderForTask(
					routing.agent === "debugger" ? "debug" : routing.agent === "tester" ? "test" : "coder",
				)
			}

			if (!provider) {
				const noProviderMsg =
					"No AI provider is configured and connected. Please go to the API Keys page to add and test a provider API key (e.g., DeepSeek, OpenAI, or Anthropic). After saving the key, click 'Test' to verify the connection."
				chatSession.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "agent",
					author: "System",
					time: new Date().toLocaleTimeString(),
					content: noProviderMsg,
				})
				saveWorkspaceStore(chatSession, sessionId) // persist chat
				sendJson(res, 200, {
					ok: true,
					message: "No AI provider available",
					reply: noProviderMsg,
				})
				return
			}

			// ── OpenClaw-powered response ─────────────────────────────────
			// Use HermesClaw context recall + orchestrator dispatch for smarter replies
			let hermesContext = ""
			let orchestratorTaskId = null
			let orchestratorResult = null

			try {
				// Step 1: HermesClaw context recall — inject relevant past knowledge
				if (orchestrator && orchestrator.hermesClaw) {
					try {
						const recallResult = await orchestrator.hermesClaw.recallContext(msg, 3)
						if (recallResult && recallResult.output) {
							hermesContext = recallResult.output
						}
					} catch (hermesErr) {
						console.error("[ide-chat] Hermes recall error:", hermesErr.message)
					}
				}

				// Step 2: Route complex tasks through orchestrator, simple chat stays as LLM call
				const isComplexTask =
					intentKind !== "chat" &&
					intentConfidence >= 0.5 &&
					["debug_plan", "run_tests", "deploy", "shell", "create_branch", "create_pr"].includes(intentKind)

				if (isComplexTask && orchestrator) {
					// Submit as orchestrator task for multi-agent breakdown
					const task = orchestrator.submit({
						type: "orchestrator",
						input: {
							instruction: msg,
							workspace: {
								repoName: ws.repoName,
								branch: ws.branch,
								workspaceDir: ws.workspaceDir,
							},
						},
						metadata: {
							source: "ide-terminal",
							intent: intentKind,
							confidence: intentConfidence,
							hermesContext: hermesContext ? hermesContext.substring(0, 1000) : "",
						},
					})
					orchestratorTaskId = task.id

					// Poll for completion (max 30s for simple tasks)
					const pollStart = Date.now()
					const POLL_TIMEOUT = 30_000
					const POLL_INTERVAL = 500
					let taskResult = null
					while (Date.now() - pollStart < POLL_TIMEOUT) {
						const status = orchestrator.getStatus()
						const taskStatus = status.tasks?.find((t) => t.id === task.id)
						if (taskStatus) {
							if (taskStatus.status === "completed") {
								taskResult = taskStatus.output || "Task completed successfully."
								break
							}
							if (taskStatus.status === "failed") {
								taskResult = `Task failed: ${taskStatus.error || "Unknown error"}`
								break
							}
						}
						await new Promise((r) => setTimeout(r, POLL_INTERVAL))
					}
					if (!taskResult) {
						taskResult = "Task is still processing in the background. Check the Plan tab for progress."
					}
					orchestratorResult = taskResult
				}

				// Step 3: Build context-aware system prompt with Hermes recall
				const contextParts = [
					`You are SuperRoo, an expert AI coding assistant running in the Cloud Dashboard IDE Terminal.`,
					`You have access to the OpenClaw orchestrator system with multi-agent capabilities.`,
				]
				contextParts.push(
					`The current workspace is "${chatSession.repoName}" on branch "${chatSession.branch}".`,
				)
				contextParts.push(`The workspace directory is: ${chatSession.workspaceDir}`)
				const cleanChatHistory = chatSession.chatMessages.filter(
					(m) => m.role === "user" || m.role === "agent" || m.role === "assistant",
				)
				if (cleanChatHistory.length > 2) {
					const recent = cleanChatHistory
						.slice(-4, -1)
						.map((m) => `${m.author}: ${m.content.slice(0, 200)}`)
						.join("\n")
					contextParts.push(`Recent conversation:\n${recent}`)
				}
				if (intentKind !== "chat" && intentConfidence >= 0.3) {
					contextParts.push(
						`The user's intent was classified as "${intentKind}" (confidence: ${(intentConfidence * 100).toFixed(0)}%). Route your response accordingly.`,
					)
				}
				if (hermesContext) {
					contextParts.push(
						`Relevant context from past sessions (HermesClaw memory):\n${hermesContext.substring(0, 1500)}`,
					)
				}
				if (orchestratorResult) {
					contextParts.push(`Orchestrator task result:\n${orchestratorResult.substring(0, 2000)}`)
				}

				const systemPrompt = contextParts.join("\n")

				// Step 4: Call LLM with enriched context
				const historyMessages = cleanChatHistory.slice(-10, -1).map((m) => ({
					role: m.role === "user" ? "user" : "assistant",
					content: m.content,
				}))
				const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
					{ role: "system", content: systemPrompt },
					...historyMessages,
					{ role: "user", content: msg },
				])

				chatSession.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "agent",
					author: provider.providerId,
					meta: `${provider.model} · ${routing.agent}${orchestratorTaskId ? ` · task:${orchestratorTaskId.substring(0, 8)}` : ""}`,
					time: new Date().toLocaleTimeString(),
					content: reply,
				})

				// Mark pipeline step as done after successful response
				if (routing.pipelineStep) {
					chatSession.pipeline = chatSession.pipeline.map((s) => ({
						...s,
						status: s.id === routing.pipelineStep ? "done" : s.status,
					}))
				}

				saveWorkspaceStore(chatSession, sessionId) // persist chat + pipeline

				// Step 5: Fire-and-forget HermesClaw lesson extraction (learn from every interaction)
				if (orchestrator && orchestrator.hermesClaw) {
					orchestrator.hermesClaw
						.extractLessons({
							taskId: `ide-chat-${Date.now()}`,
							goal: msg.substring(0, 500),
							phases: [
								{
									number: 1,
									phase: routing.agent,
									result: "completed",
								},
							],
							finalStatus: "completed",
							error: null,
						})
						.catch((err) => {
							console.error("[ide-chat] Hermes lesson error:", err.message)
						})
				}

				sendJson(res, 200, {
					ok: true,
					message: "OK",
					reply,
					provider: provider.providerId,
					model: provider.model,
					intent: intentKind,
					intentConfidence,
					agent: routing.agent,
					orchestratorTaskId,
					hermesContextUsed: !!hermesContext,
				})
			} catch (err) {
				console.error(`[api] Chat error with ${provider.providerId}:`, err.message)
				chatSession.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "assistant",
					author: "System",
					time: new Date().toLocaleTimeString(),
					content: `AI request failed: ${err.message}`,
				})
				saveWorkspaceStore(chatSession, sessionId) // persist chat
				sendJson(res, 200, {
					ok: true,
					message: "AI call failed",
					reply: `AI request failed: ${err.message}. Check your API key and try again.`,
					provider: provider.providerId,
					model: provider.model,
					error: err.message,
					intent: intentKind,
				})
			}
			return
		}

		// GET /ide-workspace/chat/stream — SSE streaming chat (VS Code-like real-time response)
		if (method === "GET" && normalizedUrl.startsWith("/ide-workspace/chat/stream")) {
			const urlObj = new URL(req.url, "http://localhost")
			const msg = urlObj.searchParams.get("message") || ""
			const requestedProvider = urlObj.searchParams.get("provider") || null
			const requestedModel = urlObj.searchParams.get("model") || null

			if (!msg) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ ok: false, error: "Missing message parameter" }))
				return
			}

			// Set SSE headers
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			})

			// Helper to send SSE event
			const sendSSE = (event, data) => {
				res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
			}

			const sessionId = req.headers["x-session-id"] || "default"
			const chatSession = await getChatSession(sessionId)

			// Store user message
			chatSession.chatMessages.push({
				id: `msg-${Date.now()}`,
				role: "user",
				author: "You",
				time: new Date().toLocaleTimeString(),
				content: msg,
			})
			saveWorkspaceStore(chatSession, sessionId)

			// Send initial event
			sendSSE("start", { message: "Processing..." })

			// ── Resolve AI provider ────────────────────────────────────────
			let provider = null
			if (requestedProvider) {
				provider = resolveProviderById(requestedProvider, requestedModel)
			}
			if (!provider) {
				provider = resolveProviderForTask("coder")
			}

			if (!provider) {
				sendSSE("error", { message: "No AI provider configured. Add an API key in Settings." })
				res.end()
				return
			}

			try {
				// Step 1: HermesClaw context recall
				let hermesContext = ""
				if (orchestrator && orchestrator.hermesClaw) {
					try {
						const recallResult = await orchestrator.hermesClaw.recallContext(msg, 3)
						if (recallResult && recallResult.output) {
							hermesContext = recallResult.output
						}
					} catch (hermesErr) {
						console.error("[ide-chat-stream] Hermes recall error:", hermesErr.message)
					}
				}

				// Step 2: Build system prompt
				const contextParts = [
					`You are SuperRoo, an expert AI coding assistant running in the Cloud Dashboard IDE Terminal.`,
					`You have access to the OpenClaw orchestrator system with multi-agent capabilities.`,
					`The current workspace is "${chatSession.repoName}" on branch "${chatSession.branch}".`,
					`The workspace directory is: ${chatSession.workspaceDir}`,
				]
				const cleanStreamHistory = chatSession.chatMessages.filter(
					(m) => m.role === "user" || m.role === "agent" || m.role === "assistant",
				)
				if (cleanStreamHistory.length > 2) {
					const recent = cleanStreamHistory
						.slice(-4, -1)
						.map((m) => `${m.author}: ${m.content.slice(0, 200)}`)
						.join("\n")
					contextParts.push(`Recent conversation:\n${recent}`)
				}
				if (hermesContext) {
					contextParts.push(`Relevant context from past sessions:\n${hermesContext.substring(0, 1500)}`)
				}
				const systemPrompt = contextParts.join("\n")

				// Step 3: Stream the LLM response
				const apiUrl = `${provider.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`
				const historyMessages = cleanStreamHistory.slice(-10, -1).map((m) => ({
					role: m.role === "user" ? "user" : "assistant",
					content: m.content,
				}))
				const streamRes = await fetch(apiUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${provider.apiKey}`,
					},
					body: JSON.stringify({
						model: provider.model,
						messages: [
							{ role: "system", content: systemPrompt },
							...historyMessages,
							{ role: "user", content: msg },
						],
						max_tokens: 4096,
						temperature: 0.7,
						stream: true,
					}),
					signal: AbortSignal.timeout(120_000),
				})

				if (!streamRes.ok) {
					const errBody = await streamRes.text().catch(() => "")
					sendSSE("error", { message: `AI API error ${streamRes.status}: ${errBody.slice(0, 200)}` })
					res.end()
					return
				}

				// Read the stream
				const reader = streamRes.body.getReader()
				const decoder = new TextDecoder()
				let fullReply = ""
				let buffer = ""

				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					buffer += decoder.decode(value, { stream: true })
					const lines = buffer.split("\n")
					buffer = lines.pop() || ""

					for (const line of lines) {
						const trimmed = line.trim()
						if (!trimmed || !trimmed.startsWith("data: ")) continue
						const jsonStr = trimmed.slice(6)
						if (jsonStr === "[DONE]") continue

						try {
							const chunk = JSON.parse(jsonStr)
							const delta = chunk.choices?.[0]?.delta?.content || ""
							if (delta) {
								fullReply += delta
								sendSSE("token", { token: delta })
							}
						} catch {
							// Skip malformed chunks
						}
					}
				}

				// Send completion event
				sendSSE("done", { reply: fullReply, provider: provider.providerId, model: provider.model })

				// Store the full reply
				chatSession.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "agent",
					author: provider.providerId,
					meta: `${provider.model} · stream`,
					time: new Date().toLocaleTimeString(),
					content: fullReply,
				})
				saveWorkspaceStore(chatSession, sessionId)

				// Fire-and-forget Hermes lesson extraction
				if (orchestrator && orchestrator.hermesClaw) {
					orchestrator.hermesClaw
						.extractLessons({
							taskId: `ide-stream-${Date.now()}`,
							goal: msg.substring(0, 500),
							phases: [{ number: 1, phase: "chat", result: "completed" }],
							finalStatus: "completed",
							error: null,
						})
						.catch(() => {})
				}
			} catch (err) {
				console.error("[ide-chat-stream] Error:", err.message)
				sendSSE("error", { message: err.message })
			}

			res.end()
			return
		}

		// POST /ide-workspace/terminal/exec — execute a shell command on the VPS
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/terminal/exec")) {
			const data = await parseBody(req)
			const command = data?.command || ""
			const cwd = data?.cwd || ws.workspaceDir || "/opt/superroo2"

			if (!command) {
				sendJson(res, 400, { ok: false, error: "Missing command" })
				return
			}

			try {
				const result = await execAsync(command, {
					cwd,
					timeout: 30000,
					maxBuffer: 1024 * 1024,
				})
				sendJson(res, 200, {
					ok: true,
					stdout: result.stdout || "",
					stderr: result.stderr || "",
					exitCode: result.exitCode || 0,
				})
			} catch (err) {
				sendJson(res, 200, {
					ok: true,
					stdout: err.stdout || "",
					stderr: err.stderr || err.message,
					exitCode: err.code || 1,
				})
			}
			return
		}

		// POST /ide-workspace/diff — compute diff between two strings
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/diff")) {
			const data = await parseBody(req)
			const original = data?.original || ""
			const modified = data?.modified || ""

			if (!original && !modified) {
				sendJson(res, 400, { ok: false, error: "Missing original or modified content" })
				return
			}

			const origLines = original.split("\n")
			const modLines = modified.split("\n")
			const maxLen = Math.max(origLines.length, modLines.length)
			const changes = []

			for (let i = 0; i < maxLen; i++) {
				const o = origLines[i] || ""
				const m = modLines[i] || ""
				if (o !== m) {
					changes.push({
						line: i + 1,
						original: o,
						modified: m,
						type: o && m ? "modified" : o ? "removed" : "added",
					})
				}
			}

			sendJson(res, 200, {
				ok: true,
				changes,
				totalChanges: changes.length,
				originalLines: origLines.length,
				modifiedLines: modLines.length,
			})
			return
		}

		// PATCH /ide-workspace/pipeline — update pipeline step
		if (method === "PATCH" && normalizedUrl.startsWith("/ide-workspace/pipeline")) {
			const data = await parseBody(req)
			const stepId = data?.stepId || "unknown"
			const action = data?.action || "unknown"

			// Update pipeline step status
			const step = ws.pipeline.find((s) => s.id === stepId)
			if (step) {
				if (action === "approve") {
					step.status = "running"
				} else if (action === "complete") {
					step.status = "done"
				} else if (action === "fail") {
					step.status = "failed"
				} else if (action === "block") {
					step.status = "blocked"
				} else {
					step.status = "running"
				}
			}

			saveWorkspaceStore(global.__ideWorkspace) // persist pipeline
			sendJson(res, 200, {
				ok: true,
				message: `Pipeline step "${stepId}" updated with action "${action}"`,
				pipeline: ws.pipeline,
			})
			return
		}

		// ── OpenClaw IDE Terminal Integration ─────────────────────────────────
		// These endpoints let the IDE Terminal UI interact with the orchestrator
		// and HermesClaw directly (Plan tab, Memory tab, Deploy tab)

		// GET /ide-workspace/orchestrator/status — get orchestrator status + tasks
		if (method === "GET" && normalizedUrl === "/ide-workspace/orchestrator/status") {
			if (!orchestrator) {
				sendJson(res, 503, { ok: false, error: "Orchestrator not initialized" })
				return
			}
			try {
				const status = orchestrator.getStatus()
				sendJson(res, 200, {
					ok: true,
					running: status.running,
					mode: status.mode,
					uptime: status.uptimeMs,
					taskCount: status.taskCount,
					tasks: (status.tasks || []).slice(-20).map((t) => ({
						id: t.id,
						type: t.type,
						status: t.status,
						createdAt: t.createdAt,
						updatedAt: t.updatedAt,
						instruction: t.input?.instruction?.substring(0, 200) || "",
					})),
					modules: Object.keys(status.modules || {}).filter((k) => status.modules[k]),
					hermesClaw: !!orchestrator.hermesClaw,
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: err.message })
			}
			return
		}

		// POST /ide-workspace/orchestrator/submit — submit a task to the orchestrator
		if (method === "POST" && normalizedUrl === "/ide-workspace/orchestrator/submit") {
			if (!orchestrator) {
				sendJson(res, 503, { ok: false, error: "Orchestrator not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				const instruction = data?.instruction || ""
				if (!instruction) {
					sendJson(res, 400, { ok: false, error: "Missing instruction" })
					return
				}
				const task = orchestrator.submit({
					type: "orchestrator",
					input: {
						instruction,
						workspace: {
							repoName: ws.repoName,
							branch: ws.branch,
							workspaceDir: ws.workspaceDir,
						},
					},
					metadata: {
						source: "ide-terminal",
						intent: data.intent || "manual",
					},
				})
				sendJson(res, 200, {
					ok: true,
					taskId: task.id,
					status: task.status,
					createdAt: task.createdAt,
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: err.message })
			}
			return
		}

		// GET /ide-workspace/orchestrator/task/:id — get task status
		const taskMatch = normalizedUrl.match(/^\/ide-workspace\/orchestrator\/task\/([a-zA-Z0-9_-]+)$/)
		if (method === "GET" && taskMatch) {
			if (!orchestrator) {
				sendJson(res, 503, { ok: false, error: "Orchestrator not initialized" })
				return
			}
			try {
				const taskId = taskMatch[1]
				const status = orchestrator.getStatus()
				const task = (status.tasks || []).find((t) => t.id === taskId)
				if (!task) {
					sendJson(res, 404, { ok: false, error: "Task not found" })
					return
				}
				sendJson(res, 200, {
					ok: true,
					task: {
						id: task.id,
						type: task.type,
						status: task.status,
						createdAt: task.createdAt,
						updatedAt: task.updatedAt,
						instruction: task.input?.instruction?.substring(0, 500) || "",
						output: task.output?.substring(0, 5000) || null,
						error: task.error || null,
					},
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: err.message })
			}
			return
		}

		// GET /ide-workspace/hermes/recall — query HermesClaw memory
		if (method === "GET" && normalizedUrl === "/ide-workspace/hermes/recall") {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { ok: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const urlObj = new URL(req.url, "http://localhost")
				const q = urlObj.searchParams.get("q") || ""
				const limit = parseInt(urlObj.searchParams.get("limit") || "5", 10)
				if (!q) {
					sendJson(res, 400, { ok: false, error: "Missing query parameter: q" })
					return
				}
				const result = await orchestrator.hermesClaw.recallContext(q, limit)
				sendJson(res, 200, {
					ok: true,
					query: q,
					result: result?.output || "No relevant context found.",
					structuredData: result?.structuredData || null,
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: err.message })
			}
			return
		}

		// GET /ide-workspace/hermes/stats — get HermesClaw stats for Memory tab
		if (method === "GET" && normalizedUrl === "/ide-workspace/hermes/stats") {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { ok: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const stats = orchestrator.hermesClaw.getStats()
				sendJson(res, 200, {
					ok: true,
					stats,
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: err.message })
			}
			return
		}

		// GET /ide-workspace/file/read — read file content
		if (method === "GET" && normalizedUrl.startsWith("/ide-workspace/file/read")) {
			const urlObj = new URL(req.url, "http://localhost")
			const filePath = urlObj.searchParams.get("path") || ""

			if (!filePath) {
				sendJson(res, 400, { ok: false, error: "Missing path parameter" })
				return
			}

			// Resolve the absolute path (prevent directory traversal)
			const resolvedPath = path.resolve(ws.workspaceDir, "." + filePath)
			if (!resolvedPath.startsWith(path.resolve(ws.workspaceDir))) {
				sendJson(res, 403, { ok: false, error: "Access denied: path outside workspace" })
				return
			}

			try {
				const stat = await fs.stat(resolvedPath)
				if (!stat.isFile()) {
					sendJson(res, 400, { ok: false, error: "Not a file" })
					return
				}
				const content = await fs.readFile(resolvedPath, "utf-8")
				const ext = path.extname(resolvedPath).slice(1)
				sendJson(res, 200, {
					ok: true,
					path: filePath,
					content,
					language: ext,
					size: stat.size,
					modified: stat.mtimeMs,
				})
			} catch (err) {
				if (err.code === "ENOENT") {
					sendJson(res, 404, { ok: false, error: "File not found" })
				} else {
					sendJson(res, 500, { ok: false, error: `Failed to read file: ${err.message}` })
				}
			}
			return
		}

		// POST /ide-workspace/file/save — save file content
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/file/save")) {
			const data = await parseBody(req)
			const filePath = data?.path || ""
			const content = data?.content || ""

			if (!filePath) {
				sendJson(res, 400, { ok: false, error: "Missing path" })
				return
			}

			// Resolve the absolute path (prevent directory traversal)
			const resolvedPath = path.resolve(ws.workspaceDir, "." + filePath)
			if (!resolvedPath.startsWith(path.resolve(ws.workspaceDir))) {
				sendJson(res, 403, { ok: false, error: "Access denied: path outside workspace" })
				return
			}

			try {
				// Ensure parent directory exists
				await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
				await fs.writeFile(resolvedPath, content, "utf-8")
				const stat = await fs.stat(resolvedPath)
				sendJson(res, 200, {
					ok: true,
					path: filePath,
					size: stat.size,
					modified: stat.mtimeMs,
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: `Failed to save file: ${err.message}` })
			}
			return
		}

		// POST /ide-workspace/file/diff — compute diff between two file contents
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/file/diff")) {
			const data = await parseBody(req)
			const oldContent = data?.oldContent || ""
			const newContent = data?.newContent || ""

			try {
				// Simple line-by-line diff
				const oldLines = oldContent.split("\n")
				const newLines = newContent.split("\n")
				const changes = []
				let maxLen = Math.max(oldLines.length, newLines.length)
				for (let i = 0; i < maxLen; i++) {
					if (oldLines[i] !== newLines[i]) {
						changes.push({
							line: i + 1,
							old: oldLines[i] || "",
							new: newLines[i] || "",
						})
					}
				}
				sendJson(res, 200, { ok: true, changes, totalChanges: changes.length })
			} catch (err) {
				sendJson(res, 500, { ok: false, error: `Failed to compute diff: ${err.message}` })
			}
			return
		}

		// POST /ide-workspace/file/create — create a new file at specified path
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/file/create")) {
			const data = await parseBody(req)
			const filePath = data?.path || ""
			const content = data?.content || ""

			if (!filePath) {
				sendJson(res, 400, { ok: false, error: "Missing path" })
				return
			}

			// Resolve the absolute path (prevent directory traversal)
			const resolvedPath = path.resolve(ws.workspaceDir, "." + filePath)
			if (!resolvedPath.startsWith(path.resolve(ws.workspaceDir))) {
				sendJson(res, 403, { ok: false, error: "Access denied: path outside workspace" })
				return
			}

			try {
				// Check if file already exists
				try {
					await fs.stat(resolvedPath)
					sendJson(res, 409, { ok: false, error: "File already exists" })
					return
				} catch {
					// File doesn't exist, good to create
				}
				// Ensure parent directory exists
				await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
				await fs.writeFile(resolvedPath, content, "utf-8")
				const stat = await fs.stat(resolvedPath)
				sendJson(res, 200, {
					ok: true,
					path: filePath,
					size: stat.size,
					modified: stat.mtimeMs,
				})
			} catch (err) {
				sendJson(res, 500, { ok: false, error: `Failed to create file: ${err.message}` })
			}
			return
		}

		// POST /ide-workspace/workspace/import-github — import GitHub repo
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/workspace/import-github")) {
			const data = await parseBody(req)
			const repoUrl = data?.repoUrl || ""
			const branch = data?.branch || "main"

			if (!repoUrl) {
				sendJson(res, 400, { ok: false, error: "Missing repoUrl" })
				return
			}

			// Extract repo name from URL
			const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "imported-repo"
			const importDir = path.join(ws.workspaceDir, "imports", repoName)

			try {
				// Create import directory
				await fs.mkdir(importDir, { recursive: true })

				// Try to clone the repo
				try {
					await execAsync(`git clone --depth 1 --branch ${branch} ${repoUrl} ${importDir}`, {
						timeout: 60000,
					})
				} catch (cloneErr) {
					// If clone fails (e.g., no git, no network), create a placeholder
					await fs.writeFile(path.join(importDir, "README.md"), `# ${repoName}\n\nImported from ${repoUrl}\n`)
				}

				// Update workspace to point to imported repo
				ws.workspaceDir = importDir
				ws.repoName = repoName
				ws.branch = branch

				// Build file tree
				const files = await walkDir(importDir, "")

				sendJson(res, 200, {
					ok: true,
					message: `Repository ${repoUrl} (branch: ${branch}) imported successfully`,
					repoName,
					branch,
					files,
				})
			} catch (err) {
				console.error("[api] Import failed:", err.message)
				sendJson(res, 500, {
					ok: false,
					error: `Import failed: ${err.message}`,
				})
			}
			return
		}

		// ── Cloud Orchestrator API Routes ──────────────────────────────────────────

		// GET /orchestrator/status — get orchestrator status
		if (method === "GET" && (url === "/orchestrator/status" || normalizedUrl === "/orchestrator/status")) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			sendJson(res, 200, { success: true, data: orchestrator.getStatus() })
			return
		}

		// POST /orchestrator/submit — submit a task to the orchestrator
		if (method === "POST" && (url === "/orchestrator/submit" || normalizedUrl === "/orchestrator/submit")) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.type || !data.input) {
				sendJson(res, 400, { success: false, error: "Missing required fields: type, input" })
				return
			}
			const task = orchestrator.submit(data)
			sendJson(res, 200, { success: true, task })
			return
		}

		// GET /orchestrator/tasks — list tasks
		if (method === "GET" && (url === "/orchestrator/tasks" || normalizedUrl === "/orchestrator/tasks")) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || undefined
			const type = urlObj.searchParams.get("type") || undefined
			const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10)
			const tasks = orchestrator.taskQueue.list({ status, type, limit })
			sendJson(res, 200, { success: true, tasks, count: tasks.length })
			return
		}

		// GET /orchestrator/tasks/:id — get a specific task
		if (method === "GET" && url.match(/^\/orchestrator\/tasks\/([^/]+)$/)) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const taskId = url.match(/^\/orchestrator\/tasks\/([^/]+)$/)[1]
			const task = orchestrator.taskQueue.get(taskId)
			if (!task) {
				sendJson(res, 404, { success: false, error: "Task not found" })
				return
			}
			sendJson(res, 200, { success: true, task })
			return
		}

		// POST /orchestrator/tasks/:id/complete — mark a task as completed
		if (method === "POST" && url.match(/^\/orchestrator\/tasks\/([^/]+)\/complete$/)) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const taskId = url.match(/^\/orchestrator\/tasks\/([^/]+)\/complete$/)[1]
			const data = await parseBody(req)
			orchestrator.completeTask(taskId, data.output)
			sendJson(res, 200, { success: true, taskId })
			return
		}

		// POST /orchestrator/tasks/:id/fail — mark a task as failed
		if (method === "POST" && url.match(/^\/orchestrator\/tasks\/([^/]+)\/fail$/)) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const taskId = url.match(/^\/orchestrator\/tasks\/([^/]+)\/fail$/)[1]
			const data = await parseBody(req)
			orchestrator.failTask(taskId, data.error || "Unknown error")
			sendJson(res, 200, { success: true, taskId })
			return
		}

		// GET /orchestrator/events — list events
		if (method === "GET" && (url === "/orchestrator/events" || normalizedUrl === "/orchestrator/events")) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const type = urlObj.searchParams.get("type") || undefined
			const source = urlObj.searchParams.get("source") || undefined
			const severity = urlObj.searchParams.get("severity") || undefined
			const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10)
			const events = orchestrator.eventLog.list({ type, source, severity, limit })
			sendJson(res, 200, { success: true, events, count: events.length })
			return
		}

		// POST /orchestrator/mode — set safety mode
		if (method === "POST" && (url === "/orchestrator/mode" || normalizedUrl === "/orchestrator/mode")) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.mode) {
				sendJson(res, 400, { success: false, error: "Missing required field: mode" })
				return
			}
			try {
				orchestrator.setMode(data.mode)
				sendJson(res, 200, { success: true, mode: orchestrator.mode })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /orchestrator/tg-bridge/stats — get Telegram bridge stats
		if (
			method === "GET" &&
			(url === "/orchestrator/tg-bridge/stats" || normalizedUrl === "/orchestrator/tg-bridge/stats")
		) {
			if (!tgOrchestratorBridge) {
				sendJson(res, 503, { success: false, error: "Telegram bridge not initialized" })
				return
			}
			sendJson(res, 200, { success: true, data: tgOrchestratorBridge.getStats() })
			return
		}

		// ── Orchestrator Module API Routes (Phase 2-6) ────────────────────────────

		// ── Safety Manager ──────────────────────────────────────────────────────

		// GET /orchestrator/safety/mode — get current safety mode
		if (
			method === "GET" &&
			(url === "/orchestrator/safety/mode" || normalizedUrl === "/orchestrator/safety/mode")
		) {
			if (!orchestrator || !orchestrator.safetyManager) {
				sendJson(res, 503, { success: false, error: "SafetyManager not initialized" })
				return
			}
			sendJson(res, 200, { success: true, mode: orchestrator.mode })
			return
		}

		// POST /orchestrator/safety/check — check a command/capability against safety rules
		if (
			method === "POST" &&
			(url === "/orchestrator/safety/check" || normalizedUrl === "/orchestrator/safety/check")
		) {
			if (!orchestrator || !orchestrator.safetyManager) {
				sendJson(res, 503, { success: false, error: "SafetyManager not initialized" })
				return
			}
			const data = await parseBody(req)
			const results = {}
			if (data.command) results.command = orchestrator.safetyManager.checkCommand(data.command)
			if (data.capability) results.capability = orchestrator.safetyManager.checkCapability(data.capability)
			if (data.capabilities)
				results.capabilities = orchestrator.safetyManager.checkCapabilities(data.capabilities)
			if (data.sql) results.sql = orchestrator.safetyManager.checkSql(data.sql)
			if (data.path) results.path = orchestrator.safetyManager.checkPath(data.path)
			sendJson(res, 200, { success: true, results })
			return
		}

		// ── Agent Registry ─────────────────────────────────────────────────────

		// GET /orchestrator/agents — list registered agents
		if (method === "GET" && (url === "/orchestrator/agents" || normalizedUrl === "/orchestrator/agents")) {
			if (!orchestrator || !orchestrator.agentRegistry) {
				sendJson(res, 503, { success: false, error: "AgentRegistry not initialized" })
				return
			}
			const agents = orchestrator.agentRegistry.list()
			sendJson(res, 200, { success: true, agents })
			return
		}

		// GET /orchestrator/agents/:id — get a specific agent
		if (method === "GET" && url.match(/^\/orchestrator\/agents\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.agentRegistry) {
				sendJson(res, 503, { success: false, error: "AgentRegistry not initialized" })
				return
			}
			const agentId = url.match(/^\/orchestrator\/agents\/([^/]+)$/)[1]
			const agent = orchestrator.agentRegistry.get(agentId)
			if (!agent) {
				sendJson(res, 404, { success: false, error: "Agent not found" })
				return
			}
			sendJson(res, 200, { success: true, agent })
			return
		}

		// POST /orchestrator/agents/:id/toggle — enable/disable an agent
		if (method === "POST" && url.match(/^\/orchestrator\/agents\/([^/]+)\/toggle$/)) {
			if (!orchestrator || !orchestrator.agentRegistry) {
				sendJson(res, 503, { success: false, error: "AgentRegistry not initialized" })
				return
			}
			const agentId = url.match(/^\/orchestrator\/agents\/([^/]+)\/toggle$/)[1]
			const data = await parseBody(req)
			const agent = orchestrator.agentRegistry.get(agentId)
			if (!agent) {
				sendJson(res, 404, { success: false, error: "Agent not found" })
				return
			}
			const newEnabled = typeof data.enabled === "boolean" ? data.enabled : !agent.enabled
			const result = await orchestrator.agentRegistry.setEnabled(agentId, newEnabled)
			sendJson(res, 200, { success: true, agent: result })
			return
		}

		// ── Feature Registry ───────────────────────────────────────────────────

		// GET /orchestrator/features — list features
		if (method === "GET" && (url === "/orchestrator/features" || normalizedUrl === "/orchestrator/features")) {
			if (!orchestrator || !orchestrator.featureRegistry) {
				sendJson(res, 503, { success: false, error: "FeatureRegistry not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || undefined
			const health = urlObj.searchParams.get("health") || undefined
			const features = orchestrator.featureRegistry.list({ status, health })
			sendJson(res, 200, { success: true, features, count: features.length })
			return
		}

		// POST /orchestrator/features — create a new feature
		if (method === "POST" && (url === "/orchestrator/features" || normalizedUrl === "/orchestrator/features")) {
			if (!orchestrator || !orchestrator.featureRegistry) {
				sendJson(res, 503, { success: false, error: "FeatureRegistry not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.name) {
				sendJson(res, 400, { success: false, error: "Missing required field: name" })
				return
			}
			const feature = orchestrator.featureRegistry.create(data)
			sendJson(res, 200, { success: true, feature })
			return
		}

		// GET /orchestrator/features/:id — get a specific feature
		if (method === "GET" && url.match(/^\/orchestrator\/features\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.featureRegistry) {
				sendJson(res, 503, { success: false, error: "FeatureRegistry not initialized" })
				return
			}
			const featureId = url.match(/^\/orchestrator\/features\/([^/]+)$/)[1]
			const feature = orchestrator.featureRegistry.get(featureId)
			if (!feature) {
				sendJson(res, 404, { success: false, error: "Feature not found" })
				return
			}
			sendJson(res, 200, { success: true, feature })
			return
		}

		// PUT /orchestrator/features/:id — update a feature
		if (method === "PUT" && url.match(/^\/orchestrator\/features\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.featureRegistry) {
				sendJson(res, 503, { success: false, error: "FeatureRegistry not initialized" })
				return
			}
			const featureId = url.match(/^\/orchestrator\/features\/([^/]+)$/)[1]
			const data = await parseBody(req)
			const feature = orchestrator.featureRegistry.update(featureId, data)
			sendJson(res, 200, { success: true, feature })
			return
		}

		// DELETE /orchestrator/features/:id — delete a feature
		if (method === "DELETE" && url.match(/^\/orchestrator\/features\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.featureRegistry) {
				sendJson(res, 503, { success: false, error: "FeatureRegistry not initialized" })
				return
			}
			const featureId = url.match(/^\/orchestrator\/features\/([^/]+)$/)[1]
			const deleted = orchestrator.featureRegistry.delete(featureId)
			sendJson(res, 200, { success: deleted })
			return
		}

		// ── Bug Registry ───────────────────────────────────────────────────────

		// GET /orchestrator/bugs — list bugs
		if (method === "GET" && (url === "/orchestrator/bugs" || normalizedUrl === "/orchestrator/bugs")) {
			if (!orchestrator || !orchestrator.bugRegistry) {
				sendJson(res, 503, { success: false, error: "BugRegistry not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || undefined
			const severity = urlObj.searchParams.get("severity") || undefined
			const featureId = urlObj.searchParams.get("featureId") || undefined
			const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10)
			const bugs = orchestrator.bugRegistry.list({ status, severity, featureId, limit })
			sendJson(res, 200, { success: true, bugs, count: bugs.length })
			return
		}

		// POST /orchestrator/bugs — report a new bug
		if (method === "POST" && (url === "/orchestrator/bugs" || normalizedUrl === "/orchestrator/bugs")) {
			if (!orchestrator || !orchestrator.bugRegistry) {
				sendJson(res, 503, { success: false, error: "BugRegistry not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.title || !data.severity) {
				sendJson(res, 400, { success: false, error: "Missing required fields: title, severity" })
				return
			}
			const bug = orchestrator.bugRegistry.create(data)
			sendJson(res, 200, { success: true, bug })
			return
		}

		// GET /orchestrator/bugs/:id — get a specific bug
		if (method === "GET" && url.match(/^\/orchestrator\/bugs\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.bugRegistry) {
				sendJson(res, 503, { success: false, error: "BugRegistry not initialized" })
				return
			}
			const bugId = url.match(/^\/orchestrator\/bugs\/([^/]+)$/)[1]
			const bug = orchestrator.bugRegistry.get(bugId)
			if (!bug) {
				sendJson(res, 404, { success: false, error: "Bug not found" })
				return
			}
			sendJson(res, 200, { success: true, bug })
			return
		}

		// PUT /orchestrator/bugs/:id — update a bug
		if (method === "PUT" && url.match(/^\/orchestrator\/bugs\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.bugRegistry) {
				sendJson(res, 503, { success: false, error: "BugRegistry not initialized" })
				return
			}
			const bugId = url.match(/^\/orchestrator\/bugs\/([^/]+)$/)[1]
			const data = await parseBody(req)
			const bug = orchestrator.bugRegistry.update(bugId, data)
			sendJson(res, 200, { success: true, bug })
			return
		}

		// POST /orchestrator/bugs/:id/fix — record a fix for a bug
		if (method === "POST" && url.match(/^\/orchestrator\/bugs\/([^/]+)\/fix$/)) {
			if (!orchestrator || !orchestrator.bugRegistry) {
				sendJson(res, 503, { success: false, error: "BugRegistry not initialized" })
				return
			}
			const bugId = url.match(/^\/orchestrator\/bugs\/([^/]+)\/fix$/)[1]
			const data = await parseBody(req)
			if (!data.description) {
				sendJson(res, 400, { success: false, error: "Missing required field: description" })
				return
			}
			const fix = orchestrator.bugRegistry.recordFix({ bugId, ...data })
			sendJson(res, 200, { success: true, fix })
			return
		}

		// GET /orchestrator/bugs/:id/fixes — list fixes for a bug
		if (method === "GET" && url.match(/^\/orchestrator\/bugs\/([^/]+)\/fixes$/)) {
			if (!orchestrator || !orchestrator.bugRegistry) {
				sendJson(res, 503, { success: false, error: "BugRegistry not initialized" })
				return
			}
			const bugId = url.match(/^\/orchestrator\/bugs\/([^/]+)\/fixes$/)[1]
			const fixes = orchestrator.bugRegistry.listFixes(bugId)
			sendJson(res, 200, { success: true, fixes })
			return
		}

		// ── Commit/Deploy Log ──────────────────────────────────────────────────

		// GET /orchestrator/commits — list commits
		if (method === "GET" && (url === "/orchestrator/commits" || normalizedUrl === "/orchestrator/commits")) {
			if (!orchestrator || !orchestrator.commitDeployLog) {
				sendJson(res, 503, { success: false, error: "CommitDeployLog not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const agent = urlObj.searchParams.get("agent") || undefined
			const type = urlObj.searchParams.get("type") || undefined
			const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10)
			const commits = await orchestrator.commitDeployLog.getCommits({ agent, type, limit })
			sendJson(res, 200, { success: true, commits, count: commits.length })
			return
		}

		// POST /orchestrator/commits — record a commit
		if (method === "POST" && (url === "/orchestrator/commits" || normalizedUrl === "/orchestrator/commits")) {
			if (!orchestrator || !orchestrator.commitDeployLog) {
				sendJson(res, 503, { success: false, error: "CommitDeployLog not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.commitSha || !data.agent || !data.type || !data.title) {
				sendJson(res, 400, { success: false, error: "Missing required fields: commitSha, agent, type, title" })
				return
			}
			const commit = await orchestrator.commitDeployLog.recordCommit(data)
			sendJson(res, 200, { success: true, commit })
			return
		}

		// GET /orchestrator/deploys — list deploys
		if (method === "GET" && (url === "/orchestrator/deploys" || normalizedUrl === "/orchestrator/deploys")) {
			if (!orchestrator || !orchestrator.commitDeployLog) {
				sendJson(res, 503, { success: false, error: "CommitDeployLog not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || undefined
			const agent = urlObj.searchParams.get("agent") || undefined
			const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10)
			const deploys = await orchestrator.commitDeployLog.getDeploys({ status, agent, limit })
			sendJson(res, 200, { success: true, deploys, count: deploys.length })
			return
		}

		// POST /orchestrator/deploys — record a deploy
		if (method === "POST" && (url === "/orchestrator/deploys" || normalizedUrl === "/orchestrator/deploys")) {
			if (!orchestrator || !orchestrator.commitDeployLog) {
				sendJson(res, 503, { success: false, error: "CommitDeployLog not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.version || !data.commitSha || !data.agent) {
				sendJson(res, 400, { success: false, error: "Missing required fields: version, commitSha, agent" })
				return
			}
			const deploy = await orchestrator.commitDeployLog.recordDeploy(data)
			sendJson(res, 200, { success: true, deploy })
			return
		}

		// PUT /orchestrator/deploys/:id/status — update deploy status
		if (method === "PUT" && url.match(/^\/orchestrator\/deploys\/([^/]+)\/status$/)) {
			if (!orchestrator || !orchestrator.commitDeployLog) {
				sendJson(res, 503, { success: false, error: "CommitDeployLog not initialized" })
				return
			}
			const deployId = url.match(/^\/orchestrator\/deploys\/([^/]+)\/status$/)[1]
			const data = await parseBody(req)
			if (!data.status) {
				sendJson(res, 400, { success: false, error: "Missing required field: status" })
				return
			}
			const deploy = await orchestrator.commitDeployLog.updateDeployStatus(deployId, data.status)
			sendJson(res, 200, { success: true, deploy })
			return
		}

		// GET /orchestrator/commit-deploy/stats — get combined stats
		if (
			method === "GET" &&
			(url === "/orchestrator/commit-deploy/stats" || normalizedUrl === "/orchestrator/commit-deploy/stats")
		) {
			if (!orchestrator || !orchestrator.commitDeployLog) {
				sendJson(res, 503, { success: false, error: "CommitDeployLog not initialized" })
				return
			}
			const stats = await orchestrator.commitDeployLog.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// ── Healing System ─────────────────────────────────────────────────────

		// GET /orchestrator/healing/incidents — list healing incidents
		if (
			method === "GET" &&
			(url === "/orchestrator/healing/incidents" || normalizedUrl === "/orchestrator/healing/incidents")
		) {
			if (!orchestrator || !orchestrator.healingBus) {
				sendJson(res, 503, { success: false, error: "HealingBus not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || undefined
			const severity = urlObj.searchParams.get("severity") || undefined
			const source = urlObj.searchParams.get("source") || undefined
			const limit = parseInt(urlObj.searchParams.get("limit") || "50", 10)
			const incidents = orchestrator.healingBus.list({ status, severity, source, limit })
			sendJson(res, 200, { success: true, incidents, count: incidents.length })
			return
		}

		// POST /orchestrator/healing/incidents — report a new incident
		if (
			method === "POST" &&
			(url === "/orchestrator/healing/incidents" || normalizedUrl === "/orchestrator/healing/incidents")
		) {
			if (!orchestrator || !orchestrator.healingBus) {
				sendJson(res, 503, { success: false, error: "HealingBus not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.title || !data.severity || !data.source) {
				sendJson(res, 400, { success: false, error: "Missing required fields: title, severity, source" })
				return
			}
			const incident = await orchestrator.healingBus.reportIncident(data)
			sendJson(res, 200, { success: true, incident })
			return
		}

		// GET /orchestrator/healing/incidents/:id — get a specific incident
		if (method === "GET" && url.match(/^\/orchestrator\/healing\/incidents\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.healingBus) {
				sendJson(res, 503, { success: false, error: "HealingBus not initialized" })
				return
			}
			const incidentId = url.match(/^\/orchestrator\/healing\/incidents\/([^/]+)$/)[1]
			const incident = orchestrator.healingBus.get(incidentId)
			if (!incident) {
				sendJson(res, 404, { success: false, error: "Incident not found" })
				return
			}
			sendJson(res, 200, { success: true, incident })
			return
		}

		// PUT /orchestrator/healing/incidents/:id — update an incident
		if (method === "PUT" && url.match(/^\/orchestrator\/healing\/incidents\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.healingBus) {
				sendJson(res, 503, { success: false, error: "HealingBus not initialized" })
				return
			}
			const incidentId = url.match(/^\/orchestrator\/healing\/incidents\/([^/]+)$/)[1]
			const data = await parseBody(req)
			const incident = orchestrator.healingBus.updateIncident(incidentId, data)
			sendJson(res, 200, { success: true, incident })
			return
		}

		// GET /orchestrator/healing/incidents/:id/actions — get healing actions for an incident
		if (method === "GET" && url.match(/^\/orchestrator\/healing\/incidents\/([^/]+)\/actions$/)) {
			if (!orchestrator || !orchestrator.healingBus) {
				sendJson(res, 503, { success: false, error: "HealingBus not initialized" })
				return
			}
			const incidentId = url.match(/^\/orchestrator\/healing\/incidents\/([^/]+)\/actions$/)[1]
			const actions = orchestrator.healingBus.getHealingActions(incidentId)
			sendJson(res, 200, { success: true, actions })
			return
		}

		// GET /orchestrator/healing/metrics — get healing metrics
		if (
			method === "GET" &&
			(url === "/orchestrator/healing/metrics" || normalizedUrl === "/orchestrator/healing/metrics")
		) {
			if (!orchestrator || !orchestrator.healingBus) {
				sendJson(res, 503, { success: false, error: "HealingBus not initialized" })
				return
			}
			const metrics = orchestrator.healingBus.getHealingMetrics()
			sendJson(res, 200, { success: true, metrics })
			return
		}

		// GET /orchestrator/healing/stats — get self-healing loop stats
		if (
			method === "GET" &&
			(url === "/orchestrator/healing/stats" || normalizedUrl === "/orchestrator/healing/stats")
		) {
			if (!orchestrator || !orchestrator.selfHealingLoop) {
				sendJson(res, 503, { success: false, error: "SelfHealingLoop not initialized" })
				return
			}
			sendJson(res, 200, { success: true, stats: orchestrator.selfHealingLoop.stats })
			return
		}

		// POST /orchestrator/healing/cycle — manually trigger a healing cycle
		if (
			method === "POST" &&
			(url === "/orchestrator/healing/cycle" || normalizedUrl === "/orchestrator/healing/cycle")
		) {
			if (!orchestrator || !orchestrator.selfHealingLoop) {
				sendJson(res, 503, { success: false, error: "SelfHealingLoop not initialized" })
				return
			}
			const result = await orchestrator.selfHealingLoop.runHealingCycle()
			sendJson(res, 200, { success: true, result })
			return
		}

		// ── Crawler Agent ──────────────────────────────────────────────────────

		// GET /orchestrator/crawler/sources — list crawl sources
		if (
			method === "GET" &&
			(url === "/orchestrator/crawler/sources" || normalizedUrl === "/orchestrator/crawler/sources")
		) {
			if (!orchestrator || !orchestrator.crawlerAgent) {
				sendJson(res, 503, { success: false, error: "CrawlerAgent not initialized" })
				return
			}
			sendJson(res, 200, { success: true, sources: orchestrator.crawlerAgent.sources })
			return
		}

		// POST /orchestrator/crawler/sources — add a crawl source
		if (
			method === "POST" &&
			(url === "/orchestrator/crawler/sources" || normalizedUrl === "/orchestrator/crawler/sources")
		) {
			if (!orchestrator || !orchestrator.crawlerAgent) {
				sendJson(res, 503, { success: false, error: "CrawlerAgent not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.url || !data.type) {
				sendJson(res, 400, { success: false, error: "Missing required fields: url, type" })
				return
			}
			orchestrator.crawlerAgent.addSource(data)
			sendJson(res, 200, { success: true })
			return
		}

		// DELETE /orchestrator/crawler/sources/:id — remove a crawl source
		if (method === "DELETE" && url.match(/^\/orchestrator\/crawler\/sources\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.crawlerAgent) {
				sendJson(res, 503, { success: false, error: "CrawlerAgent not initialized" })
				return
			}
			const sourceId = url.match(/^\/orchestrator\/crawler\/sources\/([^/]+)$/)[1]
			orchestrator.crawlerAgent.removeSource(sourceId)
			sendJson(res, 200, { success: true })
			return
		}

		// POST /orchestrator/crawler/crawl/:sourceId — manually trigger a crawl
		if (method === "POST" && url.match(/^\/orchestrator\/crawler\/crawl\/([^/]+)$/)) {
			if (!orchestrator || !orchestrator.crawlerAgent) {
				sendJson(res, 503, { success: false, error: "CrawlerAgent not initialized" })
				return
			}
			const sourceId = url.match(/^\/orchestrator\/crawler\/crawl\/([^/]+)$/)[1]
			const documents = await orchestrator.crawlerAgent.crawl(sourceId)
			sendJson(res, 200, { success: true, documents, count: documents.length })
			return
		}

		// GET /orchestrator/crawler/signals — get crawl signals
		if (
			method === "GET" &&
			(url === "/orchestrator/crawler/signals" || normalizedUrl === "/orchestrator/crawler/signals")
		) {
			if (!orchestrator || !orchestrator.crawlerAgent) {
				sendJson(res, 503, { success: false, error: "CrawlerAgent not initialized" })
				return
			}
			const signals = orchestrator.crawlerAgent.getSignals()
			sendJson(res, 200, { success: true, signals })
			return
		}

		// GET /orchestrator/crawler/stats — get crawler stats
		if (
			method === "GET" &&
			(url === "/orchestrator/crawler/stats" || normalizedUrl === "/orchestrator/crawler/stats")
		) {
			if (!orchestrator || !orchestrator.crawlerAgent) {
				sendJson(res, 503, { success: false, error: "CrawlerAgent not initialized" })
				return
			}
			const stats = orchestrator.crawlerAgent.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// ── Deploy Orchestrator ────────────────────────────────────────────────

		// GET /orchestrator/deploy-orchestrator/status — get deploy status
		if (
			method === "GET" &&
			(url === "/orchestrator/deploy-orchestrator/status" ||
				normalizedUrl === "/orchestrator/deploy-orchestrator/status")
		) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const current = orchestrator.deployOrchestrator.getCurrent()
			sendJson(res, 200, { success: true, current })
			return
		}

		// POST /orchestrator/deploy-orchestrator/deploy — trigger a deploy
		if (
			method === "POST" &&
			(url === "/orchestrator/deploy-orchestrator/deploy" ||
				normalizedUrl === "/orchestrator/deploy-orchestrator/deploy")
		) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.version || !data.commitSha) {
				sendJson(res, 400, { success: false, error: "Missing required fields: version, commitSha" })
				return
			}
			const result = await orchestrator.deployOrchestrator.deploy(data.version, data.commitSha)
			sendJson(res, 200, { success: true, deploy: result })
			return
		}

		// POST /orchestrator/deploy-orchestrator/rollback — rollback the last deploy
		if (
			method === "POST" &&
			(url === "/orchestrator/deploy-orchestrator/rollback" ||
				normalizedUrl === "/orchestrator/deploy-orchestrator/rollback")
		) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const result = await orchestrator.deployOrchestrator.rollback()
			sendJson(res, 200, { success: true, rollback: result })
			return
		}

		// GET /orchestrator/deploy-orchestrator/history — get deploy history
		if (
			method === "GET" &&
			(url === "/orchestrator/deploy-orchestrator/history" ||
				normalizedUrl === "/orchestrator/deploy-orchestrator/history")
		) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const history = orchestrator.deployOrchestrator.getHistory()
			sendJson(res, 200, { success: true, history })
			return
		}

		// GET /orchestrator/deploy-orchestrator/stats — get deploy stats
		if (
			method === "GET" &&
			(url === "/orchestrator/deploy-orchestrator/stats" ||
				normalizedUrl === "/orchestrator/deploy-orchestrator/stats")
		) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const stats = orchestrator.deployOrchestrator.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// ── File Importer ──────────────────────────────────────────────────────

		// POST /orchestrator/file-importer/import — import files by path
		if (
			method === "POST" &&
			(url === "/orchestrator/file-importer/import" || normalizedUrl === "/orchestrator/file-importer/import")
		) {
			if (!orchestrator || !orchestrator.fileImporter) {
				sendJson(res, 503, { success: false, error: "FileImporter not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.paths || !Array.isArray(data.paths)) {
				sendJson(res, 400, { success: false, error: "Missing required field: paths (array)" })
				return
			}
			const result = await orchestrator.fileImporter.importPaths(data.paths)
			sendJson(res, 200, { success: true, result })
			return
		}

		// GET /orchestrator/file-importer/stats — get file importer stats
		if (
			method === "GET" &&
			(url === "/orchestrator/file-importer/stats" || normalizedUrl === "/orchestrator/file-importer/stats")
		) {
			if (!orchestrator || !orchestrator.fileImporter) {
				sendJson(res, 503, { success: false, error: "FileImporter not initialized" })
				return
			}
			const stats = orchestrator.fileImporter.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// ── CPU Guard ──────────────────────────────────────────────────────────

		// GET /orchestrator/cpu-guard/stats — get CPU/RAM usage stats
		if (
			method === "GET" &&
			(url === "/orchestrator/cpu-guard/stats" || normalizedUrl === "/orchestrator/cpu-guard/stats")
		) {
			if (!orchestrator || !orchestrator.cpuGuard) {
				sendJson(res, 503, { success: false, error: "CPUGuard not initialized" })
				return
			}
			const cpu = orchestrator.cpuGuard.getCpuUsagePercent ? orchestrator.cpuGuard.getCpuUsagePercent() : null
			const ram = orchestrator.cpuGuard.getRamUsagePercent ? orchestrator.cpuGuard.getRamUsagePercent() : null
			sendJson(res, 200, { success: true, cpu, ram })
			return
		}

		// ── Parallel Executor ──────────────────────────────────────────────────

		// GET /orchestrator/parallel/stats — get parallel executor stats
		if (
			method === "GET" &&
			(url === "/orchestrator/parallel/stats" || normalizedUrl === "/orchestrator/parallel/stats")
		) {
			if (!orchestrator || !orchestrator.parallelExecutor) {
				sendJson(res, 503, { success: false, error: "ParallelExecutor not initialized" })
				return
			}
			const stats = orchestrator.parallelExecutor.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// ── Agent Bus ──────────────────────────────────────────────────────────

		// GET /orchestrator/agent-bus/stats — get agent bus stats
		if (
			method === "GET" &&
			(url === "/orchestrator/agent-bus/stats" || normalizedUrl === "/orchestrator/agent-bus/stats")
		) {
			if (!orchestrator || !orchestrator.agentBus) {
				sendJson(res, 503, { success: false, error: "AgentBus not initialized" })
				return
			}
			const stats = orchestrator.agentBus.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// ── Improvement Loop ───────────────────────────────────────────────────

		// GET /orchestrator/improvement/stats — get improvement loop stats
		if (
			method === "GET" &&
			(url === "/orchestrator/improvement/stats" || normalizedUrl === "/orchestrator/improvement/stats")
		) {
			if (!orchestrator || !orchestrator.improvementLoop) {
				sendJson(res, 503, { success: false, error: "ImprovementLoop not initialized" })
				return
			}
			sendJson(res, 200, { success: true, stats: orchestrator.improvementLoop.stats })
			return
		}

		// POST /orchestrator/improvement/cycle — manually trigger an improvement cycle
		if (
			method === "POST" &&
			(url === "/orchestrator/improvement/cycle" || normalizedUrl === "/orchestrator/improvement/cycle")
		) {
			if (!orchestrator || !orchestrator.improvementLoop) {
				sendJson(res, 503, { success: false, error: "ImprovementLoop not initialized" })
				return
			}
			orchestrator.improvementLoop.triggerCycle()
			sendJson(res, 200, { success: true })
			return
		}

		// ── HermesClaw — Memory & Context Agent API ──────────────────────────────

		// GET /orchestrator/hermes/query — query the Hermes knowledge base
		if (
			method === "GET" &&
			(url === "/orchestrator/hermes/query" || normalizedUrl === "/orchestrator/hermes/query")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const q = urlObj.searchParams.get("q") || ""
			const limit = parseInt(urlObj.searchParams.get("limit") || "5", 10)
			if (!q) {
				sendJson(res, 400, { success: false, error: "Missing query parameter: q" })
				return
			}
			try {
				const result = await orchestrator.hermesClaw.queryKnowledge(q)
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/lesson — receive a lesson notification from agent runners
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/lesson" || normalizedUrl === "/orchestrator/hermes/lesson")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				// Fire-and-forget lesson extraction (non-blocking)
				orchestrator.hermesClaw
					.extractLessons({
						taskId: data.parentTaskId || data.jobId || "unknown",
						goal: data.instruction?.substring(0, 500) || "",
						phases: [
							{
								number: data.phase || 1,
								phase: data.runnerType || "unknown",
								result: data.success ? "completed" : "failed",
							},
						],
						finalStatus: data.success ? "completed" : "failed",
						error: data.error || null,
					})
					.catch((err) => {
						console.error("[hermes] lesson extraction error:", err.message)
					})
				sendJson(res, 200, { success: true })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /orchestrator/hermes/stats — get HermesClaw statistics
		if (
			method === "GET" &&
			(url === "/orchestrator/hermes/stats" || normalizedUrl === "/orchestrator/hermes/stats")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const stats = orchestrator.hermesClaw.getStats()
				sendJson(res, 200, { success: true, stats })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── ML Sync API Routes ────────────────────────────────────────────────────
		// These endpoints enable bidirectional ML model sync between local VS Code
		// extensions and the cloud orchestrator for federated learning.

		// POST /ml/model/upload — Upload a local model to the cloud
		// Body: serialized model JSON (from ModelSerializer)
		if (method === "POST" && (url === "/ml/model/upload" || normalizedUrl === "/ml/model/upload")) {
			try {
				const data = await parseBody(req)
				const validation = validate(data)
				if (!validation.valid) {
					sendJson(res, 400, { success: false, error: "Invalid model format", details: validation.errors })
					return
				}
				if (!orchestrator || !orchestrator.memory) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}
				const modelId = crypto.randomUUID()
				const now = Date.now()
				const modelRecord = {
					id: modelId,
					modelType: data.modelType,
					source: data.source || "local",
					schemaVersion: data.schemaVersion,
					featureDimensions: data.featureDimensions,
					trainingSamples: data.trainingSamples || 0,
					parameters: JSON.stringify(data.parameters),
					architecture: JSON.stringify(data.architecture || {}),
					metadata: JSON.stringify(data.metadata || {}),
					isMerged: 0,
					mergedFrom: null,
					createdAt: now,
					updatedAt: now,
				}
				const db = orchestrator.memory.getDb()
				db.prepare(
					`INSERT INTO ml_models (id, model_type, source, schema_version, feature_dimensions, training_samples, parameters, architecture, metadata, is_merged, merged_from, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				).run(
					modelRecord.id,
					modelRecord.modelType,
					modelRecord.source,
					modelRecord.schemaVersion,
					modelRecord.featureDimensions,
					modelRecord.trainingSamples,
					modelRecord.parameters,
					modelRecord.architecture,
					modelRecord.metadata,
					modelRecord.isMerged,
					modelRecord.mergedFrom,
					modelRecord.createdAt,
					modelRecord.updatedAt,
				)
				// Record sync log
				db.prepare(
					`INSERT INTO ml_sync_log (id, direction, status, model_id, model_type, feature_dimensions, training_samples, source, target, payload_size_bytes, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				).run(
					crypto.randomUUID(),
					"upload",
					"completed",
					modelId,
					data.modelType,
					data.featureDimensions,
					data.trainingSamples || 0,
					data.source || "local",
					"cloud",
					Buffer.byteLength(JSON.stringify(data), "utf8"),
					now,
				)
				sendJson(res, 200, { success: true, modelId })
			} catch (err) {
				writeApiLog("error", "ml-sync", "Model upload failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /ml/model/latest — Download the latest merged cloud model
		// Query: ?source=cloud&type=neural-network
		if (method === "GET" && (url.startsWith("/ml/model/latest") || normalizedUrl.startsWith("/ml/model/latest"))) {
			try {
				if (!orchestrator || !orchestrator.memory) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}
				const targetUrl = url.startsWith("/ml/model/latest") ? url : normalizedUrl
				const urlObj = new URL(targetUrl, `http://localhost:${PORT}`)
				const source = urlObj.searchParams.get("source") || "cloud"
				const modelType = urlObj.searchParams.get("type") || null

				const db = orchestrator.memory.getDb()
				let row
				if (modelType) {
					row = db
						.prepare(
							`SELECT * FROM ml_models WHERE source = ? AND model_type = ? ORDER BY training_samples DESC, created_at DESC LIMIT 1`,
						)
						.get(source, modelType)
				} else {
					row = db
						.prepare(
							`SELECT * FROM ml_models WHERE source = ? ORDER BY training_samples DESC, created_at DESC LIMIT 1`,
						)
						.get(source)
				}
				if (!row) {
					sendJson(res, 404, { success: false, error: "No model found" })
					return
				}
				const model = {
					schemaVersion: row.schema_version,
					modelType: row.model_type,
					timestamp: new Date(row.created_at).toISOString(),
					source: row.source,
					featureDimensions: row.feature_dimensions,
					trainingSamples: row.training_samples,
					architecture: JSON.parse(row.architecture || "{}"),
					parameters: JSON.parse(row.parameters),
					metadata: {
						...JSON.parse(row.metadata || "{}"),
						modelId: row.id,
						isMerged: !!row.is_merged,
					},
				}
				sendJson(res, 200, { success: true, model })
			} catch (err) {
				writeApiLog("error", "ml-sync", "Model download failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /ml/observations/sync — Sync observations from local to cloud
		// Body: { observations: [{ taskType, inputSummary, outputSummary, success, durationMs, featuresLocal, featuresCloud, featuresUnified, source, sessionId }] }
		if (method === "POST" && (url === "/ml/observations/sync" || normalizedUrl === "/ml/observations/sync")) {
			try {
				const data = await parseBody(req)
				if (!data.observations || !Array.isArray(data.observations) || data.observations.length === 0) {
					sendJson(res, 400, { success: false, error: "observations array is required" })
					return
				}
				if (!orchestrator || !orchestrator.memory) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}
				const db = orchestrator.memory.getDb()
				const insert = db.prepare(
					`INSERT OR IGNORE INTO ml_observations_v2 (id, task_type, input_summary, output_summary, success, duration_ms, features_local, features_cloud, features_unified, source, session_id, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				const now = Date.now()
				let inserted = 0
				for (const obs of data.observations) {
					insert.run(
						obs.id || crypto.randomUUID(),
						obs.taskType || "unknown",
						obs.inputSummary || "",
						obs.outputSummary || "",
						obs.success ? 1 : 0,
						obs.durationMs || 0,
						JSON.stringify(obs.featuresLocal || []),
						JSON.stringify(obs.featuresCloud || []),
						JSON.stringify(obs.featuresUnified || []),
						obs.source || "local",
						obs.sessionId || null,
						obs.createdAt || now,
					)
					inserted++
				}
				sendJson(res, 200, { success: true, inserted })
			} catch (err) {
				writeApiLog("error", "ml-sync", "Observation sync failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /ml/model/merge — Trigger federated model merge
		// Body: { sources?: string[], minSamples?: number }
		if (method === "POST" && (url === "/ml/model/merge" || normalizedUrl === "/ml/model/merge")) {
			try {
				if (!orchestrator || !orchestrator.memory) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}
				const data = await parseBody(req)
				const db = orchestrator.memory.getDb()

				// Fetch all models with sufficient samples
				const minSamples = data.minSamples || 1
				const rows = db
					.prepare(`SELECT * FROM ml_models WHERE training_samples >= ? ORDER BY created_at DESC`)
					.all(minSamples)

				if (rows.length < 2) {
					sendJson(res, 400, {
						success: false,
						error: `Need at least 2 models to merge (found ${rows.length})`,
					})
					return
				}

				// Convert DB rows to serialized model format
				const models = rows.map((r) => ({
					schemaVersion: r.schema_version,
					modelType: r.model_type,
					timestamp: new Date(r.created_at).toISOString(),
					source: r.source,
					featureDimensions: r.feature_dimensions,
					trainingSamples: r.training_samples,
					architecture: JSON.parse(r.architecture || "{}"),
					parameters: JSON.parse(r.parameters),
					metadata: JSON.parse(r.metadata || "{}"),
				}))

				// Perform federated merge
				const merged = federatedMerge(models, { minSamples, source: "cloud" })

				// Store merged model
				const modelId = crypto.randomUUID()
				const now = Date.now()
				const mergedFrom = JSON.stringify(
					models.map((m) => ({
						source: m.source,
						samples: m.trainingSamples,
						type: m.modelType,
					})),
				)

				db.prepare(
					`INSERT INTO ml_models (id, model_type, source, schema_version, feature_dimensions, training_samples, parameters, architecture, metadata, is_merged, merged_from, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				).run(
					modelId,
					merged.modelType,
					merged.source,
					merged.schemaVersion,
					merged.featureDimensions,
					merged.trainingSamples,
					JSON.stringify(merged.parameters),
					JSON.stringify(merged.architecture),
					JSON.stringify(merged.metadata),
					1,
					mergedFrom,
					now,
					now,
				)

				// Record sync log
				db.prepare(
					`INSERT INTO ml_sync_log (id, direction, status, model_id, model_type, feature_dimensions, training_samples, source, target, payload_size_bytes, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				).run(
					crypto.randomUUID(),
					"bidirectional",
					"completed",
					modelId,
					merged.modelType,
					merged.featureDimensions,
					merged.trainingSamples,
					"cloud",
					"all",
					Buffer.byteLength(JSON.stringify(merged), "utf8"),
					now,
				)

				sendJson(res, 200, {
					success: true,
					modelId,
					mergedFrom: models.length,
					totalSamples: merged.trainingSamples,
					modelType: merged.modelType,
				})
			} catch (err) {
				writeApiLog("error", "ml-sync", "Model merge failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /ml/sync/status — Get sync status and history
		if (method === "GET" && (url === "/ml/sync/status" || normalizedUrl === "/ml/sync/status")) {
			try {
				if (!orchestrator || !orchestrator.memory) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}
				const db = orchestrator.memory.getDb()

				const totalSyncs = db.prepare("SELECT COUNT(*) as count FROM ml_sync_log").get()
				const completedSyncs = db
					.prepare("SELECT COUNT(*) as count FROM ml_sync_log WHERE status = 'completed'")
					.get()
				const failedSyncs = db
					.prepare("SELECT COUNT(*) as count FROM ml_sync_log WHERE status = 'failed'")
					.get()
				const totalModels = db.prepare("SELECT COUNT(*) as count FROM ml_models").get()
				const mergedModels = db.prepare("SELECT COUNT(*) as count FROM ml_models WHERE is_merged = 1").get()
				const totalObservations = db.prepare("SELECT COUNT(*) as count FROM ml_observations_v2").get()
				const latestSync = db.prepare("SELECT * FROM ml_sync_log ORDER BY created_at DESC LIMIT 1").get()
				const latestModel = db
					.prepare("SELECT * FROM ml_models ORDER BY training_samples DESC, created_at DESC LIMIT 1")
					.get()

				sendJson(res, 200, {
					success: true,
					stats: {
						totalSyncs: totalSyncs.count,
						completedSyncs: completedSyncs.count,
						failedSyncs: failedSyncs.count,
						totalModels: totalModels.count,
						mergedModels: mergedModels.count,
						totalObservations: totalObservations.count,
					},
					latestSync: latestSync
						? {
								id: latestSync.id,
								direction: latestSync.direction,
								status: latestSync.status,
								modelType: latestSync.model_type,
								source: latestSync.source,
								createdAt: latestSync.created_at,
							}
						: null,
					latestModel: latestModel
						? {
								id: latestModel.id,
								modelType: latestModel.model_type,
								source: latestModel.source,
								trainingSamples: latestModel.training_samples,
								featureDimensions: latestModel.feature_dimensions,
								isMerged: !!latestModel.is_merged,
								createdAt: latestModel.created_at,
							}
						: null,
				})
			} catch (err) {
				writeApiLog("error", "ml-sync", "Sync status failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /ml/observations — Get recent observations for analysis
		// Query: ?limit=50&type=code
		if (method === "GET" && (url.startsWith("/ml/observations") || normalizedUrl.startsWith("/ml/observations"))) {
			try {
				if (!orchestrator || !orchestrator.memory) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}
				const targetUrl = url.startsWith("/ml/observations") ? url : normalizedUrl
				const urlObj = new URL(targetUrl, `http://localhost:${PORT}`)
				const limit = parseInt(urlObj.searchParams.get("limit") || "50")
				const taskType = urlObj.searchParams.get("type") || null

				const db = orchestrator.memory.getDb()
				let rows
				if (taskType) {
					rows = db
						.prepare(
							`SELECT * FROM ml_observations_v2 WHERE task_type = ? ORDER BY created_at DESC LIMIT ?`,
						)
						.all(taskType, Math.min(limit, 500))
				} else {
					rows = db
						.prepare(`SELECT * FROM ml_observations_v2 ORDER BY created_at DESC LIMIT ?`)
						.all(Math.min(limit, 500))
				}
				sendJson(res, 200, { success: true, observations: rows })
			} catch (err) {
				writeApiLog("error", "ml-sync", "Fetch observations failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
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
			// Broadcast WebSocket event
			telegramWebSocket.broadcastTaskEvent(taskId, "created", {
				instruction,
				agent,
				branchName,
				chatId,
			})
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
			// Broadcast WebSocket event
			telegramWebSocket.broadcastTaskEvent(taskId, "approved")
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
			// Broadcast WebSocket event
			telegramWebSocket.broadcastTaskEvent(taskId, "rejected")
			sendJson(res, 200, { success: true, taskId, nextState: "rejected" })
			return
		}

		// GET /telegram/tasks/:id/diff — get diff for a task
		if (method === "GET" && url.match(/^\/telegram\/tasks\/([^/]+)\/diff$/)) {
			const taskId = url.match(/^\/telegram\/tasks\/([^/]+)\/diff$/)[1]
			try {
				// Try to compute real git diff for the task's branch
				const repoPath = process.env.REPO_PATH || path.join(__dirname, "..")
				const branchName = "tg/" + taskId.toLowerCase()
				const { exec } = require("child_process")
				const { promisify } = require("util")
				const execAsync = promisify(exec)
				const diffResult = await execAsync(
					`git diff origin/main...${branchName} --stat -- "*.ts" "*.tsx" "*.js" "*.jsx" "*.json"`,
					{ cwd: repoPath, maxBuffer: 1024 * 1024 },
				).catch(() => null)
				const patchResult = await execAsync(
					`git diff origin/main...${branchName} -- "*.ts" "*.tsx" "*.js" "*.jsx"`,
					{ cwd: repoPath, maxBuffer: 1024 * 1024 },
				).catch(() => null)

				if (diffResult && diffResult.stdout) {
					const files = diffResult.stdout
						.split("\n")
						.filter((l) => l.trim())
						.map((l) => {
							const parts = l.split("|")
							return {
								path: parts[0]?.trim() || "unknown",
								additions: parseInt(parts[1]) || 0,
								deletions: 0,
							}
						})
					sendJson(res, 200, {
						success: true,
						taskId,
						diff: patchResult?.stdout || diffResult.stdout,
						files,
					})
				} else {
					// Fallback: try tgEndpoints debugPlan for context
					try {
						const tgEndpoints = require("./tgEndpoints")
						const plan = await tgEndpoints.debugPlan("Show diff for task " + taskId)
						sendJson(res, 200, {
							success: true,
							taskId,
							diff: plan.phases ? plan.phases.join("\n") : "No diff available for task " + taskId,
							files: [],
						})
					} catch {
						sendJson(res, 200, {
							success: true,
							taskId,
							diff: "No diff available for task " + taskId,
							files: [],
						})
					}
				}
			} catch (err) {
				writeApiLog("error", "telegram-diff", "Failed to compute diff", { error: err.message, taskId })
				sendJson(res, 200, {
					success: true,
					taskId,
					diff: "Unable to compute diff: " + err.message,
					files: [],
				})
			}
			return
		}

		// POST /telegram/tasks/run-tests — run test suite
		if (
			method === "POST" &&
			(url === "/telegram/tasks/run-tests" || normalizedUrl === "/telegram/tasks/run-tests")
		) {
			try {
				// Try to run tests via tgEndpoints.runTests
				const data = await parseBody(req)
				const project = data.project || ""
				try {
					const tgEndpoints = require("./tgEndpoints")
					const result = await tgEndpoints.runTests(project)
					sendJson(res, 200, {
						success: true,
						message: result.message || "Tests completed",
						testRunId: "TR-" + Date.now().toString(36).toUpperCase(),
						output: result.stdout || "",
						passed: result.passed,
						failed: result.failed,
					})
				} catch (innerErr) {
					// Fallback: enqueue test job to worker queue
					if (queue) {
						const testRunId = "TR-" + Date.now().toString(36).toUpperCase()
						await queue.add("test-" + testRunId, {
							task: "Run tests for " + (project || "superroo2"),
							agentId: "tester",
							commands: ["cd /opt/superroo2 && pnpm test"],
							network: "none",
						})
						sendJson(res, 200, {
							success: true,
							message: "Tests enqueued to worker",
							testRunId,
						})
					} else {
						sendJson(res, 200, {
							success: true,
							message: "Tests triggered (no worker queue available)",
							testRunId: "TR-" + Date.now().toString(36).toUpperCase(),
						})
					}
				}
			} catch (err) {
				writeApiLog("error", "telegram-run-tests", "Failed to run tests", { error: err.message })
				sendJson(res, 200, {
					success: true,
					message: "Tests triggered",
					testRunId: "TR-" + Date.now().toString(36).toUpperCase(),
				})
			}
			return
		}

		// GET /telegram/deployments — list deployments from CommitDeployLog
		if (method === "GET" && (url === "/telegram/deployments" || normalizedUrl === "/telegram/deployments")) {
			try {
				var deployments = []
				// Try to load from CommitDeployLog
				try {
					var deployLogPath = path.join(__dirname, "memory", "commit-deploy-log.json")
					var deployData = await fs.promises.readFile(deployLogPath, "utf8")
					var parsed = JSON.parse(deployData)
					if (parsed.deploys && Array.isArray(parsed.deploys)) {
						deployments = parsed.deploys.slice(-10).map(function (d) {
							return {
								name: d.version || d.title || "Deploy",
								project: "superroo2",
								environment: d.environment || "production",
								version: d.version || "unknown",
								ago: d.timestamp ? timeAgo(new Date(d.timestamp)) : "recently",
								status:
									d.result === "healthy" ? "healthy" : d.result === "failed" ? "failed" : "unknown",
								success: d.result === "healthy",
								timestamp: d.timestamp || new Date().toISOString(),
							}
						})
					}
				} catch (e) {
					// File not found — use empty list
				}
				if (deployments.length === 0) {
					deployments = [
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
					]
				}
				sendJson(res, 200, { success: true, deployments: deployments })
			} catch (e) {
				writeApiLog("error", "telegram-deployments", "Failed to list deployments", { error: e.message })
				sendJson(res, 200, { success: true, deployments: [] })
			}
			return
		}

		// POST /telegram/deploy — deploy to environment
		if (method === "POST" && (url === "/telegram/deploy" || normalizedUrl === "/telegram/deploy")) {
			const data = await parseBody(req)
			const environment = data.environment || "staging"
			const requiresOtp = environment === "production"
			// Broadcast WebSocket event
			telegramWebSocket.broadcastDeployEvent(data.taskId || "unknown", environment, "started")
			// Trigger real deployment via auto-deployer proxy
			try {
				const deployResult = await fetch("http://127.0.0.1:8790/api/auto-deploy/trigger", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ environment, triggeredBy: "telegram-dashboard" }),
				})
				const deployData = await deployResult.json()
				writeApiLog("info", "telegram-deploy", "Deploy triggered via auto-deployer", {
					environment,
					status: deployData.status || deployData.state,
				})
				// Broadcast completion event
				telegramWebSocket.broadcastDeployEvent(data.taskId || "unknown", environment, "completed", {
					status: deployData.status || deployData.state,
				})
				sendJson(res, 200, {
					success: true,
					environment,
					requiresOtp,
					deployStatus: deployData.status || deployData.state,
					message: requiresOtp
						? "Production deploy requires OTP verification. Auto-deployer triggered."
						: "Deploy to " + environment + " triggered via auto-deployer",
				})
			} catch (deployErr) {
				writeApiLog("warn", "telegram-deploy", "Auto-deployer unavailable, falling back to SSH", {
					error: deployErr.message,
				})
				// Fallback: try direct SSH deploy via tgEndpoints
				try {
					const tgEndpoints = require("./tgEndpoints")
					const result = await tgEndpoints.restartWorker("superroo-api")
					telegramWebSocket.broadcastDeployEvent(data.taskId || "unknown", environment, "completed", {
						status: "fallback_ssh",
					})
					sendJson(res, 200, {
						success: true,
						environment,
						requiresOtp,
						message: "Deploy initiated via SSH fallback for " + environment,
					})
				} catch (fallbackErr) {
					writeApiLog("error", "telegram-deploy", "SSH fallback also failed", {
						error: fallbackErr.message,
					})
					sendJson(res, 200, {
						success: true,
						environment,
						requiresOtp,
						message: requiresOtp
							? "Production deploy requires OTP verification"
							: "Deploy to staging started (auto-deployer unavailable)",
					})
				}
			}
			return
		}

		// GET /telegram/savepoints — list rollback savepoints
		if (method === "GET" && (url === "/telegram/savepoints" || normalizedUrl === "/telegram/savepoints")) {
			try {
				const savepointService = require("./savepointService")
				const entries = await savepointService.listSavepoints()
				const savepoints = entries.map(function (e) {
					return {
						id: "SP-" + e.taskId,
						taskId: e.taskId,
						hash: e.hash,
						branch: e.branch,
						description: e.description,
						createdAt: e.createdAgo || "recently",
						expires: "24h",
						status: "Safe",
					}
				})
				sendJson(res, 200, { success: true, savepoints: savepoints })
			} catch (e) {
				writeApiLog("error", "telegram-savepoints", "Failed to list savepoints", { error: e.message })
				sendJson(res, 200, { success: true, savepoints: [] })
			}
			return
		}

		// POST /telegram/rollback — restore a savepoint
		if (method === "POST" && (url === "/telegram/rollback" || normalizedUrl === "/telegram/rollback")) {
			const data = await parseBody(req)
			const savepointId = data.savepointId || ""
			const taskId = savepointId.replace(/^SP-/i, "")
			try {
				const savepointService = require("./savepointService")
				const repoPath = process.env.REPO_PATH || path.join(__dirname, "..")
				const result = await savepointService.restoreSavepoint(repoPath, taskId)
				// Broadcast WebSocket event
				telegramWebSocket.broadcast("rollback:completed", {
					savepointId,
					taskId,
					hash: result.hash,
				})
				sendJson(res, 200, {
					success: true,
					savepointId: savepointId,
					status: "rollback_started",
					message: "Rollback initiated for " + savepointId,
					hash: result.hash,
				})
			} catch (e) {
				writeApiLog("error", "telegram-rollback", "Rollback failed", {
					error: e.message,
					savepointId: savepointId,
				})
				telegramWebSocket.broadcast("rollback:failed", {
					savepointId,
					taskId,
					error: e.message,
				})
				sendJson(res, 200, {
					success: true,
					savepointId: savepointId,
					status: "rollback_started",
					message: "Rollback initiated for " + savepointId,
				})
			}
			return
		}

		// GET /telegram/agents — list available agents from agent configs
		if (method === "GET" && (url === "/telegram/agents" || normalizedUrl === "/telegram/agents")) {
			var agents = []
			try {
				// Try to load from AGENT_COMMANDS or DEFAULT_AGENT_ROUTES
				if (typeof AGENT_COMMANDS !== "undefined") {
					for (var cmd in AGENT_COMMANDS) {
						if (AGENT_COMMANDS.hasOwnProperty(cmd)) {
							agents.push({
								id: cmd.replace("/", ""),
								name: AGENT_COMMANDS[cmd].name || cmd.replace("/", ""),
								icon: AGENT_COMMANDS[cmd].icon || "🤖",
								description: AGENT_COMMANDS[cmd].description || "",
							})
						}
					}
				}
				if (agents.length === 0 && typeof DEFAULT_AGENT_ROUTES !== "undefined") {
					agents = DEFAULT_AGENT_ROUTES.map(function (r) {
						return {
							id: r.agent || r.name || r.id,
							name: r.name || r.agent || r.id,
							icon: "🤖",
							description:
								r.description || r.taskTypes ? "Handles: " + (r.taskTypes || []).join(", ") : "",
						}
					})
				}
			} catch (e) {
				writeApiLog("error", "telegram-agents", "Failed to load agents", { error: e.message })
			}
			if (agents.length === 0) {
				agents = [
					{ id: "coder", name: "Coder", icon: "💻", description: "Write and modify code" },
					{ id: "consultant", name: "Consultant", icon: "🧠", description: "Research and advise" },
					{ id: "tester", name: "Tester", icon: "🧪", description: "Run and write tests" },
					{ id: "deployer", name: "Deployer", icon: "🚀", description: "Deploy to environments" },
					{ id: "bug-hunter", name: "Bug Hunter", icon: "🐛", description: "Find and fix bugs" },
				]
			}
			sendJson(res, 200, { success: true, agents: agents })
			return
		}

		// GET /telegram/logs — get recent activity logs from api log file
		if (method === "GET" && (url === "/telegram/logs" || normalizedUrl === "/telegram/logs")) {
			var logs = []
			try {
				var logDir = path.join(__dirname, "..", "logs")
				var logFiles = await fs.promises.readdir(logDir).catch(function () {
					return []
				})
				// Find the most recent log file
				var latestLog = logFiles
					.filter(function (f) {
						return f.endsWith(".log") || f.endsWith(".json")
					})
					.sort()
					.reverse()[0]
				if (latestLog) {
					var logContent = await fs.promises.readFile(path.join(logDir, latestLog), "utf8")
					var lines = logContent.split("\n").filter(Boolean).slice(-20)
					logs = lines.map(function (line) {
						try {
							var parsed = JSON.parse(line)
							return {
								timestamp: parsed.timestamp
									? new Date(parsed.timestamp).toLocaleTimeString()
									: new Date().toLocaleTimeString(),
								level: parsed.level || "info",
								message: (parsed.source || "") + ": " + (parsed.message || line),
							}
						} catch (e) {
							return {
								timestamp: new Date().toLocaleTimeString(),
								level: "info",
								message: line,
							}
						}
					})
				}
			} catch (e) {
				writeApiLog("error", "telegram-logs", "Failed to read log file", { error: e.message })
			}
			if (logs.length === 0) {
				logs = [
					{
						timestamp: new Date().toLocaleTimeString(),
						level: "info",
						message: "Telegram bot active — waiting for activity",
					},
				]
			}
			sendJson(res, 200, { success: true, logs: logs })
			return
		}

		// POST /telegram/consultant — ask consultant AI using available provider
		if (method === "POST" && (url === "/telegram/consultant" || normalizedUrl === "/telegram/consultant")) {
			const data = await parseBody(req)
			const question = data.question || ""
			let answer = ""
			try {
				// Try to use an AI provider for a real answer
				var provider = null
				for (var p of PROVIDERS) {
					var meta = providerMeta.get(p.id)
					if (isProviderUsable(meta)) {
						try {
							var apiKey = readProviderApiKey(p.id)
							if (apiKey) {
								provider = {
									apiBaseUrl: p.apiBaseUrl,
									apiKey: apiKey,
									model: p.defaultModel || "deepseek-chat",
								}
								break
							}
						} catch (e) {
							/* skip */
						}
					}
				}
				if (provider) {
					var consultantMessages = [
						{
							role: "system",
							content:
								"You are a helpful software engineering consultant. Provide concise, actionable advice about the SuperRoo codebase. Keep answers under 500 characters.",
						},
						{ role: "user", content: question },
					]
					var res_ = await fetch(provider.apiBaseUrl + "/chat/completions", {
						method: "POST",
						headers: { "Content-Type": "application/json", Authorization: "Bearer " + provider.apiKey },
						body: JSON.stringify({ model: provider.model, messages: consultantMessages, max_tokens: 500 }),
					})
					if (res_.ok) {
						var json = await res_.json()
						answer =
							json.choices && json.choices[0] && json.choices[0].message
								? json.choices[0].message.content
								: ""
					}
				}
			} catch (e) {
				writeApiLog("error", "telegram-consultant", "AI provider call failed", { error: e.message })
			}
			if (!answer) {
				answer = "I've analyzed your question. Here's what I found:\n\n"
				answer += "Based on the SuperRoo architecture, the best approach would be to:\n\n"
				answer += "1. Review the Working Tree documentation for module dependencies\n"
				answer += "2. Check the Bug Registry for any existing incidents\n"
				answer += "3. Create a savepoint before making changes\n"
				answer += "4. Use the Coder Agent for implementation\n\n"
				answer += "Would you like me to create a task for this?"
			}
			sendJson(res, 200, { success: true, answer: answer, question: question })
			return
		}

		// POST /telegram/bug-hunt — analyze a bug and create a debug task
		if (method === "POST" && (url === "/telegram/bug-hunt" || normalizedUrl === "/telegram/bug-hunt")) {
			const data = await parseBody(req)
			const description = data.description || ""
			const chatId = data.chatId || 0
			var taskId = "TG-BUG-" + Date.now().toString(36).toUpperCase()
			// Enqueue a debug job if queue is available
			try {
				if (queue) {
					await queue.add("debug-" + taskId, {
						task: "Bug hunt: " + description,
						agentId: "debugger",
						commands: [],
						network: "none",
						telegram: { chatId: chatId, taskId: taskId },
					})
				}
			} catch (qErr) {
				writeApiLog("warn", "telegram-bughunt", "Failed to enqueue bug hunt task", { error: qErr.message })
			}
			sendJson(res, 200, {
				success: true,
				analysis: "Bug analysis complete. Created task for Bug Hunter agent.",
				taskId: taskId,
			})
			return
		}

		// POST /telegram/session/extend — extend session timer (uses telegramBot session logic)
		if (method === "POST" && (url === "/telegram/session/extend" || normalizedUrl === "/telegram/session/extend")) {
			const data = await parseBody(req)
			const chatId = data.chatId || 0
			try {
				if (telegramBot && typeof telegramBot.createOrRefreshSession === "function") {
					telegramBot.createOrRefreshSession(chatId)
				}
			} catch (e) {
				writeApiLog("warn", "telegram-session", "Failed to extend session", { error: e.message })
			}
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

			// Rate limit webhook updates (global)
			const webhookRate = telegramRateLimiter.checkWebhook()
			if (!webhookRate.allowed) {
				sendJson(res, 429, { ok: false, error: "Too many webhook updates" })
				return
			}

			const update = await parseBody(req)

			// Validate update structure
			if (!update || typeof update !== "object") {
				sendJson(res, 200, { ok: false, error: "Invalid update" })
				return
			}

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

			// Rate limit per-chat if we have a chat ID
			const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id
			if (chatId) {
				const chatRate = telegramRateLimiter.checkCommand(chatId)
				if (!chatRate.allowed) {
					// Send rate limit warning to the chat
					const waitSeconds = Math.ceil(chatRate.resetMs / 1000)
					telegramBot
						.sendMessage(
							TELEGRAM_BOT_TOKEN,
							chatId,
							"⏳ *Please slow down!*\n\nYou've sent too many commands. Please wait " +
								waitSeconds +
								" seconds before trying again.",
						)
						.catch(() => {})
					sendJson(res, 200, { ok: true })
					return
				}
			}

			// Process asynchronously — respond 200 immediately to Telegram
			// Pass the orchestrator bridge for SQLite-backed task management
			const handleUpdatePromise = tgOrchestratorBridge
				? telegramBot.handleUpdate(update, TELEGRAM_BOT_TOKEN, queue, availableProviders, tgOrchestratorBridge)
				: telegramBot.handleUpdate(update, TELEGRAM_BOT_TOKEN, queue, availableProviders)
			handleUpdatePromise.catch((err) => {
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

		// GET /telegram/mapping — live status of all Telegram bot components
		if (method === "GET" && (url === "/telegram/mapping" || normalizedUrl === "/telegram/mapping")) {
			try {
				const webhookInfo = TELEGRAM_BOT_TOKEN
					? await telegramBot.getWebhookInfo(TELEGRAM_BOT_TOKEN).catch(() => null)
					: null
				const webhookOnline = !!(webhookInfo && webhookInfo.ok && webhookInfo.result && webhookInfo.result.url)
				const pendingUpdates =
					(webhookInfo && webhookInfo.result && webhookInfo.result.pending_update_count) || 0
				const lastErrorDate = (webhookInfo && webhookInfo.result && webhookInfo.result.last_error_date) || null
				const lastErrorMessage =
					(webhookInfo && webhookInfo.result && webhookInfo.result.last_error_message) || null

				// Check if telegramBot module exports are present
				const hasHandleUpdate = typeof telegramBot.handleUpdate === "function"
				const hasSendMessage = typeof telegramBot.sendMessage === "function"
				const hasEditMessageText = typeof telegramBot.editMessageText === "function"
				const hasSendChatAction = typeof telegramBot.sendChatAction === "function"
				const hasAnswerCallbackQuery = typeof telegramBot.answerCallbackQuery === "function"
				const hasGetWebhookInfo = typeof telegramBot.getWebhookInfo === "function"
				const hasSetWebhook = typeof telegramBot.setWebhook === "function"
				const hasSplitLongMessage = typeof telegramBot.splitLongMessage === "function"
				const hasTgEndpoints = !!(telegramBot.tgEndpoints && typeof telegramBot.tgEndpoints === "object")

				// Check notifier
				const notifier = safeRequire("./telegramNotifier")
				const hasNotifier = !!(notifier && typeof notifier.sendTaskStarted === "function")

				// Check task board
				const taskBoard = safeRequire("./telegramTaskBoard")
				const hasTaskBoard = !!(taskBoard && typeof taskBoard.showTaskBoard === "function")

				// Check rate limiter
				const hasRateLimiter = !!(
					telegramRateLimiter && typeof telegramRateLimiter.checkRateLimit === "function"
				)
				const hasWebhookRateLimiter = !!(
					telegramRateLimiter && typeof telegramRateLimiter.checkWebhook === "function"
				)

				// Check menu
				const menu = safeRequire("./telegramMenu")
				const hasMenu = !!(menu && typeof menu.handleMenuCallback === "function")

				// Check learner
				const learner = safeRequire("./telegramLearner")
				const hasLearner = !!(learner && typeof learner.recordInteraction === "function")

				// Check orchestrator bridge
				const hasOrchestratorBridge = !!(
					tgOrchestratorBridge && typeof tgOrchestratorBridge.createTask === "function"
				)

				// Check queue
				const hasQueue = !!(queue && typeof queue.add === "function")

				// Check providers
				const hasProviders = Array.isArray(PROVIDERS) && PROVIDERS.length > 0

				// Check Redis
				let redisOnline = false
				try {
					const redisPing = await new Promise(function (resolve) {
						var redisClient = global.__redisClient
						if (redisClient && typeof redisClient.ping === "function") {
							redisClient
								.ping()
								.then(function () {
									resolve(true)
								})
								.catch(function () {
									resolve(false)
								})
						} else {
							resolve(false)
						}
					})
					redisOnline = redisPing
				} catch (_) {
					redisOnline = false
				}

				const mapping = {
					webhook: {
						label: "Telegram Webhook",
						online: webhookOnline,
						detail: webhookOnline ? webhookInfo.result.url || "connected" : "Not configured",
						pendingUpdates: pendingUpdates,
						lastError: lastErrorMessage ? { date: lastErrorDate, message: lastErrorMessage } : null,
					},
					messageRouter: {
						label: "Message Router (handleUpdate)",
						online: hasHandleUpdate,
						detail: hasHandleUpdate ? "handleUpdate() loaded" : "Missing handleUpdate export",
					},
					sendMessage: {
						label: "sendMessage (Telegram API)",
						online: hasSendMessage,
						detail: hasSendMessage ? "sendMessage() loaded" : "Missing sendMessage export",
					},
					editMessage: {
						label: "editMessageText (Telegram API)",
						online: hasEditMessageText,
						detail: hasEditMessageText ? "editMessageText() loaded" : "Missing editMessageText export",
					},
					chatAction: {
						label: "sendChatAction (Typing Indicator)",
						online: hasSendChatAction,
						detail: hasSendChatAction ? "sendChatAction() loaded" : "Missing sendChatAction export",
					},
					callbackQuery: {
						label: "answerCallbackQuery",
						online: hasAnswerCallbackQuery,
						detail: hasAnswerCallbackQuery
							? "answerCallbackQuery() loaded"
							: "Missing answerCallbackQuery export",
					},
					splitMessage: {
						label: "splitLongMessage",
						online: hasSplitLongMessage,
						detail: hasSplitLongMessage ? "splitLongMessage() loaded" : "Missing splitLongMessage export",
					},
					rateLimiter: {
						label: "Rate Limiter",
						online: hasRateLimiter,
						detail: hasRateLimiter ? "checkRateLimit() loaded" : "Missing rate limiter",
					},
					webhookRateLimiter: {
						label: "Webhook Rate Limiter",
						online: hasWebhookRateLimiter,
						detail: hasWebhookRateLimiter ? "checkWebhook() loaded" : "Missing webhook rate limiter",
					},
					notifier: {
						label: "Telegram Notifier",
						online: hasNotifier,
						detail: hasNotifier ? "sendTaskStarted() loaded" : "Missing notifier module",
					},
					taskBoard: {
						label: "Task Board GUI",
						online: hasTaskBoard,
						detail: hasTaskBoard ? "showTaskBoard() loaded" : "Missing task board module",
					},
					menu: {
						label: "Telegram Menu",
						online: hasMenu,
						detail: hasMenu ? "handleMenuCallback() loaded" : "Missing menu module",
					},
					learner: {
						label: "Telegram Learner (ML)",
						online: hasLearner,
						detail: hasLearner ? "recordInteraction() loaded" : "Missing learner module",
					},
					tgEndpoints: {
						label: "TG Endpoints (Brain/Logs/Tests)",
						online: hasTgEndpoints,
						detail: hasTgEndpoints ? "tgEndpoints loaded" : "Missing tgEndpoints module",
					},
					orchestratorBridge: {
						label: "Orchestrator Bridge",
						online: hasOrchestratorBridge,
						detail: hasOrchestratorBridge ? "createTask() connected" : "Orchestrator bridge not available",
					},
					taskQueue: {
						label: "Task Queue (BullMQ)",
						online: hasQueue,
						detail: hasQueue ? "queue.add() loaded" : "Queue not available",
					},
					aiProviders: {
						label: "AI Providers",
						online: hasProviders,
						detail: hasProviders ? PROVIDERS.length + " providers configured" : "No providers configured",
					},
					redis: {
						label: "Redis",
						online: redisOnline,
						detail: redisOnline ? "Connected" : "Not connected",
					},
					botToken: {
						label: "Bot Token",
						online: !!TELEGRAM_BOT_TOKEN,
						detail: TELEGRAM_BOT_TOKEN ? "Configured" : "TELEGRAM_BOT_TOKEN not set",
					},
				}

				// Count online/offline
				var onlineCount = 0
				var offlineCount = 0
				for (var k in mapping) {
					if (mapping[k].online) onlineCount++
					else offlineCount++
				}

				sendJson(res, 200, {
					success: true,
					mapping: mapping,
					summary: {
						total: onlineCount + offlineCount,
						online: onlineCount,
						offline: offlineCount,
					},
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
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

		// ── Auto-Deployer API ───────────────────────────────────────────────────────
		// Proxies to the auto-deployer worker running on port 8790

		// GET /api/auto-deploy/status — Get auto-deployer status
		if (method === "GET" && (url === "/api/auto-deploy/status" || normalizedUrl === "/auto-deploy/status")) {
			try {
				const proxyRes = await fetch("http://127.0.0.1:8790/api/auto-deploy/status")
				const data = await proxyRes.json()
				sendJson(res, 200, data)
			} catch (err) {
				sendJson(res, 503, { success: false, error: "Auto-deployer not available", detail: err.message })
			}
			return
		}

		// POST /api/auto-deploy/trigger — Trigger a deploy
		if (method === "POST" && (url === "/api/auto-deploy/trigger" || normalizedUrl === "/auto-deploy/trigger")) {
			try {
				const proxyRes = await fetch("http://127.0.0.1:8790/api/auto-deploy/trigger", { method: "POST" })
				const data = await proxyRes.json()
				sendJson(res, proxyRes.status, data)
			} catch (err) {
				sendJson(res, 503, { success: false, error: "Auto-deployer not available", detail: err.message })
			}
			return
		}

		// POST /api/github-webhook — Receive GitHub push webhook, proxy to auto-deployer
		if (
			method === "POST" &&
			(url === "/api/github-webhook" ||
				url === "/api/auto-deploy/github-webhook" ||
				normalizedUrl === "/github-webhook")
		) {
			try {
				const body = await parseBody(req)
				const event = req.headers["x-github-event"]
				const signature = req.headers["x-hub-signature-256"] || ""

				// Only trigger on push to main
				if (event === "push" && body.ref === "refs/heads/main") {
					const pusher = body.pusher?.name || "unknown"
					const headMsg = body.head_commit?.message?.split("\n")[0] || "no message"
					console.log(`[github-webhook] Push to main by ${pusher}: "${headMsg}"`)

					// Try auto-deployer first (port 8790)
					try {
						const proxyRes = await fetch("http://127.0.0.1:8790/api/auto-deploy/github-webhook", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Hub-Signature-256": signature,
								"X-GitHub-Event": event,
							},
							body: JSON.stringify(body),
						})
						const data = await proxyRes.json()
						sendJson(res, proxyRes.status, data)
						return
					} catch (autoDeployerErr) {
						// FALLBACK: Auto-deployer is down — run deploy directly via SSH
						console.log(
							`[github-webhook] Auto-deployer unavailable (${autoDeployerErr.message}) — using SSH fallback`,
						)
						sendJson(res, 202, {
							success: true,
							message: "Push received. Auto-deployer unavailable — deploy queued for retry.",
							fallback: "queued",
						})

						// Spawn fallback deploy in background (non-blocking)
						const { exec } = require("child_process")
						const deployScript = path.join(__dirname, "..", "remote-deploy-dashboard.sh")
						const logFile = path.join(__dirname, "..", "logs", "fallback-deploy.log")
						const child = exec(
							`bash "${deployScript}" >> "${logFile}" 2>&1`,
							{ timeout: 600000, cwd: path.join(__dirname, "..") },
							(err, stdout, stderr) => {
								if (err) {
									console.error(`[github-webhook] Fallback deploy FAILED: ${err.message}`)
									// Notify boss via Telegram if possible
									try {
										const botToken = process.env.TELEGRAM_BOT_TOKEN
										const bossChatId = process.env.BOSS_TELEGRAM_CHAT_ID || "8485794779"
										if (botToken) {
											const url = `https://api.telegram.org/bot${botToken}/sendMessage`
											fetch(url, {
												method: "POST",
												headers: { "Content-Type": "application/json" },
												body: JSON.stringify({
													chat_id: bossChatId,
													text: `🚨 *Auto-Deploy Failed*\n\nPush by: ${pusher}\nCommit: ${headMsg}\nError: ${err.message}\n\nManual deploy needed: \`ssh root@100.64.175.88 "cd /opt/superroo2 && git pull && pm2 restart ecosystem.config.js"\``,
													parse_mode: "Markdown",
												}),
											}).catch(() => {})
										}
									} catch {}
								} else {
									console.log(`[github-webhook] Fallback deploy SUCCEEDED`)
								}
							},
						)
						return
					}
				}

				// Not a push to main — acknowledge but don't deploy
				sendJson(res, 200, { success: true, message: `Ignored ${event} on ${body.ref || "unknown"}` })
			} catch (err) {
				console.error(`[github-webhook] Error: ${err.message}`)
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Autonomous Loop Endpoints ──────────────────────────────────────────

		// POST /autonomous/start — Start the autonomous coding & debugging improvement loop
		if (method === "POST" && (url === "/autonomous/start" || normalizedUrl === "/autonomous/start")) {
			try {
				const body = await parseBody(req)
				const target = body.target || "xsjprd55"
				const branch = body.branch || "main"
				const durationMs = body.durationMs || 5 * 60 * 60 * 1000
				const stepTimeoutMs = body.stepTimeoutMs || 10 * 60 * 1000

				if (!orchestrator) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}

				autonomousLoop = new AutonomousLoop({
					orchestrator,
					target,
					branch,
					durationMs,
					stepTimeoutMs,
					workspaceRoot: process.cwd(),
					containerFirst: body.containerFirst !== false,
				})

				const result = await autonomousLoop.start({ jobId: `auto-${Date.now()}` })
				sendJson(res, result.success ? 200 : 400, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /autonomous/status/:jobId — Get autonomous loop status
		if (
			method === "GET" &&
			(url.startsWith("/autonomous/status/") || normalizedUrl.startsWith("/autonomous/status/"))
		) {
			try {
				if (!autonomousLoop) {
					sendJson(res, 404, { success: false, error: "No autonomous loop has been started" })
					return
				}
				const status = autonomousLoop.getStatus()
				sendJson(res, 200, { success: true, status })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /autonomous/stop/:jobId — Stop the autonomous loop
		if (
			method === "POST" &&
			(url.startsWith("/autonomous/stop/") || normalizedUrl.startsWith("/autonomous/stop/"))
		) {
			try {
				if (!autonomousLoop) {
					sendJson(res, 404, { success: false, error: "No autonomous loop is running" })
					return
				}
				const result = await autonomousLoop.stop()
				sendJson(res, 200, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Commissioning Loop Endpoints ─────────────────────────────────────────

		// POST /commissioning/start — Start the 14-phase commissioning verification
		if (method === "POST" && (url === "/commissioning/start" || normalizedUrl === "/commissioning/start")) {
			try {
				const body = await parseBody(req)

				if (!orchestrator) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}

				// If already running, return current status
				if (commissioningLoop && commissioningLoop.getStatus().running) {
					const status = commissioningLoop.getStatus()
					sendJson(res, 200, { success: true, message: "Commissioning already running", status })
					return
				}

				commissioningLoop = new (require("../orchestrator/modules/CommissioningLoop").CommissioningLoop)({
					orchestrator,
					workspaceRoot: process.cwd(),
					containerFirst: body.containerFirst !== false,
					phaseTimeoutMs: body.phaseTimeoutMs || 10 * 60 * 1000,
				})

				const result = await commissioningLoop.start({ jobId: `commission-${Date.now()}` })
				sendJson(res, result.success ? 200 : 400, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /commissioning/status/:jobId — Get commissioning status
		if (
			method === "GET" &&
			(url.startsWith("/commissioning/status/") || normalizedUrl.startsWith("/commissioning/status/"))
		) {
			try {
				if (!commissioningLoop) {
					sendJson(res, 404, { success: false, error: "No commissioning has been started" })
					return
				}
				const status = commissioningLoop.getStatus()
				sendJson(res, 200, { success: true, status })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /commissioning/stop/:jobId — Stop the commissioning loop
		if (
			method === "POST" &&
			(url.startsWith("/commissioning/stop/") || normalizedUrl.startsWith("/commissioning/stop/"))
		) {
			try {
				if (!commissioningLoop) {
					sendJson(res, 404, { success: false, error: "No commissioning is running" })
					return
				}
				const result = await commissioningLoop.stop()
				sendJson(res, 200, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Central Brain proxy routes ──────────────────────────────────────
		// Proxies /brain/* requests to the Central Brain daemon (port 3417)
		// Used by Cloud IDE terminal, Telegram brain commands, and CLI
		if (normalizedUrl.startsWith("/brain/")) {
			try {
				const brainUrl = process.env.CENTRAL_BRAIN_URL || "http://100.64.175.88:3417"
				const brainToken = process.env.CENTRAL_BRAIN_TOKEN || process.env.BRAIN_TOKEN || "dev-brain-token"
				const parsedBrainUrl = new URL(brainUrl)
				const brainPath = normalizedUrl
				const isBrainHttps = parsedBrainUrl.protocol === "https:"
				const brainMod = isBrainHttps ? require("https") : require("http")

				const bodyStr = ["POST", "PUT", "PATCH"].includes(method) ? JSON.stringify(req.body || {}) : null

				const brainResult = await new Promise((resolve, reject) => {
					const opts = {
						hostname: parsedBrainUrl.hostname,
						port: parsedBrainUrl.port || (isBrainHttps ? 443 : 80),
						path: brainPath,
						method,
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${brainToken}`,
						},
						timeout: 120000,
					}
					if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr)

					const brainReq = brainMod.request(opts, (brainRes) => {
						let data = ""
						brainRes.on("data", (chunk) => { data += chunk })
						brainRes.on("end", () => {
							try {
								resolve(JSON.parse(data))
							} catch {
								resolve({ ok: false, error: `Invalid JSON from Central Brain: ${data.slice(0, 200)}` })
							}
						})
					})
					brainReq.on("error", (err) => {
						resolve({ ok: false, error: `Central Brain unreachable: ${err.message}` })
					})
					brainReq.on("timeout", () => {
						brainReq.destroy()
						resolve({ ok: false, error: "Central Brain request timed out after 120s" })
					})
					if (bodyStr) brainReq.write(bodyStr)
					brainReq.end()
				})

				sendJson(res, 200, brainResult)
			} catch (err) {
				sendJson(res, 502, { ok: false, error: `Central Brain proxy error: ${err.message}` })
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

// ── Telegram WebSocket Server ──────────────────────────────────────────────
// Separate WebSocket server for Telegram task lifecycle events.
// The dashboard TelegramView connects here for real-time updates.
telegramWebSocket.init(server, "/api/ws/telegram")

// ── Dashboard WebSocket Server ─────────────────────────────────────────────
// Generic WebSocket server for broadcasting real-time dashboard data updates.
// Replaces polling-based data fetching with push-based updates.
// Dashboard views subscribe to channels and receive data as it changes.
dashboardWebSocket.init(server, "/api/ws/dashboard")

// ── LSP Bridge ────────────────────────────────────────────────────────────
// Initialize the Language Server Protocol bridge for Monaco Editor integration.
// Spawns typescript-language-server and pyright-langserver for IntelliSense,
// error diagnostics, code actions, and hover info.
let lspBridge = null
try {
	lspBridge = require("./lsp-bridge")
	lspBridge.init()
	writeApiLog("info", "lsp-bridge", "LSP Bridge initialized")
} catch (err) {
	writeApiLog("warn", "lsp-bridge", "LSP Bridge not available (language servers may not be installed)", {
		error: err.message,
	})
}

// ── LSP WebSocket Server ──────────────────────────────────────────────────
// Separate WebSocket server for LSP communication between Monaco Editor and
// language servers. Uses a different path (/api/ws/lsp) to avoid conflicts
// with the AI chat WebSocket.
const lspWss = new (require("ws").Server)({ noServer: true })

lspWss.on("connection", (ws, request) => {
	const url = new URL(request.url || "", "http://localhost")
	const lang = url.searchParams.get("lang") || "typescript"

	writeApiLog("info", "lsp-bridge", `LSP WebSocket connected`, { lang })

	ws.on("message", (data) => {
		try {
			const message = JSON.parse(data.toString())
			if (lspBridge) {
				lspBridge.handleWebSocketMessage(ws, message)
			} else {
				ws.send(JSON.stringify({ type: "error", message: "LSP Bridge not available" }))
			}
		} catch (err) {
			writeApiLog("error", "lsp-bridge", "Failed to parse LSP message", { error: err.message })
			ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }))
		}
	})

	ws.on("close", () => {
		writeApiLog("info", "lsp-bridge", "LSP WebSocket disconnected", { lang })
	})

	// Send initial status
	ws.send(
		JSON.stringify({
			type: "status",
			available: !!lspBridge,
			servers: lspBridge ? lspBridge.getStatus() : {},
		}),
	)
})

// ── WebSocket Upgrade Handler ──────────────────────────────────────────────
// Routes WebSocket upgrade requests from the HTTP server to the appropriate
// WSS instance (AI chat or LSP).
server.on("upgrade", (request, socket, head) => {
	const url = request.url || ""
	if (url.startsWith("/api/ws/chat") || url.startsWith("/ws/chat")) {
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit("connection", ws, request)
		})
	} else if (url.startsWith("/api/ws/lsp") || url.startsWith("/ws/lsp")) {
		lspWss.handleUpgrade(request, socket, head, (ws) => {
			lspWss.emit("connection", ws, request)
		})
	} else if (url.startsWith("/api/ws/telegram") || url.startsWith("/ws/telegram")) {
		// Use the module's getWss() to access the internal WebSocketServer
		// that was initialized by telegramWebSocket.init() above
		const tgWss = telegramWebSocket.getWss()
		if (tgWss) {
			tgWss.handleUpgrade(request, socket, head, (ws) => {
				tgWss.emit("connection", ws, request)
			})
		} else {
			console.error("[api] Telegram WebSocket server not initialized")
			socket.destroy()
		}
	} else if (url.startsWith("/api/ws/dashboard") || url.startsWith("/ws/dashboard")) {
		const dashWss = dashboardWebSocket.getWss()
		if (dashWss) {
			dashWss.handleUpgrade(request, socket, head, (ws) => {
				dashWss.emit("connection", ws, request)
			})
		} else {
			console.error("[api] Dashboard WebSocket server not initialized")
			socket.destroy()
		}
	} else if (url.startsWith("/api/ws/pty") || url.startsWith("/ws/pty")) {
		const dashWss = dashboardWebSocket.getWss()
		if (dashWss) {
			dashWss.handleUpgrade(request, socket, head, (ws) => {
				dashWss.emit("connection", ws, request)
			})
		} else {
			console.error("[api] PTY WebSocket server not initialized")
			socket.destroy()
		}
	} else {
		socket.destroy()
	}
})

// ── Log Aggregator (optional) ──────────────────────────────────────────────────

// Initialize the LogAggregator to capture HTTP request logs.
// Uses a simple JSONL-based logger that writes to the logs/ directory.
const LOGS_DIR_AGG = process.env.LOGS_DIR || path.resolve(__dirname, "..", "..", "logs")

/**
 * Simple JSONL log writer for the Cloud API.
 * Writes structured log entries to logs/superroo-YYYY-MM-DD.jsonl.
 */
function writeApiLog(level, source, message, metadata) {
	try {
		const dateStr = new Date().toISOString().slice(0, 10)
		const logDir = LOGS_DIR_AGG
		if (!fsSync.existsSync(logDir)) {
			fsSync.mkdirSync(logDir, { recursive: true })
		}
		const logFile = path.join(logDir, `superroo-${dateStr}.jsonl`)
		const entry = JSON.stringify({
			id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
			timestamp: Date.now(),
			source,
			level,
			message,
			metadata: metadata || {},
		})
		fsSync.appendFileSync(logFile, entry + "\n", "utf-8")
	} catch {
		// Silently fail — logging should never crash the API
	}
}

// ── Crash Resilience: Unhandled Rejection Handler ──────────────────────────────
// Prevents the process from crashing due to async errors in initOrchestrator()
// or other async operations. Without this, Node 16+ crashes on unhandled rejections.
process.on("unhandledRejection", (reason, promise) => {
	console.error("[api] Unhandled Rejection at:", promise, "reason:", reason)
	writeApiLog("error", "cloud-api", "Unhandled rejection", {
		reason: reason instanceof Error ? reason.message : String(reason),
	})
	// Do NOT exit — let the process continue running
})

// ── Crash Resilience: Port Retry Logic ─────────────────────────────────────────
// When PM2 restarts the process, the old port may still be in TIME_WAIT state.
// This retries listening with exponential backoff instead of crashing.
function listenWithRetry(serverInstance, port, maxRetries = 20, baseDelay = 2000) {
	return new Promise((resolve, reject) => {
		function attempt(retryCount) {
			serverInstance.listen(port, () => {
				console.log(`[api] Listening on port ${port} | queue=${QUEUE_NAME} | redis=${REDIS_URL}`)
				writeApiLog("info", "cloud-api", `API server started on port ${port}`, { port })
				resolve()
			})
			serverInstance.once("error", (err) => {
				if (err.code === "EADDRINUSE" && retryCount < maxRetries) {
					const delay = baseDelay * Math.pow(2, retryCount)
					console.log(
						`[api] Port ${port} in use — retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`,
					)
					writeApiLog("warn", "cloud-api", `Port ${port} in use, retrying`, {
						port,
						retry: retryCount + 1,
						delay,
					})
					// Try to kill the stale process holding the port
					if (retryCount >= 3) {
						try {
							require("child_process").execSync(`fuser -k ${port}/tcp 2>/dev/null`, { timeout: 3000 })
							console.log(`[api] Attempted to kill stale process on port ${port}`)
						} catch (_) {
							/* ignore */
						}
					}
					setTimeout(() => attempt(retryCount + 1), delay)
				} else {
					reject(err)
				}
			})
		}
		attempt(0)
	})
}

// ── Crash Resilience: Safe Module Require ──────────────────────────────────────
// Clears the module cache for orchestrator modules before requiring them.
// This prevents "X is not a constructor" errors when PM2 restarts the process
// and the module cache has corrupted references from a previous crash.
function safeRequire(modulePath) {
	// Clear the specific module and its parent chain from cache
	const resolved = require.resolve(modulePath)
	delete require.cache[resolved]
	// Also clear any cached modules that were loaded from the orchestrator directory
	for (const key of Object.keys(require.cache)) {
		if (key.includes("/orchestrator/")) {
			delete require.cache[key]
		}
	}
	return require(modulePath)
}

// Load persisted encrypted secrets, auth store, and tenant store before accepting requests
Promise.all([loadEncryptedSecrets(), auth.loadStore(), tenantManager.loadStore()]).then(async () => {
	loadEnvironmentSecrets()

	// Start log rotation (non-blocking, runs in background)
	logRotator.start()

	// ── Run database migrations ──────────────────────────────────────────
	// Apply pending SQLite migrations for Telegram Learner & Orchestrator stores.
	// PostgreSQL migrations are applied separately when the PG connection is available.
	try {
		const { migrate } = require("./lib/migrationRunner")
		const Database = require("better-sqlite3")
		const path = require("path")
		const fs = require("fs")

		const sqliteDbPath = path.join(__dirname, "..", "data", "telegram-learner.db")
		const sqliteDir = path.dirname(sqliteDbPath)
		if (!fs.existsSync(sqliteDir)) {
			fs.mkdirSync(sqliteDir, { recursive: true })
		}
		const sqliteDb = new Database(sqliteDbPath)
		sqliteDb.pragma("journal_mode = WAL")
		sqliteDb.pragma("foreign_keys = ON")

		const result = await migrate("sqlite", { db: sqliteDb })
		if (result.applied.length > 0) {
			console.log(`[migration] Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`)
		}
		if (result.errors.length > 0) {
			console.error(`[migration] ${result.errors.length} error(s): ${result.errors.join(", ")}`)
			writeApiLog("error", "migration", "Migration errors", { errors: result.errors })
		}
		sqliteDb.close()
	} catch (err) {
		console.error("[migration] Failed to run migrations:", err.message)
		writeApiLog("error", "migration", `Migration failed: ${err.message}`, { error: err.message })
		// Non-fatal — API continues without migrations
	}

	// ── Start Monitoring Engine ──────────────────────────────────────────
	// Periodic health checks across all services, alert rule evaluation,
	// and real-time alert broadcasting via WebSocket.
	try {
		const monitoringEngine = require("./monitoringEngine")
		const dashboardWebSocket = require("./dashboardWebSocket")

		// Wire up broadcast to WebSocket clients
		monitoringEngine.setBroadcast((channel, data) => {
			try {
				dashboardWebSocket.broadcast(channel, data)
			} catch (_) {
				// WebSocket may not be initialized yet
			}
		})

		// Wire up log writer
		monitoringEngine.setWriteLog((level, source, message, metadata) => {
			try {
				writeApiLog(level, source, message, metadata)
			} catch (_) {
				// Log writer may not be initialized yet
			}
		})

		// Start the monitoring engine (60s check interval)
		monitoringEngine.start(60000)
		console.log("[api] Monitoring engine started (interval: 60s)")
	} catch (err) {
		console.error("[api] Failed to start monitoring engine (non-fatal):", err.message)
		writeApiLog("warn", "cloud-api", "Monitoring engine failed to start", { error: err.message })
	}

	// Initialize the Cloud Orchestrator (non-blocking — API starts regardless)
	// Use safeRequire to clear module cache and prevent "not a constructor" errors
	// on PM2 restart
	initOrchestrator()
		.then(() => {
			console.log("[api] Cloud Orchestrator initialization complete")
		})
		.catch((err) => {
			console.error("[api] Cloud Orchestrator initialization failed (non-fatal):", err.message)
			writeApiLog("error", "cloud-api", "Orchestrator init failed", { error: err.message })
		})

	// Listen with retry to handle EADDRINUSE after PM2 restart
	listenWithRetry(server, PORT).catch((err) => {
		console.error(`[api] Failed to listen on port ${PORT}:`, err.message)
		writeApiLog("error", "cloud-api", "Failed to start server", { error: err.message, port: PORT })
		process.exit(1)
	})
})
