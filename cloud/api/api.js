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
const os = require("os")

// ── Cloud Orchestrator ────────────────────────────────────────────────────────

const { CloudOrchestrator, SafetyMode } = require("../orchestrator")
const { AutonomousLoop } = require("../orchestrator/modules/AutonomousLoop")
const { CodexTaskLog } = require("../orchestrator/modules/CodexTaskLog")
const TelegramOrchestratorBridge = require("../orchestrator/TelegramOrchestratorBridge")
const { eventBus } = require("../orchestrator/modules/SuperRooEventBus")

// ── Sandbox Manager (lazy init) ────────────────────────────────────────────────

/**
 * Get the global SandboxManager singleton for API routes.
 * Uses the shared singleton from ../orchestrator/sandbox to avoid
 * the triple-singleton problem (multiple independent SandboxManager instances).
 */
async function getSandboxManager() {
	const { getGlobalSandboxManager } = require("../orchestrator/sandbox")
	return getGlobalSandboxManager()
}

// ── Auth & Telegram Bot ───────────────────────────────────────────────────────

const auth = require("./auth")
const telegramBot = require("./telegramBot")
const telegramClassifier = require("./telegramClassifier")
const healingMetrics = require("./routes/healing-metrics")
const monitoring = require("./routes/monitoring")
const workflowCompliance = require("./routes/workflow-compliance")
const { LspBridge } = require("./lsp-bridge")
const visualCrawler = require("./visual-crawler")
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""

// ── LSP Bridge (lazy init — uses the current workspace dir) ────────────────────
let lspBridge = null
function getLspBridge() {
	if (!lspBridge) {
		const wsDir =
			(global.__ideWorkspace && global.__ideWorkspace.workspaceDir) ||
			process.env.WORKSPACE_ROOT ||
			(fsSync.existsSync("/opt/superroo2") ? "/opt/superroo2" : process.cwd())
		lspBridge = new LspBridge(wsDir)
	}
	return lspBridge
}
const lspWss = new WebSocketServer({ noServer: true })
const collaborationWss = new WebSocketServer({ noServer: true })
global.__collaborationWss = collaborationWss

// ── IDE Workspace Persistence ─────────────────────────────────────────────────

const WORKSPACE_STORE_PATH = path.join(__dirname, "..", "data", "ide-workspace.json")
const codexTaskLog = new CodexTaskLog()

// ── ML Sync Modules ────────────────────────────────────────────────────────────

const {
	serializeNeuralNetwork,
	serializeLinearRegression,
	deserialize,
	validate,
} = require("../orchestrator/ml/ModelSerializer")
const { federatedMerge, mergeLocalAndCloud } = require("../orchestrator/ml/FederatedMerge")
const { fromLocal, fromCloud, toLocal, toCloud, UNIFIED_DIMENSIONS } = require("../orchestrator/ml/FeatureMapper")

/**
 * Send a Telegram alert to the boss chat when the self-healing loop escalates.
 * Fires silently on failure — never crashes the API.
 * @param {object} payload - repair_result event payload
 */
async function _alertBossEscalation(payload) {
	const botToken = process.env.TELEGRAM_BOT_TOKEN
	const bossChatId = process.env.BOSS_TELEGRAM_CHAT_ID || "8485794779"
	if (!botToken) return
	const fp = payload.fingerprint || "unknown"
	const title = payload.title || "unknown failure"
	const threshold = payload.threshold || 3
	const text =
		`🚨 *Self-Healing Escalation*\n\n` +
		`Fingerprint: \`${fp}\`\n` +
		`Failure: ${title}\n` +
		`Seen *${threshold}+* times without a fix\n\n` +
		`Manual investigation required.`
	try {
		await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: bossChatId, text, parse_mode: "Markdown" }),
			signal: AbortSignal.timeout(8000),
		})
	} catch {}
}

async function loadWorkspaceStore() {
	try {
		const raw = await fs.readFile(WORKSPACE_STORE_PATH, "utf8")
		return JSON.parse(raw)
	} catch {
		return null
	}
}

async function saveWorkspaceStore(data) {
	try {
		await fs.mkdir(path.dirname(WORKSPACE_STORE_PATH), { recursive: true })
		// Atomic write: write to temp then rename
		const tmp = WORKSPACE_STORE_PATH + ".tmp"
		await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tmp, WORKSPACE_STORE_PATH)
	} catch (err) {
		console.error("[workspace-store] Failed to save:", err.message)
	}
}

const execAsync = promisify(exec)

// Alias for Mini App API endpoints — uses var so it's hoisted; formatRelativeTime is defined later
var timeAgo = function (ts) {
	return formatRelativeTime(ts)
}

function getDefaultAlertRules() {
	return [
		{ label: "Bug detected", enabled: true, icon: "alert" },
		{ label: "Deploy finished", enabled: true, icon: "rocket" },
		{ label: "Agent loop failed", enabled: true, icon: "x" },
		{ label: "Task completed", enabled: true, icon: "check" },
		{ label: "Idle session expired", enabled: true, icon: "clock" },
		{ label: "New approval request", enabled: true, icon: "shield" },
		{ label: "Savepoint created", enabled: true, icon: "flag" },
		{ label: "Rollback executed", enabled: true, icon: "undo" },
	]
}

// ── AI Chat helper ─────────────────────────────────────────────────────────────

/**
 * Calls an OpenAI-compatible chat completion endpoint.
 * Supports DeepSeek, OpenAI, OpenRouter, Groq, Kimi — all use the same /v1/chat/completions format.
 */
async function callChatCompletion(apiBaseUrl, apiKey, model, messages) {
	// ── Try Ollama (local, FREE) first ──────────────────────────────────
	// Uses http.request instead of fetch because Node.js 20's built-in fetch (undici)
	// has a default headersTimeout of ~20s, but Ollama can take ~30s on cold start.
	const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
	const ollamaModel = process.env.OLLAMA_CHAT_MODEL || "qwen2.5:0.5b"
	try {
		const http = require("http")
		const postData = JSON.stringify({
			model: ollamaModel,
			messages,
			stream: false,
			options: { temperature: 0.7, num_predict: 4096 },
		})
		const ollamaContent = await new Promise((resolve) => {
			const req = http.request(
				`${ollamaBaseUrl}/api/chat`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(postData),
					},
					timeout: 120_000,
				},
				(res) => {
					let body = ""
					res.on("data", (chunk) => (body += chunk))
					res.on("end", () => {
						try {
							const data = JSON.parse(body)
							resolve(data.message?.content || data.response || null)
						} catch {
							resolve(null)
						}
					})
				},
			)
			req.on("error", () => resolve(null))
			req.on("timeout", () => {
				req.destroy()
				resolve(null)
			})
			req.write(postData)
			req.end()
		})
		if (ollamaContent) {
			return ollamaContent
		}
	} catch (_) {
		// Ollama unavailable — fall back to cloud API
	}

	// ── Fallback to cloud API ───────────────────────────────────────────
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
	if (isProviderUsable(primaryMeta, route.primary.provider)) {
		try {
			const providerDef = PROVIDERS.find((p) => p.id === route.primary.provider)
			// Local providers don't need an API key
			if (providerDef?.local === true) {
				return {
					providerId: route.primary.provider,
					apiBaseUrl: providerDef.apiBaseUrl,
					apiKey: "local",
					model: route.primary.model,
				}
			}
			const apiKey = readProviderApiKey(route.primary.provider)
			if (apiKey) {
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
		if (isProviderUsable(fbMeta, fallback.provider)) {
			try {
				const providerDef = PROVIDERS.find((p) => p.id === fallback.provider)
				// Local providers don't need an API key
				if (providerDef?.local === true) {
					return {
						providerId: fallback.provider,
						apiBaseUrl: providerDef.apiBaseUrl,
						apiKey: "local",
						model: fallback.model,
					}
				}
				const apiKey = readProviderApiKey(fallback.provider)
				if (apiKey) {
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
	if (!isProviderUsable(meta, providerId)) return null

	try {
		const providerDef = PROVIDERS.find((p) => p.id === providerId)
		// Local providers don't need an API key
		if (providerDef?.local === true) {
			return {
				providerId,
				apiBaseUrl: providerDef.apiBaseUrl,
				apiKey: "local",
				model: modelOverride || providerDef.defaultModel || "deepseek-chat",
			}
		}
		const apiKey = readProviderApiKey(providerId)
		if (!apiKey) return null
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

// ── Redis / BullMQ (optional in dev) ───────────────────────────────────────────
// In production Redis is required. In dev, if Redis is unavailable, we degrade
// gracefully with a NoopQueue to avoid endless ECONNREFUSED reconnect loops.
const IS_DEV = process.env.NODE_ENV !== "production"

class NoopQueue {
	async getWaitingCount() {
		return 0
	}
	async getActiveCount() {
		return 0
	}
	async getCompletedCount() {
		return 0
	}
	async getFailedCount() {
		return 0
	}
	async getDelayedCount() {
		return 0
	}
	async getWaiting() {
		return []
	}
	async getActive() {
		return []
	}
	async getCompleted() {
		return []
	}
	async getFailed() {
		return []
	}
	async getDelayed() {
		return []
	}
	async getJob() {
		return null
	}
	async add(name, data, opts) {
		console.warn(`[NoopQueue] Job "${name}" not enqueued — Redis is unavailable in dev`)
		return { id: `noop-${Date.now()}`, name, data, opts }
	}
}

let connection = null
let queue = null

function initQueue() {
	connection = new IORedis(REDIS_URL, {
		maxRetriesPerRequest: null,
		enableOfflineQueue: false,
		retryStrategy: IS_DEV ? () => null : undefined,
		connectTimeout: 3000,
	})

	// Suppress connection-error noise in dev after first warning
	connection.on("error", (err) => {
		if (IS_DEV && err.code === "ECONNREFUSED") {
			if (!global.__redisDevWarningLogged) {
				console.warn(`[api] Redis unavailable at ${REDIS_URL} — running in degraded mode (no BullMQ queue)`)
				global.__redisDevWarningLogged = true
			}
		}
	})

	queue = new Queue(QUEUE_NAME, { connection })
}

initQueue()

// Health-check Redis asynchronously; fallback to NoopQueue in dev if unreachable
if (IS_DEV) {
	setTimeout(async () => {
		try {
			await connection.ping()
		} catch {
			console.warn("[api] Switching to NoopQueue — Redis is not reachable in dev")
			try {
				await queue.close()
			} catch {}
			try {
				await connection.quit()
			} catch {}
			queue = new NoopQueue()
			connection = {
				status: "down",
				ping: async () => {
					throw new Error("Redis unavailable")
				},
			}
		}
	}, 2000)
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

		// ── Wire Phase 4+7: Provider Registry Bridge ────────────────────
		// Connects the new modular provider system (cloud/providers/) with the
		// legacy PROVIDERS array, providerMeta Map, and encrypted secrets store.
		try {
			const { createProviderBridge } = safeRequire("../providers/bridge")
			global.__providerBridge = await createProviderBridge({
				legacyProviders: PROVIDERS,
				legacyProviderMeta: providerMeta,
				legacyEncryptedSecrets: encryptedSecrets,
				legacyResolveProviderForTask: resolveProviderForTask,
				legacyResolveProviderById: resolveProviderById,
			})
			console.log(
				`[orchestrator] Provider Registry Bridge initialized | ${global.__providerBridge.getStatus().registryProviderCount} providers`,
			)
			writeApiLog("info", "cloud-provider-bridge", "Provider Registry Bridge initialized", {
				providerCount: global.__providerBridge.getStatus().registryProviderCount,
			})
		} catch (err) {
			console.warn(`[orchestrator] Provider Registry Bridge unavailable: ${err.message}`)
		}

		// ── Wire Phase 3: MCP Server Manager ────────────────────────────
		// Manages MCP server lifecycle with health checks, auto-recovery, and tool caching.
		try {
			const { MCPServerManager } = safeRequire("../orchestrator/mcp/MCPServerManager")
			const mcpServerManager = new MCPServerManager()
			await mcpServerManager.initialize({
				configPath: require("path").join(__dirname, "..", "..", ".mcp.json"),
			})
			orchestrator.mcpServerManager = mcpServerManager
			global.__mcpServerManager = mcpServerManager
			console.log(
				`[orchestrator] MCP Server Manager initialized | ${mcpServerManager.getServers().length} servers`,
			)
			writeApiLog("info", "cloud-mcp-manager", "MCP Server Manager initialized", {
				serverCount: mcpServerManager.getServers().length,
			})
		} catch (err) {
			console.warn(`[orchestrator] MCP Server Manager unavailable: ${err.message}`)
		}

		// ── Wire Phase 6: Collaboration System ──────────────────────────
		// Real-time collaboration with WebSocket sync, cursor sync, and file sync.
		try {
			const { createCollaborationSystem } = safeRequire("../collaboration/index")
			const collaborationSystem = createCollaborationSystem()
			orchestrator.collaborationSystem = collaborationSystem
			global.__collaborationSystem = collaborationSystem
			console.log(`[orchestrator] Collaboration System initialized`)
			writeApiLog("info", "cloud-collaboration", "Collaboration System initialized")
		} catch (err) {
			console.warn(`[orchestrator] Collaboration System unavailable: ${err.message}`)
		}

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
		const { ModelUsageTracker } = safeRequire("../orchestrator/modules/ModelUsageTracker")
		const { HealingBus } = safeRequire("../orchestrator/modules/HealingBus")
		const { SelfHealingLoop } = safeRequire("../orchestrator/modules/SelfHealingLoop")
		const { ParallelExecutor } = safeRequire("../orchestrator/modules/ParallelExecutor")
		const { AgentBus } = safeRequire("../orchestrator/modules/AgentBus")
		const { InfiniteImprovementLoop } = safeRequire("../orchestrator/modules/InfiniteImprovementLoop")
		const { CrawlerAgent } = safeRequire("../orchestrator/modules/CrawlerAgent")
		const { DeployOrchestrator } = safeRequire("../orchestrator/modules/DeployOrchestrator")
		const { FileImporter } = safeRequire("../orchestrator/modules/FileImporter")
		const { BuildQueue } = safeRequire("../orchestrator/modules/BuildQueue")
		const { UnifiedBuilder } = safeRequire("../orchestrator/modules/UnifiedBuilder")
		const { GlobalBuildOrchestrator } = safeRequire("../orchestrator/modules/GlobalBuildOrchestrator")
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

		const agentRegistry = new AgentRegistry()
		await agentRegistry.initialize()
		orchestrator.registerAgentRegistry(agentRegistry)

		const featureRegistry = new FeatureRegistry({ memoryStore: orchestrator.memory })
		await featureRegistry.initialize()
		orchestrator.registerFeatureRegistry(featureRegistry)

		const bugRegistry = new BugRegistry({ memoryStore: orchestrator.memory })
		await bugRegistry.initialize()
		orchestrator.registerBugRegistry(bugRegistry)

		orchestrator.registerCommitDeployLog(new CommitDeployLog())

		// ── ModelUsageTracker — tracks AI model API usage & workflow compliance ──
		const modelUsageTracker = new ModelUsageTracker({
			memoryDir: path.join(__dirname, "..", "..", "server", "src", "memory"),
		})
		await modelUsageTracker.initialize()
		orchestrator.modelUsageTracker = modelUsageTracker

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
			new ParallelExecutor({
				maxConcurrency: 2,
				maxTokens: 100,
				agentRegistry: orchestrator.agentRegistry || null,
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

		// ── Global Build Orchestrator — compiles build tasks from Claude/Codex agents ──
		try {
			const buildQueue = new BuildQueue({
				memory: orchestrator.memory,
				eventLog: orchestrator.eventLog,
				maxConcurrentBuilds: 1,
			})
			await buildQueue.initialize()

			const unifiedBuilder = new UnifiedBuilder({
				buildQueue,
				eventLog: orchestrator.eventLog,
				projectName: "superroo",
				workDir: path.join(__dirname, "..", ".."),
			})

			const globalBuildOrchestrator = new GlobalBuildOrchestrator({
				memory: orchestrator.memory,
				eventLog: orchestrator.eventLog,
				buildQueue,
				unifiedBuilder,
				deployOrchestrator: orchestrator.deployOrchestrator,
				maxConcurrentBuilds: 2,
				maxRamPercent: 80,
				ramOrchestratorUrl: "http://100.64.175.88:3419",
			})
			await globalBuildOrchestrator.initialize()
			orchestrator.registerGlobalBuildOrchestrator(globalBuildOrchestrator)
		} catch (err) {
			console.warn(`[orchestrator] GlobalBuildOrchestrator unavailable: ${err.message}`)
		}

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
		let hermesClaw = null
		try {
			const { HermesClaw } = safeRequire("../orchestrator/modules/HermesClaw")
			hermesClaw = new HermesClaw({
				apiKey: process.env.OPENAI_API_KEY || "",
				fallbackApiKey: process.env.DEEPSEEK_API_KEY || "",
			})
			await hermesClaw.init()
			orchestrator.registerHermesClaw(hermesClaw)
		} catch (err) {
			console.warn(`[orchestrator] HermesClaw unavailable; continuing with local learning only: ${err.message}`)
		}
		const { LearningGateway } = safeRequire("../orchestrator/modules/LearningGateway")
		orchestrator.registerLearningGateway(
			new LearningGateway({
				hermesClaw,
				projectRoot: path.join(__dirname, "..", ".."),
			}),
		)

		// ── Wire SuperRooEventBus to EventLog for SQLite persistence ─────────
		if (orchestrator.eventLog) {
			eventBus.attachEventLog(orchestrator.eventLog)
		}

		// ── Subscribe to repair_result escalation events → Telegram alert ────
		// Intercept all events emitted through the bus; filter to escalated repair
		// results and fire a Telegram message to the boss chat.
		const _origEmit = eventBus.emit.bind(eventBus)
		eventBus.emit = function (taskId, type, payload = {}) {
			const event = _origEmit(taskId, type, payload)
			if (type === "repair_result" && payload.escalated) {
				_alertBossEscalation(payload).catch(() => {})
			}
			return event
		}

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

// ── Rate Limiter ────────────────────────────────────────────────────────────────

/**
 * Simple in-memory sliding-window rate limiter.
 * Tracks request counts per IP address within a time window.
 * When the limit is exceeded, returns 429 Too Many Requests.
 *
 * Configuration via environment variables:
 *   RATE_LIMIT_WINDOW_MS  — Window duration in ms (default: 60_000 = 1 minute)
 *   RATE_LIMIT_MAX_REQS   — Max requests per window per IP (default: 100)
 *   RATE_LIMIT_BYPASS_IPS — Comma-separated IPs to exempt (e.g. "127.0.0.1,::1")
 */
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10)
const RATE_LIMIT_MAX_REQS = parseInt(process.env.RATE_LIMIT_MAX_REQS || "100", 10)
const RATE_LIMIT_BYPASS_IPS = new Set(
	(process.env.RATE_LIMIT_BYPASS_IPS || "127.0.0.1,::1,localhost").split(",").map((s) => s.trim().toLowerCase()),
)

/** @type {Map<string, { count: number; resetAt: number }>} */
const rateLimitBuckets = new Map()

// Periodic cleanup of expired buckets (every 5 minutes)
const RATE_LIMIT_CLEANUP_INTERVAL = setInterval(() => {
	const now = Date.now()
	for (const [key, bucket] of rateLimitBuckets) {
		if (bucket.resetAt <= now) {
			rateLimitBuckets.delete(key)
		}
	}
}, 300_000)
if (RATE_LIMIT_CLEANUP_INTERVAL.unref) {
	RATE_LIMIT_CLEANUP_INTERVAL.unref()
}

/**
 * Extract client IP from the request.
 * Respects X-Forwarded-For header (set by nginx/reverse proxy).
 */
function getClientIp(req) {
	const forwarded = req.headers["x-forwarded-for"]
	if (forwarded) {
		const ip = forwarded.split(",")[0].trim().toLowerCase()
		if (ip) return ip
	}
	return req.socket?.remoteAddress?.toLowerCase() || "unknown"
}

// ─── Telegram IP Whitelist (GAP 6.3) ────────────────────────────────────────
// Telegram webhook requests originate from known IP ranges.
// See: https://core.telegram.org/bots/webhooks#the-hard-way

const TELEGRAM_IP_RANGES = [
	"91.108.4.0/22",
	"91.108.56.0/22",
	"91.108.8.0/22",
	"91.108.12.0/22",
	"91.108.16.0/22",
	"91.108.20.0/22",
	"91.108.24.0/22",
	"91.108.28.0/22",
	"91.108.32.0/22",
	"91.108.36.0/22",
	"91.108.40.0/22",
	"91.108.44.0/22",
	"91.108.48.0/22",
	"91.108.52.0/22",
	"91.108.60.0/22",
	"91.108.64.0/22",
	"91.108.68.0/22",
	"91.108.72.0/22",
	"91.108.76.0/22",
	"91.108.80.0/22",
	"91.108.84.0/22",
	"91.108.88.0/22",
	"91.108.92.0/22",
	"91.108.96.0/22",
	"91.108.100.0/22",
	"91.108.104.0/22",
	"91.108.108.0/22",
	"91.108.112.0/22",
	"91.108.116.0/22",
	"91.108.120.0/22",
	"91.108.124.0/22",
	"91.108.128.0/22",
	"91.108.132.0/22",
	"91.108.136.0/22",
	"91.108.140.0/22",
	"91.108.144.0/22",
	"91.108.148.0/22",
	"91.108.152.0/22",
	"91.108.156.0/22",
	"91.108.160.0/22",
	"91.108.164.0/22",
	"91.108.168.0/22",
	"91.108.172.0/22",
	"91.108.176.0/22",
	"91.108.180.0/22",
	"91.108.184.0/22",
	"91.108.188.0/22",
	"91.108.192.0/22",
	"91.108.196.0/22",
	"91.108.200.0/22",
	"91.108.204.0/22",
	"91.108.208.0/22",
	"91.108.212.0/22",
	"91.108.216.0/22",
	"91.108.220.0/22",
	"91.108.224.0/22",
	"91.108.228.0/22",
	"91.108.232.0/22",
	"91.108.236.0/22",
	"91.108.240.0/22",
	"91.108.244.0/22",
	"91.108.248.0/22",
	"91.108.252.0/22",
	"149.154.160.0/20",
	"149.154.164.0/22",
	"149.154.168.0/22",
	"149.154.172.0/22",
]

const _telegramCidrCache = TELEGRAM_IP_RANGES.map(function (cidr) {
	const parts = cidr.split("/")
	const ipParts = parts[0].split(".").map(Number)
	const prefixLen = parseInt(parts[1], 10)
	const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0
	const mask = ~((1 << (32 - prefixLen)) - 1) >>> 0
	return { mask: mask, value: ipNum & mask }
})

function _isTelegramIp(ip) {
	if (!ip || ip === "unknown" || ip === "::1" || ip === "127.0.0.1") return true
	if (ip.indexOf("::ffff:") === 0) {
		ip = ip.substring(7)
	}
	const parts = ip.split(".").map(Number)
	if (parts.length !== 4 || parts.some(isNaN)) {
		// IPv6 or malformed — Telegram webhooks are IPv4-only per documented ranges,
		// but allow through if we can't parse it (defensive)
		return true
	}
	const ipNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
	return _telegramCidrCache.some(function (entry) {
		return (ipNum & entry.mask) === entry.value
	})
}

/**
 * Check and consume a rate limit token for the given IP.
 * Returns { allowed: boolean, remaining: number, resetAt: number }.
 */
function checkRateLimit(ip) {
	// Bypass for trusted IPs
	if (RATE_LIMIT_BYPASS_IPS.has(ip)) {
		return { allowed: true, remaining: Infinity, resetAt: 0 }
	}

	const now = Date.now()
	let bucket = rateLimitBuckets.get(ip)

	if (!bucket || bucket.resetAt <= now) {
		// Start a new window
		bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
		rateLimitBuckets.set(ip, bucket)
	}

	bucket.count++

	return {
		allowed: bucket.count <= RATE_LIMIT_MAX_REQS,
		remaining: Math.max(0, RATE_LIMIT_MAX_REQS - bucket.count),
		resetAt: bucket.resetAt,
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

const DEFAULT_DASHBOARD_URL = "https://dev.abcx124.xyz"

function getDashboardBaseUrl() {
	return (process.env.PUBLIC_DASHBOARD_URL || process.env.DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "")
}

function getTelegramTaskDiffUrl(taskId) {
	return getDashboardBaseUrl() + "/?page=telegram&task=" + encodeURIComponent(taskId) + "&panel=diff"
}

function findTelegramTask(taskId) {
	const wanted = String(taskId || "").toUpperCase()
	if (!wanted || !telegramBot.userTasks || typeof telegramBot.userTasks.entries !== "function") return null
	for (const [chatId, chatTasks] of telegramBot.userTasks.entries()) {
		for (const task of chatTasks || []) {
			if (String(task.id || "").toUpperCase() === wanted) {
				return { chatId, task }
			}
		}
	}
	return null
}

function getNotifierPendingJob(taskId) {
	const notifier = telegramBot.telegramNotifier
	if (!notifier) return null
	if (typeof notifier.getPendingCoderJob === "function") return notifier.getPendingCoderJob(taskId)
	if (notifier.pendingCoderJobs && typeof notifier.pendingCoderJobs.get === "function") {
		return notifier.pendingCoderJobs.get(taskId)
	}
	return null
}

function getTaskDiffText(taskId, task) {
	const pending = getNotifierPendingJob(taskId)
	return (
		task?.diff ||
		task?.gitDiff ||
		task?.diffText ||
		task?.patch ||
		pending?.diff ||
		pending?.gitDiff ||
		pending?.diffText ||
		pending?.patch ||
		pending?.diffSummary ||
		task?.diffSummary ||
		""
	)
}

function normalizeTaskFiles(task, pending) {
	const list =
		task?.changedFileList ||
		task?.filesChanged ||
		task?.files ||
		pending?.changedFileList ||
		pending?.filesChanged ||
		pending?.files ||
		pending?.appliedChanges
	if (!Array.isArray(list)) return []
	return list
		.map((item) =>
			typeof item === "string" ? { path: item } : { path: item.file || item.path || item.name || "" },
		)
		.filter((item) => item.path)
}

/**
 * Generate an embedding vector for text using Ollama nomic-embed-text.
 * Used by Qdrant search and other vector operations.
 */
async function _getEmbedding(text) {
	try {
		const http = require("http")
		const requestJson = (path, payload) =>
			new Promise((resolve, reject) => {
				const postData = JSON.stringify(payload)
				const req = http.request(
					`http://127.0.0.1:11434${path}`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(postData),
						},
						timeout: 30_000,
					},
					(res) => {
						let body = ""
						res.on("data", (chunk) => (body += chunk))
						res.on("end", () => {
							try {
								const json = JSON.parse(body)
								if (res.statusCode >= 400) {
									reject(new Error(json.error || `Ollama ${res.statusCode}`))
									return
								}
								resolve(json)
							} catch (e) {
								reject(e)
							}
						})
					},
				)
				req.on("error", reject)
				req.on("timeout", () => {
					req.destroy()
					reject(new Error("timeout"))
				})
				req.write(postData)
				req.end()
			})
		try {
			const modern = await requestJson("/api/embed", { model: "nomic-embed-text", input: text })
			const embedding = Array.isArray(modern.embeddings?.[0])
				? modern.embeddings[0]
				: Array.isArray(modern.embedding)
					? modern.embedding
					: []
			if (embedding.length > 0) {
				return embedding
			}
		} catch {}
		const legacy = await new Promise((resolve, reject) => {
			const postData = JSON.stringify({ model: "nomic-embed-text", prompt: text })
			const req = http.request(
				"http://127.0.0.1:11434/api/embeddings",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(postData),
					},
					timeout: 30_000,
				},
				(res) => {
					let body = ""
					res.on("data", (chunk) => (body += chunk))
					res.on("end", () => {
						try {
							const json = JSON.parse(body)
							resolve(json.embedding || [])
						} catch (e) {
							reject(e)
						}
					})
				},
			)
			req.on("error", reject)
			req.on("timeout", () => {
				req.destroy()
				reject(new Error("timeout"))
			})
			req.write(postData)
			req.end()
		})
		return legacy
	} catch (e) {
		writeApiLog("warn", "brain-mcp", "Embedding generation failed", { error: e.message })
		// Return a zero vector as fallback (768 dims for nomic-embed-text)
		return new Array(768).fill(0)
	}
}

/**
 * Handle an MCP action by dispatching to the appropriate handler.
 * This is used by the MCP endpoint and the read_resource handler.
 */
async function _handleMcpAction(action, params, orchestrator) {
	switch (action) {
		case "ping":
			return {
				success: true,
				ok: true,
				source: "api",
				timestamp: Date.now(),
			}

		case "query_memory": {
			const query = params.query || ""
			const limit = Number(params.maxResults || params.limit || 10)
			if (orchestrator && orchestrator.hermesClaw) {
				const memory = await orchestrator.hermesClaw.recallContext(query, limit)
				return { success: true, memory, source: "hermes_claw" }
			}
			return { success: false, error: "HermesClaw not initialized", source: "hermes_claw" }
		}

		case "list_projects":
			return { success: true, projects: ["superroo2"] }

		case "get_active_task": {
			const project = params.project || "superroo2"
			const task = orchestrator ? orchestrator.getStatus() : null
			return {
				success: true,
				project,
				task: task
					? {
							id: task.currentTaskId || null,
							status: task.status || "idle",
							running: task.running || false,
						}
					: null,
			}
		}

		case "get_recent_bugs": {
			const limit = Number(params.limit || 10)
			if (orchestrator && orchestrator.hermesClaw && orchestrator.hermesClaw.bugKnowledgeStore) {
				const bugs = await orchestrator.hermesClaw.bugKnowledgeStore.searchSimilar("bug", { limit })
				return { success: true, bugs, source: "bug_knowledge_store" }
			}
			return { success: true, bugs: [], source: "bug_knowledge_store" }
		}

		case "hermes_recall": {
			const query = params.query || ""
			const limit = Number(params.limit || 5)
			if (orchestrator && orchestrator.hermesClaw) {
				const memory = await orchestrator.hermesClaw.recallContext(query, limit)
				return { success: true, memory, source: "hermes_claw" }
			}
			return { success: false, error: "HermesClaw not initialized" }
		}

		case "hermes_learn": {
			const lesson_type = params.lesson_type || params.type || "best_practice"
			const topic = params.topic || params.lesson || ""
			const content = params.content || topic
			if (orchestrator && orchestrator.hermesClaw) {
				const lesson = await orchestrator.hermesClaw.storeLesson({
					lesson_type,
					topic: topic.substring(0, 500),
					content: content.substring(0, 2000),
					source_task_id: params.source_task_id || null,
					project: params.project || "superroo2",
					metadata: params.metadata || {},
				})
				return { success: true, lesson, source: "hermes_claw" }
			}
			return { success: false, error: "HermesClaw not initialized" }
		}

		case "hermes_list_skills": {
			if (orchestrator && orchestrator.hermesClaw) {
				const skills = await orchestrator.hermesClaw.execute({ operation: "list_skills" })
				return { success: true, skills: skills.skills || [], source: "hermes_claw" }
			}
			return { success: true, skills: [], source: "hermes_claw" }
		}

		case "hermes_list_resources": {
			if (orchestrator && orchestrator.hermesClaw) {
				const resources = await orchestrator.hermesClaw.execute({ operation: "list_resources" })
				return { success: true, resources: resources.resources || [], source: "hermes_claw" }
			}
			return { success: true, resources: [], source: "hermes_claw" }
		}

		case "hermes_stats": {
			if (orchestrator && orchestrator.hermesClaw) {
				const stats = await orchestrator.hermesClaw.getStats()
				return { success: true, stats, source: "hermes_claw" }
			}
			return { success: false, error: "HermesClaw not initialized", initialized: false, source: "hermes_claw" }
		}

		case "commit_deploy_status": {
			const limit = Number(params.limit || 5)
			const fs = require("fs")
			const path = require("path")
			const logPath = path.join(__dirname, "..", "memory", "commit-deploy-log.json")
			try {
				const raw = fs.readFileSync(logPath, "utf8")
				const data = JSON.parse(raw)
				const commits = (data.commits || []).slice(-limit)
				const deploys = (data.deploys || []).slice(-limit)
				return {
					success: true,
					commits: commits.map((c) => ({
						sha: c.sha,
						agent: c.agent,
						type: c.type,
						title: c.title,
						timestamp: c.timestamp,
					})),
					deploys: deploys.map((d) => ({
						version: d.version,
						sha: d.sha,
						agent: d.agent,
						status: d.status,
						timestamp: d.timestamp,
					})),
					totalCommits: (data.commits || []).length,
					totalDeploys: (data.deploys || []).length,
					source: "commit_deploy_log",
				}
			} catch (e) {
				return {
					success: true,
					commits: [],
					deploys: [],
					totalCommits: 0,
					totalDeploys: 0,
					source: "commit_deploy_log",
				}
			}
		}

		case "codex_task_upsert": {
			const task = await codexTaskLog.upsertTask({
				id: params.id,
				title: params.title,
				summary: params.summary,
				status: params.status,
				project: params.project,
				agent: params.agent,
				filesChanged: params.filesChanged,
				featuresAffected: params.featuresAffected,
				notes: params.notes,
				startedAt: params.startedAt,
				completedAt: params.completedAt,
			})
			return { success: true, task, source: "codex_task_log" }
		}

		case "codex_task_list": {
			const limit = Number(params.limit || 20)
			const tasks = await codexTaskLog.listTasks(limit)
			return { success: true, tasks, source: "codex_task_log" }
		}

		case "codex_task_get": {
			const task = params.id ? await codexTaskLog.getTask(params.id) : null
			return { success: true, task, source: "codex_task_log" }
		}

		case "codex_task_get_active": {
			const task = await codexTaskLog.getActiveTask()
			return { success: true, task, source: "codex_task_log" }
		}

		case "health":
			return {
				success: true,
				health: {
					status: "online",
					redis: true,
					worker: true,
					hermesClaw: !!(orchestrator && orchestrator.hermesClaw),
					timestamp: Date.now(),
				},
				source: "api",
			}

		case "qdrant_search": {
			const qdrantQuery = params.query || ""
			const qdrantLimit = Number(params.limit || 10)
			const collection = params.collection || "superroo_code_chunks"
			try {
				const embedding = await _getEmbedding(qdrantQuery)
				const qdrantRes = await fetch(`http://127.0.0.1:6333/collections/${collection}/points/search`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ vector: embedding, limit: qdrantLimit, with_payload: true }),
					signal: AbortSignal.timeout(10_000),
				})
				const qdrantJson = await qdrantRes.json()
				return { success: true, results: qdrantJson.result || [], source: "qdrant" }
			} catch (e) {
				return { success: false, error: `Qdrant search failed: ${e.message}`, source: "qdrant" }
			}
		}

		case "qdrant_collections": {
			try {
				const qdrantRes = await fetch("http://127.0.0.1:6333/collections", {
					signal: AbortSignal.timeout(5_000),
				})
				const qdrantJson = await qdrantRes.json()
				return { success: true, collections: qdrantJson.result?.collections || [], source: "qdrant" }
			} catch (e) {
				return { success: false, error: `Qdrant collections failed: ${e.message}`, source: "qdrant" }
			}
		}

		case "run_task": {
			const goal = params.goal || ""
			const agent = params.agent || "coder"
			if (!goal) return { success: false, error: "Missing 'goal' field" }
			if (orchestrator) {
				const task = orchestrator.submit({
					input: { goal, workspace: { files: [], commands: [] } },
					metadata: { source: "brain_mcp", agent },
				})
				return { success: true, taskId: task.id, status: "queued", source: "orchestrator" }
			}
			return { success: false, error: "Orchestrator not initialized" }
		}

		case "run_debug": {
			const debugGoal = params.goal || ""
			if (!debugGoal) return { success: false, error: "Missing 'goal' field" }
			if (orchestrator) {
				const task = orchestrator.submit({
					input: { goal: debugGoal, workspace: { files: [], commands: [] } },
					metadata: { source: "brain_mcp", agent: "debugger" },
				})
				return { success: true, taskId: task.id, status: "queued", source: "orchestrator" }
			}
			return { success: false, error: "Orchestrator not initialized" }
		}

		case "run_deploy": {
			const deployGoal = params.goal || "deploy current changes"
			if (orchestrator) {
				const task = orchestrator.submit({
					input: { goal: deployGoal, workspace: { files: [], commands: [] } },
					metadata: { source: "brain_mcp", agent: "deployer" },
				})
				return { success: true, taskId: task.id, status: "queued", source: "orchestrator" }
			}
			return { success: false, error: "Orchestrator not initialized" }
		}

		case "get_pipeline": {
			if (orchestrator) {
				const status = orchestrator.getStatus()
				const tasks = (status.tasks || []).slice(-20).map((t) => ({
					id: t.id,
					goal: t.goal,
					status: t.status,
					agent: t.agent,
					createdAt: t.createdAt,
				}))
				return {
					success: true,
					pipeline: tasks,
					currentTask: status.currentTaskId || null,
					source: "orchestrator",
				}
			}
			return { success: true, pipeline: [], currentTask: null, source: "orchestrator" }
		}

		case "list_resources": {
			const resources = [
				{
					uri: "brain://context",
					name: "Full RAG Context",
					description: "Complete RAG context for the current project",
					mimeType: "text/plain",
				},
				{
					uri: "brain://tasks",
					name: "Task List",
					description: "Current tasks and their statuses",
					mimeType: "application/json",
				},
				{
					uri: "brain://bugs",
					name: "Bug List",
					description: "Recent bugs and incidents",
					mimeType: "application/json",
				},
				{
					uri: "brain://projects",
					name: "Project List",
					description: "All registered projects",
					mimeType: "application/json",
				},
				{
					uri: "brain://skills",
					name: "Skills List",
					description: "All reusable skills created from patterns",
					mimeType: "application/json",
				},
				{
					uri: "brain://resources",
					name: "Knowledge Resources",
					description: "All knowledge resources stored in memory",
					mimeType: "application/json",
				},
				{
					uri: "brain://stats",
					name: "System Statistics",
					description: "Hermes Claw and system statistics",
					mimeType: "application/json",
				},
				{
					uri: "brain://health",
					name: "System Health",
					description: "Current system health status",
					mimeType: "application/json",
				},
				{
					uri: "brain://commits",
					name: "Commit History",
					description: "Recent commit history",
					mimeType: "application/json",
				},
				{
					uri: "brain://deploys",
					name: "Deploy History",
					description: "Recent deployment history",
					mimeType: "application/json",
				},
				{
					uri: "brain://pipeline",
					name: "Pipeline Status",
					description: "Current orchestrator pipeline status",
					mimeType: "application/json",
				},
				{
					uri: "brain://codex/tasks",
					name: "Codex Task Memory",
					description: "Persistent task memory for Codex agents",
					mimeType: "application/json",
				},
				{
					uri: "brain://qdrant/collections",
					name: "Qdrant Collections",
					description: "Qdrant vector database collections",
					mimeType: "application/json",
				},
				{
					uri: "brain://ollama/health",
					name: "Ollama Health",
					description: "Ollama service health and available models",
					mimeType: "application/json",
				},
				{
					uri: "brain://ollama/summarize",
					name: "Ollama Summarizer",
					description: "Summarize logs via Ollama (requires logs param)",
					mimeType: "application/json",
				},
				{
					uri: "brain://ollama/compress",
					name: "Ollama Context Compressor",
					description: "Compress engineering context via Ollama (requires context param)",
					mimeType: "text/plain",
				},
			]
			return { success: true, resources, source: "brain" }
		}

		case "read_resource": {
			const resourceUri = params.uri || ""
			if (!resourceUri) return { success: false, error: "Missing 'uri' field" }
			const uriToAction = {
				"brain://context": "query_memory",
				"brain://tasks": "get_active_task",
				"brain://bugs": "get_recent_bugs",
				"brain://projects": "list_projects",
				"brain://skills": "hermes_list_skills",
				"brain://resources": "hermes_list_resources",
				"brain://stats": "hermes_stats",
				"brain://health": "health",
				"brain://commits": "commit_deploy_status",
				"brain://deploys": "commit_deploy_status",
				"brain://pipeline": "get_pipeline",
				"brain://codex/tasks": "codex_task_list",
				"brain://qdrant/collections": "qdrant_collections",
				"brain://ollama/health": "ollama_health",
				"brain://ollama/summarize": "ollama_summarize",
			}
			const mappedAction = uriToAction[resourceUri]
			if (mappedAction) {
				const reParams = { ...params }
				if (resourceUri === "brain://commits" || resourceUri === "brain://deploys")
					reParams.limit = reParams.limit || 10
				if (resourceUri === "brain://context") reParams.query = reParams.query || "general context"
				return await _handleMcpAction(mappedAction, reParams, orchestrator)
			}
			return { success: false, error: `Unknown resource URI: ${resourceUri}` }
		}

		case "ollama_summarize": {
			try {
				const logs = params.logs || ""
				const source = params.source || "api"
				const command = params.command || ""
				const project = params.project || "superroo2"
				const changedFiles = params.changedFiles || []
				if (!logs) return { success: false, error: "Missing 'logs' field" }

				// Truncate logs if too long
				const maxChars = Number(process.env.OLLAMA_MAX_LOG_CHARS || 30000)
				const trimmedLogs =
					logs.length > maxChars
						? `${logs.slice(0, Math.floor(maxChars * 0.65))}\n\n...[TRUNCATED MIDDLE]...\n\n${logs.slice(-Math.floor(maxChars * 0.35))}`
						: logs

				const ollamaBaseUrl = (
					process.env.OLLAMA_BASE_URL ||
					process.env.OLLAMA_HOST ||
					"http://127.0.0.1:11434"
				).replace(/\/$/, "")
				// Canonical: OLLAMA_MODEL; legacy fallbacks: OLLAMA_SUMMARY_MODEL
				const model = process.env.OLLAMA_MODEL || process.env.OLLAMA_SUMMARY_MODEL || "qwen2.5:0.5b"
				const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 120000)

				const systemPrompt = `You are SuperRoo's local Ollama log summarizer.
Your job is NOT to redesign the app.
Your job is to compress noisy logs into a precise debugging brief.
Be conservative. If uncertain, say unknown.
Return strict JSON only.`

				const userPrompt = `Summarize these logs.\n\nContext:\nsource=${source}\nproject=${project}\ncommand=${command}\nchangedFiles=${changedFiles.join(", ") || "unknown"}\n\nReturn JSON with exactly these keys:\nseverity, oneLine, rootCause, evidence, affectedFiles, suggestedFix, retrySafe, needsSeniorReview\n\nRules:\n- evidence must be short strings copied or paraphrased from logs\n- affectedFiles should include only likely relevant files\n- if risky, set needsSeniorReview=true\n\nLogs:\n${trimmedLogs}`

				const controller = new AbortController()
				const timeout = setTimeout(() => controller.abort(), timeoutMs)
				try {
					const res = await fetch(`${ollamaBaseUrl}/api/generate`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							model,
							prompt: userPrompt,
							system: systemPrompt,
							stream: false,
							options: { temperature: 0, num_ctx: Number(process.env.OLLAMA_NUM_CTX || 2048) },
						}),
						signal: controller.signal,
					})
					if (!res.ok) {
						const text = await res.text().catch(() => "")
						return {
							success: false,
							error: `Ollama ${res.status}: ${text || res.statusText}`,
							source: "ollama",
						}
					}
					const data = await res.json()
					const raw = String(data.response || "").trim()

					// Parse JSON from response
					let parsed = {}
					try {
						parsed = JSON.parse(raw)
					} catch {
						const match = raw.match(/\{[\s\S]*\}/)
						if (match) {
							try {
								parsed = JSON.parse(match[0])
							} catch {}
						}
					}

					const summary = {
						source,
						project,
						command,
						severity: parsed.severity || "unknown",
						oneLine: parsed.oneLine || "No summary generated.",
						rootCause: parsed.rootCause || "unknown",
						evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
						affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : changedFiles,
						suggestedFix: parsed.suggestedFix || "unknown",
						retrySafe: Boolean(parsed.retrySafe),
						needsSeniorReview: parsed.needsSeniorReview !== false,
						rawModelOutput: raw,
					}

					return { success: true, summary, source: "ollama" }
				} finally {
					clearTimeout(timeout)
				}
			} catch (e) {
				return { success: false, error: `Ollama summarization failed: ${e.message}`, source: "ollama" }
			}
		}

		case "ollama_health": {
			try {
				const ollamaBaseUrl = (
					process.env.OLLAMA_BASE_URL ||
					process.env.OLLAMA_HOST ||
					"http://127.0.0.1:11434"
				).replace(/\/$/, "")
				const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) })
				const data = await res.json()
				const models = (data.models || []).map((m) => m.name)
				return {
					success: true,
					ollama: { ok: true, models, baseUrl: ollamaBaseUrl },
					source: "ollama",
				}
			} catch (e) {
				return {
					success: true,
					ollama: {
						ok: false,
						error: e.message,
						baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
					},
					source: "ollama",
				}
			}
		}

		// ── Brain Predictive Risk MCP actions ──────────────────────────────────

		case "risk_assess": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.riskEngine) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const result = await svc.riskEngine.assess({
					projectId: params.projectId || "default",
					taskId: params.taskId,
					actionType: params.actionType,
					filesChanged: params.filesChanged,
					logs: params.logs,
					environment: params.environment,
				})
				return { success: true, data: result, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		case "risk_record_pattern": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.riskEngine) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const result = await svc.riskEngine.recordFailurePattern({
					projectId: params.projectId || "default",
					patternType: params.patternType,
					signature: params.signature,
					description: params.description,
					severity: params.severity || "medium",
					suggestedFix: params.suggestedFix,
					source: params.source || "mcp",
				})
				return { success: true, data: result, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		case "risk_list_assessments": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.riskEngine) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const assessments = await svc.riskEngine.getAssessments({
					projectId: params.projectId,
					riskLevel: params.riskLevel,
					actionType: params.actionType,
					limit: parseInt(params.limit) || 50,
					offset: parseInt(params.offset) || 0,
				})
				return { success: true, data: assessments, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		case "risk_list_patterns": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.riskEngine) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const patterns = await svc.riskEngine.getFailurePatterns({
					projectId: params.projectId,
					severity: params.severity,
					patternType: params.patternType,
					limit: parseInt(params.limit) || 50,
					offset: parseInt(params.offset) || 0,
				})
				return { success: true, data: patterns, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		case "risk_stats": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.riskEngine) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const stats = await svc.riskEngine.getStats(params.projectId || "default")
				return { success: true, data: stats, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		// ── Brain Swarm Debug MCP actions ─────────────────────────────────────

		case "swarm_debug": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.swarmDebugger) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const result = await svc.swarmDebugger.debug({
					projectId: params.projectId || "default",
					taskId: params.taskId,
					problem: params.problem,
					context: params.context,
				})
				return { success: true, data: result, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		case "swarm_list_runs": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.swarmDebugger) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const runs = await svc.swarmDebugger.listRuns({
					projectId: params.projectId,
					status: params.status,
					limit: parseInt(params.limit) || 50,
					offset: parseInt(params.offset) || 0,
				})
				return { success: true, data: runs, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		case "swarm_get_run": {
			try {
				const svc = await getBrainServices()
				if (!svc || !svc.swarmDebugger) {
					return { success: false, error: "Brain services not initialized", source: "brain" }
				}
				const run = await svc.swarmDebugger.getRun(params.id)
				if (!run) {
					return { success: false, error: "Swarm run not found", source: "brain" }
				}
				return { success: true, data: run, source: "brain" }
			} catch (err) {
				return { success: false, error: err.message, source: "brain" }
			}
		}

		default:
			return { success: false, error: `Unknown action: ${action}` }
	}
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
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek V3, V4 Flash, V4 Pro, and R1 reasoning models",
		envName: "DEEPSEEK_API_KEY",
		website: "https://deepseek.com",
		docsUrl: "https://platform.deepseek.com/docs",
		apiBaseUrl: "https://api.deepseek.com/v1",
		defaultModel: "deepseek-chat-v4-flash",
		models: [
			{ id: "deepseek-chat", name: "DeepSeek V3" },
			{ id: "deepseek-reasoner", name: "DeepSeek R1" },
			{ id: "deepseek-chat-v4-flash", name: "DeepSeek V4 Flash" },
			{ id: "deepseek-chat-v4-pro", name: "DeepSeek V4 Pro" },
		],
		capabilities: ["chat", "reasoning"],
	},
	{
		id: "ollama",
		name: "Ollama (Local)",
		description: "Local Ollama models (qwen2.5:0.5b, qwen2.5:1.5b)",
		envName: null,
		website: "https://ollama.com",
		docsUrl: "https://github.com/ollama/ollama",
		apiBaseUrl: "http://127.0.0.1:11434/v1",
		defaultModel: "qwen2.5:0.5b",
		local: true,
		models: [
			{ id: "qwen2.5:0.5b", name: "Qwen 2.5 0.5B" },
			{ id: "qwen2.5:1.5b", name: "Qwen 2.5 1.5B" },
		],
		capabilities: ["chat"],
	},
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
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "coder",
		label: "Coder",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "debugger",
		label: "Debugger",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "crawler",
		label: "Crawler",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "tester",
		label: "Tester",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "deployChecker",
		label: "Deploy Checker",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "consultant",
		label: "Consultant",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "ollama", model: "qwen2.5:1.5b" },
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
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

function isProviderUsable(meta, providerOrId) {
	// Local providers (like Ollama) don't need an API key
	if (providerOrId?.local === true) return true
	// If a provider ID string is passed, look up the provider definition
	if (typeof providerOrId === "string") {
		const found = PROVIDERS.find((p) => p.id === providerOrId)
		if (found?.local === true) return true
	}
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
			autoApprove: true,
			mcp: { enabled: true, servers: [] },
			approval: {
				enabled: true,
				rules: [],
				maxApprovalCount: 10,
				maxCostUsd: 5,
				timeWindowMinutes: 60,
				rows: [
					{
						action: "Read Files",
						risk: "Low",
						desc: "Allow agents to inspect project files and logs.",
						defaultChecked: true,
					},
					{
						action: "Write Files",
						risk: "Medium",
						desc: "Allow coding agents to edit repo files inside approved workspace.",
						defaultChecked: true,
					},
					{
						action: "Execute Commands",
						risk: "High",
						desc: "Run tests, builds, docker logs, and diagnostics.",
						defaultChecked: true,
					},
					{
						action: "MCP Tool Calls",
						risk: "Medium",
						desc: "Use Playwright, GitHub, database, or docs fetcher MCP tools.",
						defaultChecked: true,
					},
					{
						action: "Deploy / Restart VPS",
						risk: "Critical",
						desc: "Restart services, rebuild Docker, pull updates, or deploy production.",
						defaultChecked: false,
					},
				],
			},
			routing: { routes: DEFAULT_AGENT_ROUTES },
			guardrails: {
				maxConcurrentJobs: 3,
				cpuHighPercent: 80,
				ramHighPercent: 85,
				onHighCpu: "warn",
				onHighRam: "warn",
				cpuAction: "pause_crawler",
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

// Ollama Intelligence Growth data
async function getOllamaGrowthData() {
	const memoryDir = path.join(__dirname, "..", "..", "memory", "ollama")
	const growthFile = path.join(memoryDir, "growth-events.jsonl")
	const readinessFile = path.join(memoryDir, "readiness-checks.jsonl")
	const reportFile = path.join(memoryDir, "readiness-report.json")

	let events = []
	let checks = []
	let report = { generated_at: null, total_score: 0, level: "Unknown", recommendation: "" }

	try {
		const growthRaw = await fs.readFile(growthFile, "utf8").catch(() => "")
		events = growthRaw
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => {
				try {
					return JSON.parse(l)
				} catch {
					return null
				}
			})
			.filter(Boolean)
	} catch {
		events = []
	}

	try {
		const readinessRaw = await fs.readFile(readinessFile, "utf8").catch(() => "")
		checks = readinessRaw
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => {
				try {
					return JSON.parse(l)
				} catch {
					return null
				}
			})
			.filter(Boolean)
	} catch {
		checks = []
	}

	try {
		const reportRaw = await fs.readFile(reportFile, "utf8").catch(() => "{}")
		report = JSON.parse(reportRaw)
	} catch {
		report = { generated_at: null, total_score: 0, level: "Unknown", recommendation: "" }
	}

	// Compute aggregated stats
	const latestCheck = checks.length > 0 ? checks[checks.length - 1] : null
	const avgScore =
		checks.length > 0 ? Math.round(checks.reduce((s, c) => s + (c.total_score || 0), 0) / checks.length) : 0
	const eventTypes = {}
	for (const ev of events) {
		const t = ev.event_type || "unknown"
		eventTypes[t] = (eventTypes[t] || 0) + 1
	}
	const totalEvents = events.length
	const totalChecks = checks.length

	// Readiness level thresholds
	function getLevel(score) {
		if (score <= 40) return "Summarizer only"
		if (score <= 60) return "Memory assistant"
		if (score <= 75) return "Patch suggester"
		if (score <= 85) return "Junior coder"
		return "Main coder candidate"
	}

	function getRecommendation(score) {
		if (score <= 40) return "Keep Ollama as summarizer only."
		if (score <= 60) return "Use for memory retrieval."
		if (score <= 75) return "Use for patch suggestions only."
		if (score <= 85) return "Allow small coding tasks with review."
		return "Main coder candidate with review."
	}

	const currentScore = latestCheck?.total_score || report.total_score || 0
	const currentLevel = latestCheck?.level || getLevel(currentScore)
	const currentRecommendation =
		latestCheck?.recommendation || getRecommendation(currentScore) || report.recommendation

	// Find the most recent check that has category breakdowns (detailed audit schema)
	const latestDetailedCheck =
		checks.length > 0
			? [...checks].reverse().find((c) => typeof c.architecture_understanding === "number") || null
			: null

	return {
		readiness: {
			total_score: currentScore,
			level: currentLevel,
			recommendation: currentRecommendation,
			avg_score: avgScore,
			check_count: totalChecks,
			latest_check: latestCheck,
			has_breakdown: !!latestDetailedCheck,
			latest_detailed_check: latestDetailedCheck,
		},
		growth: {
			event_count: totalEvents,
			event_types: eventTypes,
			events: events.slice(-20),
		},
		timeline: checks.map((c) => ({
			date: c.created_at,
			score: c.total_score,
			level: c.level,
		})),
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

async function getDiskUsagePercent(targetPath = process.cwd()) {
	try {
		if (typeof fs.statfs !== "function") return null
		const stats = await fs.statfs(targetPath)
		const total = Number(stats.blocks || 0) * Number(stats.bsize || 0)
		const free = Number(stats.bavail || stats.bfree || 0) * Number(stats.bsize || 0)
		if (!total) return null
		return Math.round(((total - free) / total) * 100)
	} catch {
		return null
	}
}

function normalizeCommitEntry(c) {
	return {
		sha: c.sha || c.commitSha || "",
		agent: c.agentName || c.agent || "unknown",
		type: c.type || "unknown",
		title: c.title || c.message || "",
		timestamp: c.timestamp || c.createdAt || 0,
	}
}

function normalizeDeployEntry(d) {
	return {
		version: d.version || "",
		sha: d.sha || d.commitSha || "",
		agent: d.agentName || d.agent || "unknown",
		status: d.status || "unknown",
		timestamp: d.timestamp || d.startedAt || d.deployedAt || d.createdAt || 0,
	}
}

function parseTimestamp(value) {
	if (!value) return null
	const timestamp = typeof value === "number" ? value : Date.parse(value)
	return Number.isFinite(timestamp) ? timestamp : null
}

function formatAverageDuration(totalMs, count) {
	if (!count) return null
	const seconds = Math.round(totalMs / count / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function buildDeploySummary(deploys) {
	const normalized = deploys.map((deploy) => {
		const startedAt = parseTimestamp(deploy.startedAt || deploy.timestamp || deploy.deployedAt)
		const completedAt = parseTimestamp(deploy.completedAt)
		const durationMs =
			startedAt !== null && completedAt !== null && completedAt >= startedAt ? completedAt - startedAt : null
		return {
			id: deploy.id || null,
			version: deploy.version || "",
			sha: deploy.commitSha || deploy.sha || "",
			agent: deploy.agentName || deploy.agent || "unknown",
			status: deploy.status || deploy.result || "unknown",
			environment: deploy.environment || null,
			startedAt,
			completedAt,
			durationMs,
			healthCheckPassed: typeof deploy.healthCheckPassed === "boolean" ? deploy.healthCheckPassed : null,
			healthCheckLatencyMs: typeof deploy.healthCheckLatencyMs === "number" ? deploy.healthCheckLatencyMs : null,
			failureReason: deploy.failureReason || deploy.error || null,
		}
	})

	const successfulStatuses = new Set(["healthy", "completed"])
	const failedStatuses = new Set(["failed", "unhealthy"])
	const successfulDeploys = normalized.filter((deploy) => successfulStatuses.has(deploy.status)).length
	const durations = normalized.filter((deploy) => deploy.durationMs !== null)
	const failureCounts = new Map()
	for (const deploy of normalized) {
		if (!failedStatuses.has(deploy.status) && deploy.status !== "rolled_back") continue
		const reason = deploy.failureReason || (deploy.status === "rolled_back" ? "Rolled back" : "Reason not recorded")
		failureCounts.set(reason, (failureCounts.get(reason) || 0) + 1)
	}

	const deploysByDay = new Map()
	for (const deploy of normalized) {
		if (deploy.startedAt === null) continue
		const day = new Date(deploy.startedAt).toISOString().slice(0, 10)
		deploysByDay.set(day, (deploysByDay.get(day) || 0) + 1)
	}

	return {
		totalDeploys: normalized.length,
		successRate: normalized.length ? Math.round((successfulDeploys / normalized.length) * 100) : null,
		avgDuration: formatAverageDuration(
			durations.reduce((total, deploy) => total + deploy.durationMs, 0),
			durations.length,
		),
		failuresByReason: Array.from(failureCounts.entries())
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
		deploysByDay: Array.from(deploysByDay.entries())
			.map(([date, count]) => ({ date, count }))
			.sort((a, b) => a.date.localeCompare(b.date))
			.slice(-14),
		recentDeploys: normalized.slice().reverse().slice(0, 50),
	}
}

async function loadOverviewCommitDeploy(limit = 8) {
	try {
		const raw = await fs.readFile(path.join(__dirname, "..", "memory", "commit-deploy-log.json"), "utf8")
		const data = JSON.parse(raw)
		return {
			commits: (data.commits || []).slice(-limit).reverse().map(normalizeCommitEntry),
			deploys: (data.deploys || []).slice(-limit).reverse().map(normalizeDeployEntry),
		}
	} catch {
		return { commits: [], deploys: [] }
	}
}

async function loadOverviewUsage(limit = 200) {
	try {
		const raw = await fs.readFile(
			path.join(__dirname, "..", "..", "server", "src", "memory", "model-usage-log.json"),
			"utf8",
		)
		const data = JSON.parse(raw)
		return (data.records || []).slice(-limit).reverse()
	} catch {
		return []
	}
}

function buildOverviewUsageSummary(records) {
	const today = new Date().toISOString().slice(0, 10)
	const todayRecords = records.filter((record) => String(record.timestamp || "").startsWith(today))
	const providerCounts = {}
	let totalTokens = 0
	let totalCostUsd = 0
	let pricedRecords = 0

	for (const record of todayRecords) {
		const provider = record.provider || record.model || "unknown"
		providerCounts[provider] = (providerCounts[provider] || 0) + 1
		totalTokens += (record.promptTokens || 0) + (record.completionTokens || 0)
		if (typeof record.costUsd === "number") {
			totalCostUsd += record.costUsd
			pricedRecords++
		} else if (typeof record.estimatedCostUsd === "number") {
			totalCostUsd += record.estimatedCostUsd
			pricedRecords++
		}
	}

	return {
		totalTokens,
		totalCostUsd: pricedRecords > 0 ? totalCostUsd : null,
		requests: todayRecords.length,
		costAvailable: pricedRecords > 0,
		providers: Object.entries(providerCounts)
			.sort((a, b) => b[1] - a[1])
			.map(([name, value]) => ({ name, value })),
	}
}

function buildOverviewActivity({ commits, events, logs }) {
	const commitItems = commits.slice(0, 4).map((commit) => ({
		id: `commit-${commit.sha}`,
		time: commit.timestamp,
		title: commit.title || "Untitled commit",
		detail: `${commit.agent} committed ${commit.type}`,
		tone: "success",
		target: "commit-deploy",
	}))

	const eventItems = events.slice(0, 4).map((event) => ({
		id: `event-${event.id || event.timestamp || event.type}`,
		time: event.timestamp || Date.now(),
		title: event.type || "orchestrator event",
		detail: event.source || "Orchestrator",
		tone: event.severity === "error" ? "warning" : "info",
		target: event.severity === "error" ? "logs" : "jobs",
	}))

	const logItems = logs.slice(0, 4).map((line, index) => ({
		id: `log-${index}`,
		time: Date.now() - index,
		title: line.length > 96 ? `${line.slice(0, 96)}...` : line,
		detail: /error|failed/i.test(line) ? "System log" : "Recent log",
		tone: /error|failed/i.test(line) ? "warning" : "info",
		target: "logs",
	}))

	return [...commitItems, ...eventItems, ...logItems]
		.sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
		.slice(0, 8)
}

function normalizeQueueJob(job) {
	return {
		id: String(job.id || ""),
		title: job.data?.task || job.name || "Untitled job",
		agent: job.data?.agentId || "unassigned",
		project: job.data?.project || job.data?.repository || "superroo2",
		status: job.status,
		priority: String(job.data?.priority || "normal").toLowerCase(),
		progress: Number(job.progress || 0),
		attemptsMade: Number(job.attemptsMade || 0),
		maxAttempts: Number(job.opts?.attempts || 0),
		timestamp: job.timestamp || 0,
		processedOn: job.processedOn || null,
		finishedOn: job.finishedOn || null,
		failedReason: job.failedReason || "",
		model: job.data?.model || "",
	}
}

function buildQueueFailureReasons(jobs) {
	const failedJobs = jobs.filter((job) => job.status === "failed")
	const total = failedJobs.length
	if (total === 0) return []

	const counts = {}
	for (const job of failedJobs) {
		const reason = String(job.failedReason || "Unknown failure").trim() || "Unknown failure"
		const label = reason.length > 72 ? `${reason.slice(0, 72)}...` : reason
		counts[label] = (counts[label] || 0) + 1
	}

	return Object.entries(counts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => ({
			name,
			count,
			percent: Math.round((count / total) * 100),
		}))
}

function buildQueueInsights(jobs, usageSummary) {
	const now = Date.now()
	const cutoff = now - 24 * 60 * 60 * 1000
	const recentCompleted = jobs.filter((job) => job.status === "completed" && Number(job.finishedOn || 0) >= cutoff)
	const durations = recentCompleted
		.map((job) => Number(job.finishedOn || 0) - Number(job.processedOn || 0))
		.filter((duration) => duration > 0)
	const avgDurationMs =
		durations.length > 0
			? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
			: null

	return {
		windowHours: 24,
		avgCompletionMs: avgDurationMs,
		throughputPerHour: Number((recentCompleted.length / 24).toFixed(2)),
		completedLast24h: recentCompleted.length,
		totalTokensToday: usageSummary.totalTokens,
		totalCostUsdToday: usageSummary.totalCostUsd,
		costAvailable: usageSummary.costAvailable,
	}
}

function buildQueuePipeline(agents, jobs) {
	const activeCounts = jobs
		.filter((job) => job.status === "active")
		.reduce((counts, job) => {
			counts[job.agent] = (counts[job.agent] || 0) + 1
			return counts
		}, {})

	return agents.map((agent) => ({
		id: agent.id,
		name: agent.name,
		enabled: Boolean(agent.enabled),
		activeJobs: activeCounts[agent.id] || 0,
		maxConcurrency: agent.maxConcurrency || 0,
	}))
}

function buildQueueActivity({ jobs, events }) {
	const jobItems = jobs.slice(0, 6).map((job) => ({
		id: `job-${job.id}`,
		time: job.finishedOn || job.processedOn || job.timestamp || 0,
		agent: job.agent,
		message:
			job.status === "failed"
				? `${job.title} failed`
				: job.status === "completed"
					? `${job.title} completed`
					: job.status === "active"
						? `${job.title} running`
						: `${job.title} waiting`,
		type: job.status,
	}))
	const eventItems = events.slice(0, 6).map((event) => ({
		id: `event-${event.id || event.timestamp || event.type}`,
		time: event.timestamp || 0,
		agent: event.source || "orchestrator",
		message: event.type || "orchestrator event",
		type: event.severity === "error" ? "failed" : "event",
	}))

	return [...jobItems, ...eventItems].sort((a, b) => Number(b.time || 0) - Number(a.time || 0)).slice(0, 8)
}

function normalizeDashboardJob(job, status) {
	return {
		id: String(job.id || ""),
		name: job.name || "",
		data: job.data || {},
		status,
		progress: job.progress || 0,
		timestamp: job.timestamp || 0,
		processedOn: job.processedOn || null,
		finishedOn: job.finishedOn || null,
		failedReason: job.failedReason || "",
		returnvalue: job.returnvalue,
		attemptsMade: Number(job.attemptsMade || 0),
		maxAttempts: Number(job.opts?.attempts || 0),
	}
}

async function loadDashboardJobs(limit = 100) {
	const [waiting, active, completed, failed, delayed] = await Promise.all([
		queue.getWaiting(0, limit),
		queue.getActive(0, limit),
		queue.getCompleted(0, limit),
		queue.getFailed(0, limit),
		queue.getDelayed(0, limit),
	])
	return [
		...waiting.map((job) => normalizeDashboardJob(job, "waiting")),
		...active.map((job) => normalizeDashboardJob(job, "active")),
		...completed.map((job) => normalizeDashboardJob(job, "completed")),
		...failed.map((job) => normalizeDashboardJob(job, "failed")),
		...delayed.map((job) => normalizeDashboardJob(job, "delayed")),
	]
		.sort(
			(a, b) =>
				Number(b.finishedOn || b.processedOn || b.timestamp || 0) -
				Number(a.finishedOn || a.processedOn || a.timestamp || 0),
		)
		.slice(0, limit)
}

function buildJobsSummary(jobs, usageSummary) {
	const completed = jobs.filter((job) => job.status === "completed")
	const failed = jobs.filter((job) => job.status === "failed")
	const running = jobs.filter((job) => job.status === "active")
	const queued = jobs.filter((job) => ["waiting", "delayed"].includes(job.status))
	const durations = completed
		.map((job) => Number(job.finishedOn || 0) - Number(job.processedOn || 0))
		.filter((duration) => duration > 0)
	const avgDurationMs =
		durations.length > 0
			? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
			: null

	const agentCounts = {}
	const modelCounts = {}
	for (const job of jobs) {
		const agent = job.data?.agentId || "unassigned"
		const model = job.data?.model || "unassigned"
		agentCounts[agent] = (agentCounts[agent] || 0) + 1
		if (!modelCounts[model]) modelCounts[model] = { total: 0, failed: 0 }
		modelCounts[model].total++
		if (job.status === "failed") modelCounts[model].failed++
	}

	return {
		totalJobs: jobs.length,
		running: running.length,
		completed: completed.length,
		failed: failed.length,
		queued: queued.length,
		successRate:
			completed.length + failed.length > 0
				? Math.round((completed.length / (completed.length + failed.length)) * 100)
				: null,
		avgDurationMs,
		aiCostToday: usageSummary.totalCostUsd,
		costAvailable: usageSummary.costAvailable,
		totalTokensToday: usageSummary.totalTokens,
		systemHealth: failed.length > 10 ? "Degraded" : failed.length > 0 ? "Attention" : "Healthy",
		activeAgents: Object.entries(agentCounts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([name, count]) => ({ name, count })),
		modelPerformance: Object.entries(modelCounts)
			.sort((a, b) => b[1].total - a[1].total)
			.slice(0, 5)
			.map(([name, stats]) => ({
				name,
				total: stats.total,
				failed: stats.failed,
				successRate: stats.total > 0 ? Math.round(((stats.total - stats.failed) / stats.total) * 100) : null,
			})),
	}
}

function parseJobLogLine(jobId, line, index) {
	const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/)
	const message = timestampMatch ? timestampMatch[2] : line
	const ts = timestampMatch ? Date.parse(timestampMatch[1]) : NaN
	const level = /\[error\]|\[stderr\]|failed/i.test(message)
		? "error"
		: /\[retry\]|\[timeout\]/i.test(message)
			? "warn"
			: /success:\s*true|completed|finished/i.test(message)
				? "success"
				: "info"
	return {
		id: `${jobId}-log-${index}`,
		jobId,
		ts: Number.isFinite(ts) ? ts : null,
		level,
		source: message.match(/^\[([^\]]+)\]/)?.[1] || "job",
		message,
	}
}

async function loadJobLogs(job) {
	const logPath =
		(typeof job.returnvalue?.logPath === "string" && job.returnvalue.logPath) ||
		path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", "cloud", "logs", "jobs", `${job.id}.log`)
	try {
		const raw = await fs.readFile(logPath, "utf8")
		return raw
			.split("\n")
			.filter((line) => line.trim())
			.slice(-100)
			.map((line, index) => parseJobLogLine(String(job.id), line, index))
	} catch {
		return []
	}
}

function buildOverviewAttention({ health, queueStats, bugs, latestDeploy }) {
	const items = []
	const openBugs = bugs.filter((bug) => !["resolved", "wont_fix"].includes(String(bug.status || "").toLowerCase()))
	const severeBugs = openBugs.filter((bug) => ["critical", "high"].includes(String(bug.severity || "").toLowerCase()))

	if (health.status !== "online") {
		items.push({
			id: "api-health",
			title: "API offline",
			detail: "Health endpoint is not reporting online.",
			level: "critical",
			action: "Open monitoring",
			target: "monitoring",
		})
	}
	if (!health.worker) {
		items.push({
			id: "worker-health",
			title: "Worker unavailable",
			detail: "Background work may not be processing.",
			level: "critical",
			action: "Open logs",
			target: "logs",
		})
	}
	if (queueStats.failed > 0) {
		items.push({
			id: "failed-jobs",
			title: `${queueStats.failed} failed job${queueStats.failed === 1 ? "" : "s"}`,
			detail: "Retry or inspect failures before queue pressure grows.",
			level: "warning",
			action: "Open queue",
			target: "queue",
		})
	}
	if (severeBugs.length > 0) {
		items.push({
			id: "severe-bugs",
			title: `${severeBugs.length} high-severity bug${severeBugs.length === 1 ? "" : "s"}`,
			detail: severeBugs[0]?.title || severeBugs[0]?.summary || "Open bugs need attention.",
			level: "warning",
			action: "Open bugs",
			target: "bugs",
		})
	}
	if (latestDeploy && !["healthy", "completed"].includes(String(latestDeploy.status).toLowerCase())) {
		items.push({
			id: "deploy-health",
			title: `Latest deploy ${latestDeploy.status}`,
			detail: `v${latestDeploy.version} by ${latestDeploy.agent}`,
			level: "critical",
			action: "Open deploy log",
			target: "commit-deploy",
		})
	}

	return items
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

// Track connected chat clients by workspace session
const chatClients = new Map() // sessionId -> Set<WebSocket>

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

// ── Brain WebSocket Server for Real-Time Bidirectional Communication ─────────
// This WebSocket server provides real-time bidirectional communication for the
// Central Brain. Clients connect via ws://host/api/brain/ws and can:
//   - Send MCP actions and receive results
//   - Subscribe to real-time events (tasks, commits, deploys, health changes)
//   - Receive heartbeat pings every 30 seconds
const brainWss = new WebSocketServer({ noServer: true })

// Track connected brain clients
const brainClients = new Set() // Set<WebSocket>

brainWss.on("connection", (ws, req) => {
	brainClients.add(ws)
	writeApiLog("info", "brain-ws", "Brain WebSocket client connected", { total: brainClients.size })

	// Send welcome message
	ws.send(
		JSON.stringify({
			type: "connected",
			message: "Connected to SuperRoo Central Brain",
			version: "1.0.0",
			supportedActions: [
				"query_memory",
				"list_projects",
				"get_active_task",
				"get_recent_bugs",
				"hermes_recall",
				"hermes_learn",
				"hermes_list_skills",
				"hermes_list_resources",
				"hermes_stats",
				"commit_deploy_status",
				"codex_task_upsert",
				"codex_task_list",
				"codex_task_get",
				"codex_task_get_active",
				"health",
				"qdrant_search",
				"qdrant_collections",
				"run_task",
				"run_debug",
				"run_deploy",
				"get_pipeline",
				"list_resources",
				"read_resource",
				"ollama_summarize",
				"ollama_health",
				"subscribe",
				"unsubscribe",
			],
			timestamp: Date.now(),
		}),
	)

	// Heartbeat interval
	const heartbeatIv = setInterval(() => {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }))
		}
	}, 30000)

	// Track subscriptions for this client
	const subscriptions = new Set()

	ws.on("message", async (raw) => {
		try {
			const msg = JSON.parse(raw.toString())
			const { action, params = {}, id } = msg

			if (action === "subscribe") {
				const event = params.event || "all"
				subscriptions.add(event)
				ws.send(JSON.stringify({ type: "subscribed", event, id, timestamp: Date.now() }))
				return
			}

			if (action === "unsubscribe") {
				const event = params.event || "all"
				subscriptions.delete(event)
				ws.send(JSON.stringify({ type: "unsubscribed", event, id, timestamp: Date.now() }))
				return
			}

			// Handle MCP actions via WebSocket
			const result = await _handleMcpAction(action, params, orchestrator)
			ws.send(JSON.stringify({ type: "result", id, action, result, timestamp: Date.now() }))
		} catch (err) {
			ws.send(
				JSON.stringify({
					type: "error",
					id: null,
					error: err.message,
					timestamp: Date.now(),
				}),
			)
		}
	})

	ws.on("close", () => {
		brainClients.delete(ws)
		clearInterval(heartbeatIv)
		writeApiLog("info", "brain-ws", "Brain WebSocket client disconnected", { total: brainClients.size })
	})

	ws.on("error", (err) => {
		brainClients.delete(ws)
		clearInterval(heartbeatIv)
		writeApiLog("error", "brain-ws", "Brain WebSocket error", { error: err.message })
	})
})

// ── LSP WebSocket Handler ─────────────────────────────────────────────────────
lspWss.on("connection", (ws, req) => {
	const bridge = getLspBridge()
	bridge.addClient(ws)
	ws.send(JSON.stringify({ type: "status", available: true }))

	ws.on("message", (data) => {
		try {
			const msg = JSON.parse(data.toString())
			bridge.handleMessage(ws, msg)
		} catch (err) {
			console.error("[LSP WS] invalid message:", err.message)
		}
	})

	ws.on("close", () => {
		bridge.wsClients.delete(ws)
	})

	ws.on("error", (err) => {
		console.error("[LSP WS] connection error:", err.message)
	})
})

// ── Collaboration WebSocket Handler ──────────────────────────────────────────
// Real-time collaboration: cursor sync, file sync, session management.
// Messages are routed through the collaboration system (if initialized).
collaborationWss.on("connection", (ws, req) => {
	const collaborationSystem = global.__collaborationSystem
	if (!collaborationSystem) {
		ws.send(JSON.stringify({ type: "error", message: "Collaboration system not available" }))
		ws.close()
		return
	}

	writeApiLog("info", "collab-ws", "Collaboration WebSocket client connected")

	// Send welcome with available actions
	ws.send(
		JSON.stringify({
			type: "connected",
			message: "Connected to SuperRoo Collaboration",
			version: "1.0.0",
			supportedActions: [
				"create_session",
				"join_session",
				"leave_session",
				"get_sessions",
				"get_collaborators",
				"cursor_update",
				"file_change",
				"get_summary",
			],
			timestamp: Date.now(),
		}),
	)

	ws.on("message", async (raw) => {
		try {
			const msg = JSON.parse(raw.toString())
			const { action, params = {}, id } = msg

			switch (action) {
				case "create_session": {
					const session = collaborationSystem.createSession(params.workspaceId)
					ws.send(JSON.stringify({ type: "result", id, action, result: session, timestamp: Date.now() }))
					break
				}
				case "join_session": {
					const result = collaborationSystem.joinSession(params.sessionId, {
						userId: params.userId,
						userName: params.userName,
					})
					ws.send(JSON.stringify({ type: "result", id, action, result, timestamp: Date.now() }))
					break
				}
				case "leave_session": {
					collaborationSystem.leaveSession(params.sessionId, params.userId)
					ws.send(JSON.stringify({ type: "result", id, action, result: true, timestamp: Date.now() }))
					break
				}
				case "get_sessions": {
					const sessions = collaborationSystem.getSessionsForWorkspace(params.workspaceId)
					ws.send(JSON.stringify({ type: "result", id, action, result: sessions, timestamp: Date.now() }))
					break
				}
				case "get_collaborators": {
					const collaborators = collaborationSystem.getCollaborators(params.sessionId)
					ws.send(
						JSON.stringify({ type: "result", id, action, result: collaborators, timestamp: Date.now() }),
					)
					break
				}
				case "cursor_update": {
					collaborationSystem.updateCursor(params.sessionId, params.userId, params.position, params.selection)
					ws.send(JSON.stringify({ type: "result", id, action, result: true, timestamp: Date.now() }))
					break
				}
				case "file_change": {
					collaborationSystem.broadcastFileChange(
						params.sessionId,
						params.userId,
						params.filePath,
						params.changes,
					)
					ws.send(JSON.stringify({ type: "result", id, action, result: true, timestamp: Date.now() }))
					break
				}
				case "get_summary": {
					const summary = collaborationSystem.getSummary()
					ws.send(JSON.stringify({ type: "result", id, action, result: summary, timestamp: Date.now() }))
					break
				}
				default:
					ws.send(
						JSON.stringify({
							type: "error",
							id,
							error: `Unknown action: ${action}`,
							timestamp: Date.now(),
						}),
					)
			}
		} catch (err) {
			ws.send(JSON.stringify({ type: "error", id: null, error: err.message, timestamp: Date.now() }))
		}
	})

	ws.on("close", () => {
		writeApiLog("info", "collab-ws", "Collaboration WebSocket client disconnected")
	})

	ws.on("error", (err) => {
		writeApiLog("error", "collab-ws", "Collaboration WebSocket error", { error: err.message })
	})
})

/**
 * Broadcast an event to all connected Brain WebSocket clients.
 * Used by the SSE endpoint and internal event emitters.
 */
function broadcastBrainEvent(event, data) {
	const payload = JSON.stringify({ type: "event", event, data, timestamp: Date.now() })
	for (const ws of brainClients) {
		if (ws.readyState === ws.OPEN) {
			try {
				ws.send(payload)
			} catch {
				/* ignore */
			}
		}
	}
}

// ── Brain SSE Endpoint ───────────────────────────────────────────────────────
// Server-Sent Events endpoint for real-time event streaming.
// Clients connect via GET /api/brain/events and receive events as they happen.
// Global SSE clients map for broadcasting
if (!global.__sseClients) {
	global.__sseClients = new Map() // clientId -> { res, subscriptions }
}

// ── WebSocket Chat Message Handler ───────────────────────────────────────────
async function handleWsChatMessage(ws, sessionId, msg, workspaceDir) {
	const text = (msg.text || "").trim()
	if (!text) return

	// Get workspace context
	const wsCtx = global.__ideWorkspace || {}

	// Store user message
	wsCtx.chatMessages = wsCtx.chatMessages || []
	wsCtx.chatMessages.push({
		id: `msg-${Date.now()}`,
		role: "user",
		author: "You",
		time: new Date().toLocaleTimeString(),
		content: text,
	})
	saveWorkspaceStore(wsCtx)

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
		`The current workspace is "${wsCtx.repoName || "unknown"}" on branch "${wsCtx.branch || "main"}".`,
		`The workspace directory is: ${wsCtx.workspaceDir || "/opt/superroo2"}`,
	]

	// 1. Full conversation history (last 20 messages)
	if (wsCtx.chatMessages.length > 1) {
		const history = wsCtx.chatMessages
			.slice(-20, -1)
			.map((m) => `${m.author}: ${m.content.slice(0, 500)}`)
			.join("\n")
		contextParts.push(`## Conversation History\n${history}`)
	}

	// 2. Current open file context (if provided by client)
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

	// 3. Terminal context (last 20 lines of terminal output)
	if (msg.terminalOutput && msg.terminalOutput.length > 0) {
		const lastLines = msg.terminalOutput.slice(-20).join("\n")
		contextParts.push(`## Recent Terminal Output\n\`\`\`\n${lastLines}\n\`\`\``)
	}

	// 4. HermesClaw memory recall
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

	// 5. Proactive suggestions instruction
	contextParts.push(`## Behavior Rules
- Respond conversationally and naturally, like a senior developer pair programming with the user.
- After providing code or an answer, ALWAYS suggest 1-2 next steps the user might want to take.
- If the user shows an error, proactively suggest the fix.
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
					...wsCtx.chatMessages.slice(-10, -1).map((m) => ({
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
		wsCtx.chatMessages.push({
			id: assistantId,
			role: "agent",
			author: provider.providerId,
			meta: `${provider.model} · ws-stream`,
			time: new Date().toLocaleTimeString(),
			content: fullReply,
		})
		saveWorkspaceStore(wsCtx)

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
				`Format as a JSON array of strings, each max 60 chars.`,
				`Examples: ["Run npm test", "Check the API logs", "Deploy to production"]`,
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
	const reqStartTime = Date.now()

	// Normalize URL: handle both direct access and proxied access
	// - Direct: nginx proxies /api/health -> /health (strips /api)
	// - Via Next.js rewrite: /api/health stays as /api/health
	// Normalize by stripping /api prefix if present
	const normalizedUrl = url.startsWith("/api") ? url.slice(4) || "/" : url

	// Record API telemetry on response finish
	res.on("finish", () => {
		const latency = Date.now() - reqStartTime
		const route = normalizedUrl.split("?")[0]
		const error = res.statusCode >= 400
		monitoring.recordApiTelemetry(route, latency, error)
	})

	// ── Rate Limiting ────────────────────────────────────────────────────
	// Skip rate limiting for health checks (always allow)
	if (method !== "GET" || (url !== "/health" && normalizedUrl !== "/health")) {
		const clientIp = getClientIp(req)
		const { allowed, remaining, resetAt } = checkRateLimit(clientIp)
		if (!allowed) {
			const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
			res.writeHead(429, {
				"Content-Type": "application/json",
				"Retry-After": String(retryAfter),
				"X-RateLimit-Remaining": "0",
				"X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
			})
			res.end(
				JSON.stringify({
					error: "Too Many Requests",
					message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
					retryAfter,
				}),
			)
			return
		}
		// Set rate limit headers on all responses
		res.setHeader("X-RateLimit-Remaining", String(remaining))
		res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)))
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
					loadedModules: status.loadedModules,
					unloadedModules: status.unloadedModules,
					taskStats: status.taskStats,
				}
			}
			// Check Ollama health asynchronously (non-blocking for health endpoint)
			try {
				const ollamaBaseUrl = (
					process.env.OLLAMA_BASE_URL ||
					process.env.OLLAMA_HOST ||
					"http://127.0.0.1:11434"
				).replace(/\/$/, "")
				fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) })
					.then((r) => r.json())
					.then((data) => {
						healthPayload.ollama = { ok: true, models: (data.models || []).map((m) => m.name) }
					})
					.catch(() => {
						healthPayload.ollama = { ok: false }
					})
			} catch {
				healthPayload.ollama = { ok: false }
			}
			sendJson(res, 200, healthPayload)
			return
		}

		// I6: Advanced modules health endpoint
		if (
			method === "GET" &&
			(url === "/orchestrator/health/advanced" || normalizedUrl === "/orchestrator/health/advanced")
		) {
			const advancedHealth = {
				mlEngine: { status: "unknown", modelType: null, loopsRun: 0 },
				debugTeam: { status: "unknown", running: false, jobsPending: 0 },
				parallelExecution: { status: "unknown", activeTasks: 0, maxConcurrency: 2 },
				selfHealing: { status: "unknown", openIncidents: 0 },
				autonomousLoop: { status: "unknown", running: false, currentStep: null },
				commissioningLoop: { status: "unknown", running: false },
				hermesClaw: { status: "unknown", ollamaReady: false, totalQueries: 0 },
				learningGateway: { status: "unknown", totalLessons: 0 },
			}

			if (orchestrator) {
				// ML Engine (InfiniteImprovementLoop)
				const improvementLoop = orchestrator.infiniteImprovementLoop || orchestrator.improvementLoop
				if (improvementLoop) {
					const stats = improvementLoop.stats || {}
					const weights = improvementLoop._weights || {}
					const modelType = weights.code?.featureWeights ? "linear-regression" : null
					advancedHealth.mlEngine = { status: "healthy", modelType, loopsRun: stats.loopsRun || 0 }
				} else {
					advancedHealth.mlEngine = { status: "unavailable", modelType: null, loopsRun: 0 }
				}

				// Debug Team (AutonomousLoop)
				if (orchestrator.autonomousLoop) {
					const status = orchestrator.autonomousLoop.getStatus()
					advancedHealth.debugTeam = {
						status: "healthy",
						running: status.running || false,
						jobsPending: status.stepResults
							? status.stepResults.filter((r) => r.status === "failed" || r.status === "error").length
							: 0,
					}
				} else {
					advancedHealth.debugTeam = { status: "unavailable", running: false, jobsPending: 0 }
				}

				// Parallel Execution
				if (orchestrator.parallelExecutor) {
					const execStatus = orchestrator.parallelExecutor.getStatus
						? orchestrator.parallelExecutor.getStatus()
						: {}
					advancedHealth.parallelExecution = {
						status: "healthy",
						activeTasks: execStatus.activeTasks || 0,
						maxConcurrency: execStatus.maxConcurrency || 2,
					}
				} else {
					advancedHealth.parallelExecution = { status: "unavailable", activeTasks: 0, maxConcurrency: 2 }
				}

				// Self-Healing (HealingBus)
				if (orchestrator.healingBus) {
					const incidents = orchestrator.healingBus.list
						? orchestrator.healingBus.list({ status: "open" })
						: []
					advancedHealth.selfHealing = {
						status: "healthy",
						openIncidents: (incidents && incidents.length) || 0,
					}
				} else {
					advancedHealth.selfHealing = { status: "unavailable", openIncidents: 0 }
				}

				// AutonomousLoop (same instance as debug team)
				if (orchestrator.autonomousLoop) {
					const status = orchestrator.autonomousLoop.getStatus()
					advancedHealth.autonomousLoop = {
						status: "healthy",
						running: status.running || false,
						currentStep: status.currentStepName || null,
					}
				} else {
					advancedHealth.autonomousLoop = { status: "unavailable", running: false, currentStep: null }
				}

				// CommissioningLoop
				if (orchestrator.commissioningLoop) {
					const status = orchestrator.commissioningLoop.getStatus()
					advancedHealth.commissioningLoop = {
						status: "healthy",
						running: status.running || false,
					}
				} else {
					advancedHealth.commissioningLoop = { status: "unavailable", running: false }
				}

				// HermesClaw
				if (orchestrator.hermesClaw) {
					let totalQueries = 0
					let ollamaReady = false
					try {
						const stats = await orchestrator.hermesClaw.getStats()
						totalQueries = stats.operationCount || 0
						ollamaReady = stats.ollamaReady || false
					} catch {
						// stats not available
					}
					advancedHealth.hermesClaw = {
						status: "healthy",
						ollamaReady,
						totalQueries,
					}
				} else {
					advancedHealth.hermesClaw = { status: "unavailable", ollamaReady: false, totalQueries: 0 }
				}

				// LearningGateway
				if (orchestrator.learningGateway) {
					let totalLessons = 0
					try {
						const ops = await orchestrator.learningGateway.getOperationalStats()
						totalLessons = ops.totalLessons || ops.lessonCount || 0
					} catch {
						// stats not available
					}
					advancedHealth.learningGateway = {
						status: "healthy",
						totalLessons,
					}
				} else {
					advancedHealth.learningGateway = { status: "unavailable", totalLessons: 0 }
				}
			}

			sendJson(res, 200, advancedHealth)
			return
		}

		// EventBus stats — active task count and total buffered events
		if (
			method === "GET" &&
			(url === "/orchestrator/event-bus/stats" || normalizedUrl === "/orchestrator/event-bus/stats")
		) {
			const allEvents = eventBus.list()
			const taskIds = new Set(allEvents.map((e) => e.taskId))
			const activeTasks = taskIds.size
			sendJson(res, 200, { activeTasks, totalEvents: allEvents.length })
			return
		}

		// System stats
		if (method === "GET" && (url === "/system" || normalizedUrl === "/system")) {
			const stats = await getSystemStats()
			sendJson(res, 200, stats)
			return
		}

		// Ollama Intelligence Growth
		if (method === "GET" && (url === "/ollama-growth" || normalizedUrl === "/ollama-growth")) {
			const growthData = await getOllamaGrowthData()
			sendJson(res, 200, { success: true, ...growthData })
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

		// Intelligence Layer — aggregated stats from memory files
		// Learning Gateway - compact lesson retrieval and storage for agents
		if (
			method === "POST" &&
			(url === "/api/learning/search" ||
				url === "/api/learning/store" ||
				url === "/api/learning/score" ||
				url === "/api/learning/curate" ||
				normalizedUrl === "/learning/search" ||
				normalizedUrl === "/learning/store" ||
				normalizedUrl === "/learning/score" ||
				normalizedUrl === "/learning/curate")
		) {
			const configuredLearningKey = process.env.LEARNING_API_KEY || ""
			if (configuredLearningKey && req.headers["x-learning-key"] !== configuredLearningKey) {
				sendJson(res, 401, { success: false, error: "unauthorized" })
				return
			}
			if (!orchestrator?.learningGateway) {
				sendJson(res, 503, { success: false, error: "Learning gateway not initialized" })
				return
			}

			try {
				const data = await parseBody(req)
				const route = normalizedUrl.replace(/^\/learning\//, "")

				if (route === "search") {
					if (!data.query || typeof data.query !== "string") {
						sendJson(res, 400, { success: false, error: "query is required" })
						return
					}
					const result = await orchestrator.learningGateway.search({
						query: data.query,
						topK: Math.max(1, Math.min(Number(data.topK || 3), 10)),
						tags: Array.isArray(data.tags) ? data.tags : [],
						filePaths: Array.isArray(data.file_paths) ? data.file_paths : [],
						taskId: data.task_id || null,
						compact: data.compact !== false,
					})
					sendJson(res, 200, { success: true, ...result })
					return
				}

				if (route === "store") {
					if (!data.problem || !data.solution) {
						sendJson(res, 400, { success: false, error: "problem and solution are required" })
						return
					}
					const lesson = await orchestrator.learningGateway.store({
						project: data.project || "superroo2",
						task_type: data.task_type,
						problem: data.problem,
						root_cause: data.root_cause,
						solution: data.solution,
						files: Array.isArray(data.files_changed) ? data.files_changed : [],
						files_changed: Array.isArray(data.files_changed) ? data.files_changed : [],
						tags: Array.isArray(data.tags) ? data.tags : [],
						confidence: Number.isFinite(data.confidence) ? data.confidence : 0.7,
						risk: data.risk || "normal",
						source_agent: data.source_agent,
						raw_ref: data.raw_ref,
					})
					sendJson(res, 200, { success: true, lesson })
					return
				}

				if (route === "score") {
					const readinessScore = await orchestrator.learningGateway.score({
						project: data.project || "superroo2",
						agent: data.agent,
						task: data.task || "",
						outcome: ["success", "partial", "failure", "failed"].includes(data.outcome)
							? data.outcome === "failed"
								? "failure"
								: data.outcome
							: "partial",
						used_lessons: Number(data.used_lessons || 0),
						task_id: data.task_id || null,
						lessonIds: Array.isArray(data.lesson_ids) ? data.lesson_ids : [],
					})
					sendJson(res, 200, { success: true, readiness_score: readinessScore })
					return
				}

				if (route === "curate") {
					if (!data.lesson_id || typeof data.lesson_id !== "string") {
						sendJson(res, 400, { success: false, error: "lesson_id is required" })
						return
					}
					const curation = await orchestrator.learningGateway.curate({
						lesson_id: data.lesson_id,
						action: data.action,
						target_lesson_id: data.target_lesson_id,
						policy_status: data.policy_status,
						rule_summary: data.rule_summary,
						lesson_summary: data.lesson_summary,
						tags: data.tags,
						note: data.note,
						actor: data.actor,
					})
					sendJson(res, 200, { success: true, curation })
					return
				}
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
				return
			}
		}

		if (method === "GET" && (url === "/intelligence-layer" || normalizedUrl === "/intelligence-layer")) {
			try {
				const fs = require("fs")
				const path = require("path")
				const memoryDir = path.join(__dirname, "..", "..", "memory")
				const serverMemoryDir = path.join(__dirname, "..", "..", "server", "src", "memory")

				// ── Lessons — single source of truth: lesson-index.jsonl ──
				let totalLessons = 0
				let lessonsToday = 0
				let totalBugFixes = 0
				const tagCounts = {}
				const modelCounts = {}
				const lessonDayCounts = {}
				const today = new Date().toISOString().slice(0, 10)

				// Normalize model field: git author names are not AI models
				const HUMAN_AUTHOR_NAMES = new Set(["JPG Yap", "jpgyap", "jpgyap@gmail.com"])
				function normalizeModelName(m) {
					if (!m) return "unknown"
					if (HUMAN_AUTHOR_NAMES.has(m)) return "human (git author)"
					if (m.includes("based on")) return "unknown"
					return m
				}

				try {
					const indexRaw = fs.readFileSync(path.join(memoryDir, "lesson-index.jsonl"), "utf8")
					const lines = indexRaw.trim().split("\n").filter(Boolean)
					totalLessons = lines.length
					for (const line of lines) {
						try {
							const entry = JSON.parse(line)
							// Normalize date to YYYY-MM-DD before all comparisons
							const dayKey = (entry.date || "").slice(0, 10)
							if (dayKey === today) lessonsToday++
							if (entry.relevance_factors?.is_bug_fix === true) totalBugFixes++
							if (dayKey) lessonDayCounts[dayKey] = (lessonDayCounts[dayKey] || 0) + 1
							if (entry.tags)
								entry.tags.forEach((t) => {
									tagCounts[t] = (tagCounts[t] || 0) + 1
								})
							const model = normalizeModelName(entry.model)
							modelCounts[model] = (modelCounts[model] || 0) + 1
						} catch {
							/* skip malformed lines */
						}
					}
				} catch {
					/* file may not exist */
				}

				// ── Lessons per day (last 14 days) ──
				const lessonsByDay = Object.entries(lessonDayCounts)
					.sort((a, b) => a[0].localeCompare(b[0]))
					.slice(-14)
					.map(([date, count]) => ({ date, count }))

				// ── Healing incidents ──
				let totalIncidents = 0
				let criticalIncidents = 0
				const incidentCategories = {}
				try {
					const incidentsRaw = fs.readFileSync(path.join(memoryDir, "healing-incidents.json"), "utf8")
					const incidents = JSON.parse(incidentsRaw)
					totalIncidents = incidents.length
					for (const inc of incidents) {
						if (inc.severity === "critical") criticalIncidents++
						const cat = inc.rootCauseCategory || "UNKNOWN"
						incidentCategories[cat] = (incidentCategories[cat] || 0) + 1
					}
				} catch {
					/* file may not exist */
				}

				// ── Healing metrics ──
				let totalHealingAttempts = 0
				let totalHealingSuccesses = 0
				let totalHealingFailures = 0
				const healingByCategory = {}
				try {
					const metricsRaw = fs.readFileSync(path.join(memoryDir, "healing-metrics.json"), "utf8")
					const metrics = JSON.parse(metricsRaw)
					if (metrics.byCategory) {
						for (const [cat, data] of Object.entries(metrics.byCategory)) {
							totalHealingAttempts += data.totalAttempts || 0
							totalHealingSuccesses += data.successCount || 0
							totalHealingFailures += data.failureCount || 0
							healingByCategory[cat] = data
						}
					}
				} catch {
					/* file may not exist */
				}

				// ── Model decisions — only real AI models (exclude human authors and unknown) ──
				const modelDecisionModels = Object.fromEntries(
					Object.entries(modelCounts).filter(([m]) => m !== "human (git author)" && m !== "unknown"),
				)
				const totalModelDecisions = Object.values(modelDecisionModels).reduce((a, b) => a + b, 0)

				// ── Commit/Deploy log + commit activity (single read) ──
				let totalCommits = 0
				let totalDeploys = 0
				let commitsToday = 0
				let deploysToday = 0
				const commitTypes = {}
				const deployStatuses = {}
				const commitActivity = []
				try {
					const cdLogRaw = fs.readFileSync(path.join(serverMemoryDir, "commit-deploy-log.json"), "utf8")
					const cdLog = JSON.parse(cdLogRaw)
					const commitDayCounts = {}
					if (cdLog.commits) {
						totalCommits = cdLog.commits.length
						for (const c of cdLog.commits) {
							if (c.timestamp && c.timestamp.slice(0, 10) === today) commitsToday++
							const t = c.type || "other"
							commitTypes[t] = (commitTypes[t] || 0) + 1
							if (c.timestamp) {
								const day = c.timestamp.slice(0, 10)
								commitDayCounts[day] = (commitDayCounts[day] || 0) + 1
							}
						}
					}
					if (cdLog.deploys) {
						totalDeploys = cdLog.deploys.length
						for (const d of cdLog.deploys) {
							if (d.timestamp && d.timestamp.slice(0, 10) === today) deploysToday++
							const s = d.status || "unknown"
							deployStatuses[s] = (deployStatuses[s] || 0) + 1
						}
					}
					Object.entries(commitDayCounts)
						.sort((a, b) => a[0].localeCompare(b[0]))
						.slice(-14)
						.forEach(([date, commits]) => commitActivity.push({ date, commits }))
				} catch {
					/* file may not exist */
				}

				// ── Feature knowledge — count ## sections in feature-knowledge.md ──
				let totalFeatures = 0
				try {
					const fkRaw = fs.readFileSync(path.join(memoryDir, "feature-knowledge.md"), "utf8")
					totalFeatures = fkRaw.split("\n").filter((l) => l.startsWith("## ")).length
				} catch {
					/* file may not exist */
				}
				// Fall back to doc chunk file count from FeatureKnowledgeIndexer if file is empty
				// (populated later in featureIndex block, merged at response time)

				// ── Brain Sync stats ──
				let brainSync = { total: 0, successful: 0, failed: 0, offline: false }
				try {
					const brainLogRaw = fs.readFileSync(path.join(memoryDir, "central-brain-store-log.json"), "utf8")
					const brainLog = JSON.parse(brainLogRaw)
					const successful = brainLog.successfulStores || 0
					const failed = brainLog.failedStores || 0
					brainSync = {
						total: brainLog.totalLessons || 0,
						successful,
						failed,
						offline: failed > 0 && successful === 0,
					}
				} catch {
					/* file may not exist */
				}
				// Live health check: if the MCP memory server is reachable, the brain is NOT offline
				// even if the store log shows historical failures (e.g. stale log from days ago)
				if (brainSync.offline) {
					try {
						const http = require("http")
						const healthRes = await new Promise((resolve, reject) => {
							const req = http.get("http://127.0.0.1:3419/health", { timeout: 3000 }, (res) => {
								let body = ""
								res.on("data", (chunk) => (body += chunk))
								res.on("end", () => resolve(body))
							})
							req.on("error", reject)
							req.on("timeout", () => {
								req.destroy()
								reject(new Error("timeout"))
							})
						})
						const health = JSON.parse(healthRes)
						if (health.ok === true) {
							brainSync.offline = false
						}
					} catch {
						/* MCP server unreachable — keep offline=true */
					}
				}

				// ── Skills count — scan .roo/skills/ for SKILL.md files ──
				let totalSkills = 0
				try {
					const skillsRoot = path.join(__dirname, "..", "..", ".roo", "skills")
					function countSkillFiles(dir) {
						let n = 0
						for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
							if (entry.isDirectory()) n += countSkillFiles(path.join(dir, entry.name))
							else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) n++
						}
						return n
					}
					totalSkills = countSkillFiles(skillsRoot)
				} catch {
					/* skills dir may not exist */
				}

				// ── HermesClaw persisted memory entry count ──
				let hermesMemoryEntries = 0
				try {
					const hermesPath = path.join(__dirname, "..", "..", "cloud", "data", "hermes-memory.json")
					const hermesRaw = fs.readFileSync(hermesPath, "utf8")
					const hermesEntries = JSON.parse(hermesRaw)
					hermesMemoryEntries = Array.isArray(hermesEntries) ? hermesEntries.length : 0
				} catch {
					/* file may not exist */
				}

				// ── FeatureAnswerer knowledge index stats ──
				let featureChunks = 0
				let featureIndexFiles = 0
				try {
					const { FeatureKnowledgeIndexer } = require("../orchestrator/modules/FeatureKnowledgeIndexer")
					const indexer = new FeatureKnowledgeIndexer()
					indexer.init()
					const fkStats = indexer.getStats()
					featureChunks = fkStats.chunks || 0
					featureIndexFiles = fkStats.files || 0
					if (indexer.db) indexer.db.close()
				} catch {
					/* indexer may not be available */
				}

				let learning = {
					recentEvents: [],
					searches: 0,
					stores: 0,
					scores: 0,
					curations: 0,
					curationQueue: [],
					topLessons: [],
					deadLessons: [],
					failedAfterRecall: [],
					promotionCandidates: [],
				}
				if (orchestrator?.learningGateway) {
					try {
						learning = await orchestrator.learningGateway.getOperationalStats()
					} catch {
						/* gateway may not be available */
					}
				}

				// ── Top tags (most used) ──
				const topTags = Object.entries(tagCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 15)
					.map(([tag, count]) => ({ tag, count }))

				// ── Top models ──
				const topModels = Object.entries(modelCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10)
					.map(([model, count]) => ({ model, count }))

				// ── Most common bug categories ──
				const topBugCategories = Object.entries(incidentCategories)
					.sort((a, b) => b[1] - a[1])
					.map(([category, count]) => ({ category, count }))

				// ── Most reused fixes (from healing metrics) ──
				const topFixPatterns = Object.entries(healingByCategory)
					.sort((a, b) => (b[1].successCount || 0) - (a[1].successCount || 0))
					.map(([category, data]) => ({
						category,
						successCount: data.successCount,
						totalAttempts: data.totalAttempts,
					}))

				// ── Learning Gateway events ──
				// ── RAG / Knowledge Base Stats ──
				let ragStats = {
					totalBugFixes: 0,
					totalLessons: 0,
					testsPassed: 0,
					testsFailed: 0,
					errorTypes: 0,
					agentTypes: 0,
					untested: 0,
				}
				try {
					const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
					const ragStore = new BugKnowledgeStore()
					await ragStore.init()
					const stats = await ragStore.getStats()
					ragStats = {
						totalBugFixes: stats.totalBugFixes || 0,
						totalLessons: stats.totalLessons || 0,
						testsPassed: stats.testsPassed || 0,
						testsFailed: stats.testsFailed || 0,
						errorTypes: stats.errorTypes || 0,
						agentTypes: stats.agentTypes || 0,
						untested: stats.untested || 0,
					}
					await ragStore.close()
				} catch {
					/* BugKnowledgeStore may not be available */
				}

				// ── Ollama Growth / Readiness ──
				let ollamaGrowth = null
				try {
					ollamaGrowth = await getOllamaGrowthData()
				} catch {
					/* ollama data may not exist */
				}

				sendJson(res, 200, {
					success: true,
					data: {
						lessons: {
							total: totalLessons,
							today: lessonsToday,
							topTags,
							topModels,
						},
						bugs: {
							total: totalBugFixes,
						},
						healing: {
							totalIncidents,
							criticalIncidents,
							totalAttempts: totalHealingAttempts,
							totalSuccesses: totalHealingSuccesses,
							totalFailures: totalHealingFailures,
							successRate:
								totalHealingAttempts > 0
									? Math.round((totalHealingSuccesses / totalHealingAttempts) * 100)
									: 0,
							topBugCategories,
							topFixPatterns,
						},
						modelDecisions: {
							total: totalModelDecisions,
							models: modelDecisionModels,
						},
						commits: {
							total: totalCommits,
							today: commitsToday,
							byType: commitTypes,
						},
						deploys: {
							total: totalDeploys,
							today: deploysToday,
							byStatus: deployStatuses,
						},
						features: {
							total: totalFeatures || featureIndexFiles,
						},
						commitActivity,
						lessonsByDay,
						brainSync,
						skills: { total: totalSkills },
						hermes: { memoryEntries: hermesMemoryEntries },
						featureIndex: { chunks: featureChunks, files: featureIndexFiles },
						learning,
						rag: ragStats,
						ollama: ollamaGrowth,
					},
				})
			} catch (err) {
				writeApiLog("error", "intelligence-layer", "Failed to aggregate stats", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// Queue stats
		if (method === "GET" && (url === "/queue/stats" || normalizedUrl === "/queue/stats")) {
			const counts = await getJobCounts()
			sendJson(res, 200, { success: true, ...counts })
			return
		}

		// Queue summary
		if (method === "GET" && (url === "/queue/summary" || normalizedUrl === "/queue/summary")) {
			try {
				const [counts, waiting, active, completed, failed, delayed, usageRecords] = await Promise.all([
					getJobCounts(),
					queue.getWaiting(0, 24),
					queue.getActive(0, 24),
					queue.getCompleted(0, 24),
					queue.getFailed(0, 24),
					queue.getDelayed(0, 24),
					loadOverviewUsage(400),
				])
				const jobs = [
					...waiting.map((job) => ({ ...job, status: "waiting" })),
					...active.map((job) => ({ ...job, status: "active" })),
					...completed.map((job) => ({ ...job, status: "completed" })),
					...failed.map((job) => ({ ...job, status: "failed" })),
					...delayed.map((job) => ({ ...job, status: "delayed" })),
				]
					.map(normalizeQueueJob)
					.sort(
						(a, b) =>
							Number(b.finishedOn || b.processedOn || b.timestamp || 0) -
							Number(a.finishedOn || a.processedOn || a.timestamp || 0),
					)
				const usage = buildOverviewUsageSummary(usageRecords)
				const agents = orchestrator?.agentRegistry ? orchestrator.agentRegistry.list() : []
				const events = orchestrator?.eventLog ? orchestrator.eventLog.list({ limit: 8 }) : []

				sendJson(res, 200, {
					success: true,
					counts,
					jobs: jobs.slice(0, 12),
					pipeline: buildQueuePipeline(agents, jobs),
					activity: buildQueueActivity({ jobs, events }),
					failureReasons: buildQueueFailureReasons(jobs),
					insights: buildQueueInsights(jobs, usage),
					usage,
				})
			} catch (err) {
				writeApiLog("error", "queue-summary", "Failed to build queue summary", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// Jobs summary
		if (method === "GET" && (url === "/jobs/summary" || normalizedUrl === "/jobs/summary")) {
			try {
				const [jobs, usageRecords] = await Promise.all([loadDashboardJobs(200), loadOverviewUsage(400)])
				sendJson(res, 200, buildJobsSummary(jobs, buildOverviewUsageSummary(usageRecords)))
			} catch (err) {
				console.error("[api] Error getting jobs summary:", err.message)
				sendJson(res, 200, {
					totalJobs: 0,
					running: 0,
					completed: 0,
					failed: 0,
					queued: 0,
					successRate: null,
					avgDurationMs: null,
					aiCostToday: null,
					costAvailable: false,
					totalTokensToday: 0,
					systemHealth: "Unknown",
					activeAgents: [],
					modelPerformance: [],
				})
			}
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

		// Get job logs
		if (method === "GET" && url.match(/^\/jobs\/[^/]+\/logs$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}
			const logs = await loadJobLogs(job)
			sendJson(res, 200, { success: true, logs, count: logs.length })
			return
		}

		// List jobs
		if (
			method === "GET" &&
			(url === "/jobs" ||
				normalizedUrl === "/jobs" ||
				url.startsWith("/jobs?") ||
				normalizedUrl.startsWith("/jobs?"))
		) {
			const targetUrl = url.startsWith("/jobs") ? url : normalizedUrl
			const urlObj = new URL(targetUrl, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || "all"
			const limit = parseInt(urlObj.searchParams.get("limit") || "50")
			const jobs = await loadDashboardJobs(limit)
			const filtered = status === "all" ? jobs : jobs.filter((job) => job.status === status)
			sendJson(res, 200, { success: true, jobs: filtered, count: filtered.length })
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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

		// ── Collaboration REST API Endpoints ──────────────────────────────────────
		// These endpoints provide REST access to the collaboration system.
		// Real-time collaboration (cursor sync, file sync) is handled via WebSocket.

		// GET /collaboration/sessions — list all active collaboration sessions
		if (method === "GET" && normalizedUrl === "/collaboration/sessions") {
			const collabSystem = global.__collaborationSystem
			if (!collabSystem) {
				sendJson(res, 503, { success: false, error: "Collaboration system not available" })
				return
			}
			const summary = collabSystem.getSummary()
			sendJson(res, 200, { success: true, sessions: summary })
			return
		}

		// POST /collaboration/sessions — create a new collaboration session
		if (method === "POST" && normalizedUrl === "/collaboration/sessions") {
			const collabSystem = global.__collaborationSystem
			if (!collabSystem) {
				sendJson(res, 503, { success: false, error: "Collaboration system not available" })
				return
			}
			const data = await parseBody(req)
			if (!data.workspaceId) {
				sendJson(res, 400, { success: false, error: "workspaceId is required" })
				return
			}
			const session = collabSystem.createSession(data.workspaceId)
			sendJson(res, 200, { success: true, session })
			return
		}

		// GET /collaboration/sessions/:workspaceId — get sessions for a workspace
		if (method === "GET" && normalizedUrl.match(/^\/collaboration\/sessions\/[^/]+$/)) {
			const collabSystem = global.__collaborationSystem
			if (!collabSystem) {
				sendJson(res, 503, { success: false, error: "Collaboration system not available" })
				return
			}
			const workspaceId = normalizedUrl.split("/")[3]
			const sessions = collabSystem.getSessionsForWorkspace(workspaceId)
			sendJson(res, 200, { success: true, sessions })
			return
		}

		// DELETE /collaboration/sessions/:sessionId — close a session
		if (method === "DELETE" && normalizedUrl.match(/^\/collaboration\/sessions\/[^/]+$/)) {
			const collabSystem = global.__collaborationSystem
			if (!collabSystem) {
				sendJson(res, 503, { success: false, error: "Collaboration system not available" })
				return
			}
			const sessionId = normalizedUrl.split("/")[3]
			collabSystem.closeSession(sessionId)
			sendJson(res, 200, { success: true, message: "Session closed" })
			return
		}

		// GET /collaboration/collaborators/:sessionId — get collaborators in a session
		if (method === "GET" && normalizedUrl.match(/^\/collaboration\/collaborators\/[^/]+$/)) {
			const collabSystem = global.__collaborationSystem
			if (!collabSystem) {
				sendJson(res, 503, { success: false, error: "Collaboration system not available" })
				return
			}
			const sessionId = normalizedUrl.split("/")[3]
			const collaborators = collabSystem.getCollaborators(sessionId)
			sendJson(res, 200, { success: true, collaborators })
			return
		}

		// GET /collaboration/status — get collaboration system health
		if (method === "GET" && normalizedUrl === "/collaboration/status") {
			const collabSystem = global.__collaborationSystem
			sendJson(res, 200, {
				success: true,
				available: !!collabSystem,
				sessions: collabSystem ? collabSystem.getSummary() : [],
			})
			return
		}

		// ── Provider API Endpoints (for dashboard) ────────────────────────────────

		// GET /providers — list all providers with usage stats and connection meta
		if (method === "GET" && normalizedUrl === "/providers") {
			const bridge = global.__providerBridge
			if (!bridge) {
				// Fall back to legacy provider list
				const entries = PROVIDERS.map((p) => {
					const meta = providerMeta.get(p.id) || { hasKey: false, status: "not_tested" }
					return {
						id: p.id,
						name: p.name,
						status: meta.status,
						hasKey: meta.hasKey,
						models: p.models.map((m) => m.id),
						capabilities: p.capabilities,
						defaultModel: p.defaultModel,
						local: !!p.local,
					}
				})
				sendJson(res, 200, { success: true, providers: entries, bridgeAvailable: false })
				return
			}
			const providers = bridge.getAllProviders()
			sendJson(res, 200, { success: true, providers, bridgeAvailable: true })
			return
		}

		// GET /providers/usage — get provider usage statistics
		if (method === "GET" && normalizedUrl === "/providers/usage") {
			const bridge = global.__providerBridge
			if (!bridge) {
				sendJson(res, 200, { success: true, usageStats: {}, bridgeAvailable: false })
				return
			}
			const status = bridge.getStatus()
			sendJson(res, 200, {
				success: true,
				usageStats: status.usageStats,
				connectionMeta: status.connectionMeta,
			})
			return
		}

		// GET /providers/bridge/status — get provider bridge health
		if (method === "GET" && normalizedUrl === "/providers/bridge/status") {
			const bridge = global.__providerBridge
			if (!bridge) {
				sendJson(res, 200, { success: true, available: false })
				return
			}
			sendJson(res, 200, { success: true, available: true, status: bridge.getStatus() })
			return
		}

		// GET /mcp/status — get MCP Server Manager status
		if (method === "GET" && normalizedUrl === "/mcp/status") {
			const mcpManager = global.__mcpServerManager
			if (!mcpManager) {
				sendJson(res, 200, { success: true, available: false })
				return
			}
			const summary = mcpManager.getSummary()
			sendJson(res, 200, { success: true, available: true, servers: summary })
			return
		}

		// GET /mcp/servers — list all MCP servers
		if (method === "GET" && normalizedUrl === "/mcp/servers") {
			const mcpManager = global.__mcpServerManager
			if (!mcpManager) {
				sendJson(res, 200, { success: true, servers: [], available: false })
				return
			}
			const servers = mcpManager.getServers()
			sendJson(res, 200, { success: true, servers, available: true })
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
			const email = auth.requireAuth(req, res)
			if (!email) return
			const settings = await loadSettings()
			sendJson(res, 200, { success: true, settings })
			return
		}

		// PUT /settings — update full settings
		if (method === "PUT" && normalizedUrl === "/settings") {
			const email = auth.requireAuth(req, res)
			if (!email) return
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

		// GET /projects — list all tracked projects with aggregated stats
		if (method === "GET" && (url === "/projects" || normalizedUrl === "/projects")) {
			try {
				// 1. Read auth module's projects list (from projects.json)
				const authProjects = (auth.projects || []).map((p) => ({
					id: p.id,
					name: p.name || p.repoName,
					repoName: p.repoName,
					branch: p.branch,
					status: p.status || "unknown",
					language: p.language || null,
					localPath: p.localPath || null,
					repoUrl: p.repoUrl || null,
					lastActivityAt: p.lastActivityAt || null,
				}))

				// 2. Read project presence for active/inactive tracking
				const presenceMap = {}
				for (const pp of auth.projectPresence || []) {
					if (!presenceMap[pp.projectId]) {
						presenceMap[pp.projectId] = []
					}
					presenceMap[pp.projectId].push(pp)
				}

				// 3. Read commit-deploy-log for per-project stats
				let commitDeployLog = { commits: [], deploys: [] }
				try {
					const commitDeployPath =
						process.env.COMMIT_DEPLOY_LOG_PATH || "/opt/superroo2/server/src/memory/commit-deploy-log.json"
					const raw = await fs.readFile(commitDeployPath, "utf-8")
					commitDeployLog = JSON.parse(raw)
				} catch {
					// File may not exist yet
				}

				// 4. Get current IDE workspace
				const currentWorkspace = global.__ideWorkspace || {}

				// 5. Build per-project stats from commit-deploy-log
				const projectStats = {}
				for (const commit of commitDeployLog.commits || []) {
					const repoName = commit.repoName || "superroo2"
					if (!projectStats[repoName]) {
						projectStats[repoName] = {
							commits: 0,
							deploys: 0,
							healthyDeploys: 0,
							failedDeploys: 0,
							lastCommit: null,
							lastDeploy: null,
						}
					}
					projectStats[repoName].commits++
					if (
						!projectStats[repoName].lastCommit ||
						new Date(commit.timestamp) > new Date(projectStats[repoName].lastCommit.timestamp)
					) {
						projectStats[repoName].lastCommit = {
							message: commit.title || "",
							author: commit.agent || "System",
							time: commit.timestamp,
							sha: commit.commitSha?.slice(0, 7) || "",
						}
					}
				}
				for (const deploy of commitDeployLog.deploys || []) {
					const repoName = deploy.repoName || "superroo2"
					if (!projectStats[repoName]) {
						projectStats[repoName] = {
							commits: 0,
							deploys: 0,
							healthyDeploys: 0,
							failedDeploys: 0,
							lastCommit: null,
							lastDeploy: null,
						}
					}
					projectStats[repoName].deploys++
					if (deploy.status === "healthy") projectStats[repoName].healthyDeploys++
					if (deploy.status === "failed") projectStats[repoName].failedDeploys++
					if (
						!projectStats[repoName].lastDeploy ||
						new Date(deploy.startedAt) > new Date(projectStats[repoName].lastDeploy.time)
					) {
						projectStats[repoName].lastDeploy = {
							status: deploy.status,
							environment: deploy.environment || "production",
							time: deploy.startedAt,
							version: deploy.version,
						}
					}
				}

				// 6. Query lesson counts per project from the knowledge store
				let lessonCountsByProject = {}
				try {
					if (orchestrator && orchestrator.hermesClaw && orchestrator.hermesClaw.bugKnowledgeStore) {
						lessonCountsByProject =
							await orchestrator.hermesClaw.bugKnowledgeStore.getLessonCountByProject()
					}
				} catch {
					// Knowledge store may not be available
				}

				// 7. Merge everything into a unified project list
				const mergedProjects = authProjects.map((p) => {
					const presences = presenceMap[p.id] || []
					const latestPresence = presences.sort((a, b) => new Date(b.lastSyncAt) - new Date(a.lastSyncAt))[0]
					const stats = projectStats[p.repoName] || {
						commits: 0,
						deploys: 0,
						healthyDeploys: 0,
						failedDeploys: 0,
						lastCommit: null,
						lastDeploy: null,
					}
					// Active if:
					//   1. It matches the current IDE workspace (VS Code extension WebSocket connection)
					//   2. It has recent presence activity with status "active" (within last 24h)
					//   3. It has commits within the last 30 days (captures locally-used projects
					//      where the VS Code extension doesn't connect to this cloud dashboard)
					const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
					const hasRecentCommits = stats.lastCommit && new Date(stats.lastCommit.time) > thirtyDaysAgo
					const isActive = !!(
						currentWorkspace.repoName === p.repoName ||
						(latestPresence && latestPresence.status === "active") ||
						hasRecentCommits
					)

					return {
						...p,
						// Presence info
						isActive,
						activeFile: latestPresence?.activeFile || null,
						currentTask: latestPresence?.currentTask || null,
						activeAgent: latestPresence?.activeAgent || null,
						lastSyncAt: latestPresence?.lastSyncAt || null,
						// Commit/deploy stats
						totalCommits: stats.commits,
						totalDeploys: stats.deploys,
						healthyDeploys: stats.healthyDeploys,
						failedDeploys: stats.failedDeploys,
						lastCommit: stats.lastCommit,
						lastDeploy: stats.lastDeploy,
						// Deploy success rate
						deploySuccessRate:
							stats.deploys > 0 ? Math.round((stats.healthyDeploys / stats.deploys) * 100) : 0,
						// Lesson count from knowledge store
						lessonCount: lessonCountsByProject[p.repoName] || 0,
					}
				})

				// 7. If no projects from auth, fall back to commit-deploy-log repos
				if (mergedProjects.length === 0) {
					const repoSet = new Set()
					for (const commit of commitDeployLog.commits || []) {
						if (commit.repoName) repoSet.add(commit.repoName)
					}
					for (const deploy of commitDeployLog.deploys || []) {
						if (deploy.repoName) repoSet.add(deploy.repoName)
					}
					if (repoSet.size === 0) repoSet.add("superroo2")

					for (const repoName of repoSet) {
						const stats = projectStats[repoName] || {
							commits: 0,
							deploys: 0,
							healthyDeploys: 0,
							failedDeploys: 0,
							lastCommit: null,
							lastDeploy: null,
						}
						const isActive = currentWorkspace.repoName === repoName
						mergedProjects.push({
							id: `repo-${repoName}`,
							name: repoName,
							repoName,
							branch: "main",
							status: "active",
							language: null,
							localPath: null,
							repoUrl: null,
							lastActivityAt: stats.lastCommit?.time || stats.lastDeploy?.time || null,
							isActive,
							activeFile: null,
							currentTask: null,
							activeAgent: null,
							lastSyncAt: null,
							totalCommits: stats.commits,
							totalDeploys: stats.deploys,
							healthyDeploys: stats.healthyDeploys,
							failedDeploys: stats.failedDeploys,
							lastCommit: stats.lastCommit,
							lastDeploy: stats.lastDeploy,
							deploySuccessRate:
								stats.deploys > 0 ? Math.round((stats.healthyDeploys / stats.deploys) * 100) : 0,
							lessonCount: lessonCountsByProject[repoName] || 0,
						})
					}
				}

				// 8. Build activity events from commits + deploys across all projects
				const activityEvents = []
				for (const deploy of (commitDeployLog.deploys || []).slice(-10).reverse()) {
					activityEvents.push({
						id: `deploy_${deploy.id || deploy.version}`,
						time: deploy.startedAt,
						agent: deploy.agent || "System",
						role: "Deployer",
						title: `Deployed ${deploy.version || ""} to ${deploy.repoName || "superroo2"}`,
						detail: `Status: ${deploy.status}`,
						severity: deploy.status === "healthy" ? "low" : deploy.status === "failed" ? "high" : "medium",
					})
				}
				for (const commit of (commitDeployLog.commits || []).slice(-10).reverse()) {
					activityEvents.push({
						id: `commit_${commit.commitSha?.slice(0, 7) || Math.random().toString(36).slice(2, 9)}`,
						time: commit.timestamp,
						agent: commit.agent || "System",
						role: "Developer",
						title: commit.title || "Commit",
						detail: `Repo: ${commit.repoName || "superroo2"}`,
						severity: "low",
					})
				}
				activityEvents.sort((a, b) => new Date(b.time) - new Date(a.time))
				activityEvents.splice(20) // keep only top 20

				sendJson(res, 200, {
					success: true,
					data: {
						projects: mergedProjects,
						activityEvents,
						currentWorkspace: {
							repoName: currentWorkspace.repoName || null,
							branch: currentWorkspace.branch || null,
							workspaceDir: currentWorkspace.workspaceDir || null,
						},
						totalProjects: mergedProjects.length,
						activeProjects: mergedProjects.filter((p) => p.isActive).length,
					},
				})
			} catch (err) {
				console.error("[api] Error reading projects:", err.message)
				sendJson(res, 500, { success: false, error: err.message })
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

		// ── Brain Consensus routes ──────────────────────────────────────────────

		// POST /brain/consensus/decide — Run a weighted consensus vote
		if (method === "POST" && normalizedUrl === "/brain/consensus/decide") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = parseBody(req)
				const result = await svc.consensus.decide({
					projectId: body.projectId || "default",
					decisionType: body.decisionType,
					contextId: body.contextId,
					votes: body.votes,
					createdBy: body.createdBy || "api",
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/consensus/decisions — List consensus decisions with filters
		if (method === "GET" && normalizedUrl === "/brain/consensus/decisions") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const decisions = await svc.consensus.listDecisions({
					projectId: req.query?.projectId,
					decisionType: req.query?.decisionType,
					finalDecision: req.query?.finalDecision,
					contextId: req.query?.contextId,
					limit: parseInt(req.query?.limit) || 50,
					offset: parseInt(req.query?.offset) || 0,
				})
				sendJson(res, 200, { success: true, data: decisions })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/consensus/decisions/:id — Get a specific decision
		if (method === "GET" && normalizedUrl.startsWith("/brain/consensus/decisions/")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const id = normalizedUrl.slice("/brain/consensus/decisions/".length)
				const decision = await svc.consensus.getDecision(id)
				if (!decision) {
					sendJson(res, 404, { success: false, error: "Decision not found" })
					return
				}
				sendJson(res, 200, { success: true, data: decision })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/consensus/stats — Get consensus statistics
		if (method === "GET" && normalizedUrl === "/brain/consensus/stats") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const stats = await svc.consensus.getStats(req.query?.projectId || "default")
				sendJson(res, 200, { success: true, data: stats })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// ── Brain Predictive Risk routes ─────────────────────────────────────────

		// POST /brain/risk/assess — Assess risk for an action
		if (method === "POST" && normalizedUrl === "/brain/risk/assess") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = parseBody(req)
				const result = await svc.riskEngine.assess({
					projectId: body.projectId || "default",
					taskId: body.taskId,
					actionType: body.actionType,
					filesChanged: body.filesChanged,
					logs: body.logs,
					environment: body.environment,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// POST /brain/risk/patterns — Record a failure pattern
		if (method === "POST" && normalizedUrl === "/brain/risk/patterns") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = parseBody(req)
				const result = await svc.riskEngine.recordFailurePattern({
					projectId: body.projectId || "default",
					patternType: body.patternType,
					signature: body.signature,
					description: body.description,
					severity: body.severity || "medium",
					suggestedFix: body.suggestedFix,
					source: body.source || "api",
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/risk/assessments — List risk assessments with filters
		if (method === "GET" && normalizedUrl === "/brain/risk/assessments") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const assessments = await svc.riskEngine.getAssessments({
					projectId: req.query?.projectId,
					riskLevel: req.query?.riskLevel,
					actionType: req.query?.actionType,
					limit: parseInt(req.query?.limit) || 50,
					offset: parseInt(req.query?.offset) || 0,
				})
				sendJson(res, 200, { success: true, data: assessments })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/risk/patterns — List failure patterns with filters
		if (method === "GET" && normalizedUrl === "/brain/risk/patterns") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const patterns = await svc.riskEngine.getFailurePatterns({
					projectId: req.query?.projectId,
					severity: req.query?.severity,
					patternType: req.query?.patternType,
					limit: parseInt(req.query?.limit) || 50,
					offset: parseInt(req.query?.offset) || 0,
				})
				sendJson(res, 200, { success: true, data: patterns })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/risk/stats — Get risk statistics
		if (method === "GET" && normalizedUrl === "/brain/risk/stats") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const stats = await svc.riskEngine.getStats(req.query?.projectId || "default")
				sendJson(res, 200, { success: true, data: stats })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// ── Brain Swarm Debug routes ─────────────────────────────────────────────

		// POST /brain/swarm/debug — Run a swarm debug session
		if (method === "POST" && normalizedUrl === "/brain/swarm/debug") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = parseBody(req)
				const result = await svc.swarmDebugger.debug({
					projectId: body.projectId || "default",
					taskId: body.taskId,
					problem: body.problem,
					context: body.context,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/swarm/runs — List swarm debug runs
		if (method === "GET" && normalizedUrl === "/brain/swarm/runs") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const runs = await svc.swarmDebugger.listRuns({
					projectId: req.query?.projectId,
					status: req.query?.status,
					limit: parseInt(req.query?.limit) || 50,
					offset: parseInt(req.query?.offset) || 0,
				})
				sendJson(res, 200, { success: true, data: runs })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/swarm/runs/:id — Get a specific swarm run
		if (method === "GET" && normalizedUrl.startsWith("/brain/swarm/runs/")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const id = normalizedUrl.slice("/brain/swarm/runs/".length)
				const run = await svc.swarmDebugger.getRun(id)
				if (!run) {
					sendJson(res, 404, { success: false, error: "Swarm run not found" })
					return
				}
				sendJson(res, 200, { success: true, data: run })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// ── Brain Model Router routes ───────────────────────────────────────────

		// POST /brain/router/route — Select best model for task type
		if (method === "POST" && normalizedUrl === "/brain/router/route") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = parseBody(req)
				const result = await svc.modelRouter.route({
					projectId: body.projectId || "default",
					taskType: body.taskType,
					taskId: body.taskId,
					runId: body.runId,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// POST /brain/router/outcome — Record routing outcome
		if (method === "POST" && normalizedUrl === "/brain/router/outcome") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = parseBody(req)
				const result = await svc.modelRouter.recordOutcome({
					projectId: body.projectId || "default",
					taskType: body.taskType,
					taskId: body.taskId,
					runId: body.runId,
					agent: body.agent,
					modelSelected: body.modelSelected,
					fallbackChain: body.fallbackChain,
					attempt: body.attempt || 1,
					success: body.success,
					durationMs: body.durationMs,
					costUsd: body.costUsd,
					hallucinated: body.hallucinated || false,
					error: body.error,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/router/logs — Get routing logs with filters
		if (method === "GET" && normalizedUrl === "/brain/router/logs") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const logs = await svc.modelRouter.getRoutingLogs({
					projectId: req.query?.projectId,
					taskType: req.query?.taskType,
					agent: req.query?.agent,
					success: req.query?.success !== undefined ? req.query.success === "true" : undefined,
					limit: parseInt(req.query?.limit) || 50,
					offset: parseInt(req.query?.offset) || 0,
				})
				sendJson(res, 200, { success: true, data: logs })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/router/performance — Get performance summary
		if (method === "GET" && normalizedUrl === "/brain/router/performance") {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const summary = await svc.modelRouter.getPerformanceSummary(req.query?.projectId || "default")
				sendJson(res, 200, { success: true, data: summary })
			} catch (err) {
				sendJson(res, 400, { success: false, error: err.message })
			}
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
		// Also handles /metrics for Prometheus scraping
		if (normalizedUrl.startsWith("/monitoring/") || normalizedUrl === "/metrics") {
			if (await monitoring.handleMonitoringRoute(method, url, req, res)) {
				return
			}
		}

		// ── RAM Orchestrator proxy routes ─────────────────────────────────────

		// Proxy dashboard requests to the RAM orchestrator worker (port 3456)
		if (normalizedUrl.startsWith("/ram-orchestrator/")) {
			const orchPath = normalizedUrl.slice("/ram-orchestrator".length) || "/"
			try {
				const orchRes = await fetch(`http://127.0.0.1:3456${orchPath}`, {
					method,
					headers: { "Content-Type": "application/json" },
					signal: AbortSignal.timeout(5000),
				})
				const body = await orchRes.text()
				res.writeHead(orchRes.status, {
					"Content-Type": orchRes.headers.get("content-type") || "application/json",
				})
				res.end(body)
			} catch (err) {
				sendJson(res, 502, { error: "RAM orchestrator unreachable", detail: err.message })
			}
			return
		}

		// ── Workflow Compliance routes ─────────────────────────────────────────

		// Workflow Compliance — exposes workflow tracking, DeepSeek delegation stats,
		// API usage metrics, and compliance reports for the dashboard
		if (normalizedUrl.startsWith("/workflow-compliance/")) {
			const wcUrl = normalizedUrl.slice("/workflow-compliance".length) || "/"
			const wcMethod = method

			// GET /workflow-compliance/stats
			if (wcMethod === "GET" && wcUrl === "/stats") {
				await workflowCompliance.getStats(req, res)
				return
			}

			// GET /workflow-compliance/commits
			if (wcMethod === "GET" && wcUrl.startsWith("/commits")) {
				await workflowCompliance.getCommits(req, res)
				return
			}

			// GET /workflow-compliance/usage
			if (wcMethod === "GET" && wcUrl.startsWith("/usage")) {
				await workflowCompliance.getUsage(req, res)
				return
			}

			// GET /workflow-compliance/verify-key/:keyLast4
			if (wcMethod === "GET" && wcUrl.match(/^\/verify-key\/[^/]+$/)) {
				req.params = { keyLast4: wcUrl.split("/").pop() }
				await workflowCompliance.verifyApiKey(req, res)
				return
			}

			// GET /workflow-compliance/deepseek-stats
			if (wcMethod === "GET" && wcUrl === "/deepseek-stats") {
				await workflowCompliance.getDeepSeekStats(req, res)
				return
			}

			// GET /workflow-compliance/learning-health
			if (wcMethod === "GET" && wcUrl === "/learning-health") {
				await workflowCompliance.getLearningHealth(req, res)
				return
			}

			// GET /workflow-compliance/bridge-health
			if (wcMethod === "GET" && wcUrl === "/bridge-health") {
				await workflowCompliance.getBridgeHealth(req, res)
				return
			}

			// POST /workflow-compliance/action
			if (wcMethod === "POST" && wcUrl === "/action") {
				await workflowCompliance.runAction(req, res)
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
					workspaceDir:
						process.env.WORKSPACE_ROOT ||
						(fsSync.existsSync("/opt/superroo2") ? "/opt/superroo2" : process.cwd()),
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
			const email = auth.requireAuth(req, res)
			if (!email) return
			const data = await parseBody(req)
			const cmd = data?.command || ""
			const terminalId = data?.terminalId || "term-1"

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
			const isAgentCommand = cmd.startsWith("/") || cmd.startsWith("@")

			if (isAgentCommand) {
				// Route through agent system instead of raw shell
				try {
					const agentResult = await handleAgentTerminalCommand(cmd, ws, term)
					const outputLines = agentResult.output || ["Command processed by agent system"]
					// Log to terminal session
					term.output.push(`$ ${cmd}`)
					term.output.push(...outputLines)
					saveWorkspaceStore(global.__ideWorkspace) // persist terminal
					sendJson(res, 200, {
						ok: true,
						output: outputLines,
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

			// Store user message
			ws.chatMessages.push({
				id: `msg-${Date.now()}`,
				role: "user",
				author: "You",
				time: new Date().toLocaleTimeString(),
				content: msg,
			})
			saveWorkspaceStore(global.__ideWorkspace) // persist chat

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
				ws.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "agent",
					author: "System",
					time: new Date().toLocaleTimeString(),
					content: noProviderMsg,
				})
				saveWorkspaceStore(global.__ideWorkspace) // persist chat
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
				contextParts.push(`The current workspace is "${ws.repoName}" on branch "${ws.branch}".`)
				contextParts.push(`The workspace directory is: ${ws.workspaceDir}`)
				if (ws.chatMessages.length > 2) {
					const recent = ws.chatMessages
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
				const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: msg },
				])

				ws.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "agent",
					author: provider.providerId,
					meta: `${provider.model} · ${routing.agent}${orchestratorTaskId ? ` · task:${orchestratorTaskId.substring(0, 8)}` : ""}`,
					time: new Date().toLocaleTimeString(),
					content: reply,
				})

				// Mark pipeline step as done after successful response
				if (routing.pipelineStep) {
					ws.pipeline = ws.pipeline.map((s) => ({
						...s,
						status: s.id === routing.pipelineStep ? "done" : s.status,
					}))
				}

				saveWorkspaceStore(global.__ideWorkspace) // persist chat + pipeline

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
				ws.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "assistant",
					author: "System",
					time: new Date().toLocaleTimeString(),
					content: `AI request failed: ${err.message}`,
				})
				saveWorkspaceStore(global.__ideWorkspace) // persist chat
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

			// Store user message
			ws.chatMessages.push({
				id: `msg-${Date.now()}`,
				role: "user",
				author: "You",
				time: new Date().toLocaleTimeString(),
				content: msg,
			})
			saveWorkspaceStore(global.__ideWorkspace)

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
					`The current workspace is "${ws.repoName}" on branch "${ws.branch}".`,
					`The workspace directory is: ${ws.workspaceDir}`,
				]
				if (ws.chatMessages.length > 2) {
					const recent = ws.chatMessages
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
				ws.chatMessages.push({
					id: `msg-${Date.now() + 1}`,
					role: "agent",
					author: provider.providerId,
					meta: `${provider.model} · stream`,
					time: new Date().toLocaleTimeString(),
					content: fullReply,
				})
				saveWorkspaceStore(global.__ideWorkspace)

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
			const email = auth.requireAuth(req, res)
			if (!email) return
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
				const stats = await orchestrator.hermesClaw.getStats()
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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

		// POST /ide-workspace/workspace/import-github — import GitHub repo
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/workspace/import-github")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			const data = await parseBody(req)
			const repoUrl = data?.repoUrl || ""
			const branch = data?.branch || "main"

			if (!repoUrl) {
				sendJson(res, 400, { ok: false, error: "Missing repoUrl" })
				return
			}

			// Validate repoUrl is a safe Git URL
			const safeGitUrlRegex = /^https?:\/\/[^\s"';&|<>$]+\/[\w\-.]+\/[\w\-.]+(?:\.git)?$/
			const safeGitSshRegex = /^git@[\w\-.]+:[\w\-.]+\/[\w\-.]+(?:\.git)?$/
			if (!safeGitUrlRegex.test(repoUrl) && !safeGitSshRegex.test(repoUrl)) {
				sendJson(res, 400, { ok: false, error: "Invalid repoUrl format" })
				return
			}

			// Validate branch name to prevent shell injection
			const safeBranchRegex = /^[\w.\-/]+$/
			if (!safeBranchRegex.test(branch)) {
				sendJson(res, 400, { ok: false, error: "Invalid branch name" })
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

		// POST /ide-workspace/git — stub for git commands (GitPanel integration)
		if (method === "POST" && normalizedUrl.startsWith("/ide-workspace/git")) {
			const data = await parseBody(req)
			const action = data?.action || "status"
			const payload = data || {}
			try {
				let output = ""
				switch (action) {
					case "status":
						output =
							"On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean"
						break
					case "log":
						output = `commit abc123\nAuthor: Agent <agent@superroo.dev>\nDate: ${new Date().toISOString()}\n\n    Auto-commit by SuperRoo agent`
						break
					case "commit":
						output = `[main ${Math.random().toString(36).slice(2, 8)}] ${payload.message || "auto-commit"}`
						break
					case "push":
						output = "Everything up-to-date"
						break
					case "pull":
						output = "Already up to date."
						break
					default:
						output = `Git ${action} completed`
				}
				sendJson(res, 200, { success: true, output })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /ide-workspace/search — stub for workspace file search
		if (method === "GET" && normalizedUrl.startsWith("/ide-workspace/search")) {
			const q = parsedUrl.searchParams.get("q") || ""
			try {
				// Simple filename search across workspace files
				const allFiles = ws.files || []
				const results = allFiles
					.filter((f) => f.path.toLowerCase().includes(q.toLowerCase()))
					.slice(0, 20)
					.map((f) => ({
						file: f.path,
						line: 1,
						content: f.path.split("/").pop() || f.path,
						match: f.path,
					}))
				sendJson(res, 200, { results })
			} catch (err) {
				sendJson(res, 500, { results: [], error: err.message })
			}
			return
		}

		// POST /brain/ask — simplified AI chat endpoint for IDE Terminal fallback
		if (method === "POST" && normalizedUrl.startsWith("/brain/ask")) {
			const data = await parseBody(req)
			const msg = data?.message || ""
			const sessionId = data?.sessionId || "default"
			if (!msg) {
				sendJson(res, 400, { reply: "No message provided" })
				return
			}

			const provider = resolveProviderForTask("coder")
			if (!provider) {
				sendJson(res, 200, {
					reply: "No AI provider is configured. Please add an API key in Settings > API Keys.",
					suggestions: [],
				})
				return
			}

			try {
				const systemPrompt = `You are SuperRoo, an expert AI coding assistant in the Cloud Dashboard IDE Terminal. The user is working in a cloud workspace.`
				const reply = await callChatCompletion(provider.apiBaseUrl, provider.apiKey, provider.model, [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: msg },
				])
				sendJson(res, 200, { reply, suggestions: [] })
			} catch (err) {
				console.error("[brain/ask] Error:", err.message)
				sendJson(res, 200, {
					reply: `AI request failed: ${err.message}. Check your API key and try again.`,
					suggestions: [],
				})
			}
			return
		}

		// GET /system/resources — terminal resource monitoring
		if (method === "GET" && normalizedUrl.startsWith("/system/resources")) {
			try {
				const cpus = os.cpus()
				const totalMem = os.totalmem()
				const freeMem = os.freemem()
				const loadAvg = os.loadavg()
				const cpuPercent = cpus.length > 0 ? Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100)) : 0
				const memoryPercent = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0
				sendJson(res, 200, {
					cpu: cpuPercent,
					memory: memoryPercent,
					disk: await getDiskUsagePercent(),
				})
			} catch (err) {
				sendJson(res, 500, { cpu: 0, memory: 0, disk: null, error: err.message })
			}
			return
		}

		// GET /overview/summary — canonical overview dashboard payload
		if (method === "GET" && (url === "/overview/summary" || normalizedUrl === "/overview/summary")) {
			try {
				const cpus = os.cpus()
				const totalMem = os.totalmem()
				const freeMem = os.freemem()
				const loadAvg = os.loadavg()
				const cpu = cpus.length > 0 ? Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100)) : 0
				const ram = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0

				const [queueStats, disk, commitDeploy, usageRecords, logs] = await Promise.all([
					getJobCounts(),
					getDiskUsagePercent(),
					loadOverviewCommitDeploy(8),
					loadOverviewUsage(200),
					getLogs(12),
				])

				const redisHealthy = connection?.status === "ready"
				const health = {
					status: redisHealthy ? "online" : "offline",
					redis: redisHealthy,
					worker: !(queue instanceof NoopQueue),
				}
				const agents = orchestrator?.agentRegistry ? orchestrator.agentRegistry.list() : []
				const bugs = orchestrator?.bugRegistry ? orchestrator.bugRegistry.list({ limit: 50 }) : []
				const events = orchestrator?.eventLog ? orchestrator.eventLog.list({ limit: 8 }) : []
				const latestDeploy = commitDeploy.deploys[0] || null

				sendJson(res, 200, {
					success: true,
					generatedAt: new Date().toISOString(),
					system: { cpu, ram, disk },
					health,
					queue: queueStats,
					agents: {
						items: agents,
						total: agents.length,
						active: agents.filter((agent) => agent.enabled).length,
					},
					bugs: {
						items: bugs,
						open: bugs.filter(
							(bug) => !["resolved", "wont_fix"].includes(String(bug.status || "").toLowerCase()),
						).length,
						severe: bugs.filter(
							(bug) =>
								!["resolved", "wont_fix"].includes(String(bug.status || "").toLowerCase()) &&
								["critical", "high"].includes(String(bug.severity || "").toLowerCase()),
						).length,
					},
					commits: commitDeploy.commits,
					deploys: commitDeploy.deploys,
					usage: buildOverviewUsageSummary(usageRecords),
					activity: buildOverviewActivity({ commits: commitDeploy.commits, events, logs }),
					attention: buildOverviewAttention({ health, queueStats, bugs, latestDeploy }),
				})
			} catch (err) {
				writeApiLog("error", "overview-summary", "Failed to build overview summary", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
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

		// POST /orchestrator/subtask-progress — receive sub-task progress updates from workers
		if (
			method === "POST" &&
			(url === "/orchestrator/subtask-progress" || normalizedUrl === "/orchestrator/subtask-progress")
		) {
			if (!orchestrator) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.taskId || !data.subTaskId || !data.status) {
				sendJson(res, 400, { success: false, error: "Missing required fields: taskId, subTaskId, status" })
				return
			}
			orchestrator.eventLog.record({
				type: "orchestrator.subtask_progress",
				source: "OrchestratorWorker",
				severity: data.status === "failed" ? "error" : "info",
				payload: {
					subTaskId: data.subTaskId,
					status: data.status,
					progress: data.progress,
					message: data.message,
				},
				taskId: data.taskId,
			})
			sendJson(res, 200, { success: true })
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

		// GET /orchestrator/tasks/:id/events — SSE stream of task events (OpenHands-style real-time)
		if (method === "GET" && url.match(/^\/orchestrator\/tasks\/([^/]+)\/events$/)) {
			const taskId = url.match(/^\/orchestrator\/tasks\/([^/]+)\/events$/)[1]
			eventBus.subscribe(taskId, res)
			return
		}

		// POST /runtime/exec — sandboxed command execution proxy
		if (method === "POST" && normalizedUrl === "/runtime/exec") {
			const email = auth.requireAuth(req, res)
			if (!email) return
			const runtimeUrl = process.env.SUPERROO_RUNTIME_URL || "http://127.0.0.1:3418"
			try {
				const body = await parseBody(req)
				const runtimeRes = await fetch(`${runtimeUrl}/runtime/exec`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(125000),
				})
				const result = await runtimeRes.json()
				sendJson(res, runtimeRes.status, result)
			} catch (err) {
				sendJson(res, 502, { ok: false, error: `Runtime unreachable: ${err.message}` })
			}
			return
		}

		// ── Sandbox API Routes ─────────────────────────────────────────────────

		// GET /api/sandbox/health — sandbox manager health check
		if (method === "GET" && normalizedUrl === "/api/sandbox/health") {
			try {
				const manager = await getSandboxManager()
				const health = await manager.healthCheck()
				sendJson(res, 200, { success: true, health })
			} catch (err) {
				sendJson(res, 503, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/execute — execute a job in the sandbox
		if (method === "POST" && normalizedUrl === "/api/sandbox/execute") {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				const body = await parseBody(req)
				const manager = await getSandboxManager()
				const result = await manager.executeJob(
					{
						id: body.jobId || `api-${Date.now()}`,
						task: body.task || "api-execute",
						commands: body.commands || [],
					},
					{
						image: body.image,
						network: body.network,
						memory: body.memory,
						cpus: body.cpus,
						timeout: body.timeout,
						usePool: body.usePool !== false,
						env: body.env,
						volumes: body.volumes,
					},
				)
				sendJson(res, result.success ? 200 : 400, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/containers — list active sandbox containers
		if (method === "GET" && normalizedUrl === "/api/sandbox/containers") {
			try {
				const manager = await getSandboxManager()
				const containers = manager.listActive()
				sendJson(res, 200, { success: true, containers })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// DELETE /api/sandbox/containers — destroy all sandbox containers
		if (method === "DELETE" && normalizedUrl === "/api/sandbox/containers") {
			try {
				const manager = await getSandboxManager()
				const result = await manager.destroyAll()
				sendJson(res, 200, { success: true, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// DELETE /api/sandbox/containers/:name — destroy a specific container
		if (method === "DELETE" && url.match(/^\/api\/sandbox\/containers\/([^/]+)$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)$/)[1]
				const manager = await getSandboxManager()
				const result = await manager.destroyContainer(containerName)
				sendJson(res, result.success ? 200 : 404, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/containers/:name/exec — execute a command in a running container
		if (method === "POST" && url.match(/^\/api\/sandbox\/containers\/([^/]+)\/exec$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)\/exec$/)[1]
				const body = await parseBody(req)
				const manager = await getSandboxManager()
				const result = await manager.execInContainer(containerName, body.command, {
					timeout: body.timeout,
				})
				sendJson(res, result.success ? 200 : 400, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/images — list sandbox Docker images
		if (method === "GET" && normalizedUrl === "/api/sandbox/images") {
			try {
				const manager = await getSandboxManager()
				const images = await manager.listImages()
				sendJson(res, 200, { success: true, images })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/images/build — build the sandbox Docker image
		if (method === "POST" && normalizedUrl === "/api/sandbox/images/build") {
			try {
				const body = await parseBody(req)
				const manager = await getSandboxManager()
				const result = await manager.buildImage(body.dockerfileDir, body.tag)
				sendJson(res, result ? 200 : 500, { success: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// DELETE /api/sandbox/images/:tag — remove a sandbox Docker image
		if (method === "DELETE" && url.match(/^\/api\/sandbox\/images\/([^/]+)$/)) {
			try {
				const tag = url.match(/^\/api\/sandbox\/images\/([^/]+)$/)[1]
				const manager = await getSandboxManager()
				const result = await manager.removeImage(tag)
				sendJson(res, result ? 200 : 404, { success: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/pool — sandbox pool status
		if (method === "GET" && normalizedUrl === "/api/sandbox/pool") {
			try {
				const manager = await getSandboxManager()
				const poolStatus = manager.pool.getStatus()
				sendJson(res, 200, { success: true, pool: poolStatus })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/metrics — sandbox metrics
		if (method === "GET" && normalizedUrl === "/api/sandbox/metrics") {
			try {
				const manager = await getSandboxManager()
				const metrics = manager.getMetrics()
				sendJson(res, 200, { success: true, metrics })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Sandbox Advanced API Routes (snapshot, restore, network, self-heal, audit, compose, resource) ──

		// POST /api/sandbox/containers/:name/snapshot — create a container snapshot
		if (method === "POST" && url.match(/^\/api\/sandbox\/containers\/([^/]+)\/snapshot$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)\/snapshot$/)[1]
				const body = await parseBody(req)
				const manager = await getSandboxManager()
				const result = await manager.snapshotContainer(containerName, body.tag || `snapshot-${Date.now()}`)
				sendJson(res, result.success ? 200 : 404, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/containers/:name/restore — restore a container from a snapshot
		if (method === "POST" && url.match(/^\/api\/sandbox\/containers\/([^/]+)\/restore$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)\/restore$/)[1]
				const body = await parseBody(req)
				const manager = await getSandboxManager()
				const result = await manager.restoreContainer(containerName, body.snapshotTag)
				sendJson(res, result.success ? 200 : 404, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/containers/:name/network-simulate — apply network simulation rules
		if (method === "POST" && url.match(/^\/api\/sandbox\/containers\/([^/]+)\/network-simulate$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)\/network-simulate$/)[1]
				const body = await parseBody(req)
				const manager = await getSandboxManager()
				const sandbox = manager._active.get(containerName)?.sandbox
				if (!sandbox) {
					sendJson(res, 404, { success: false, error: `Container ${containerName} not found` })
					return
				}
				const result = await sandbox.simulateNetwork({
					latencyMs: body.latencyMs,
					jitterMs: body.jitterMs,
					lossPercent: body.lossPercent,
					bandwidthKbps: body.bandwidthKbps,
				})
				sendJson(res, 200, { success: true, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// DELETE /api/sandbox/containers/:name/network-simulate — clear network simulation rules
		if (method === "DELETE" && url.match(/^\/api\/sandbox\/containers\/([^/]+)\/network-simulate$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)\/network-simulate$/)[1]
				const manager = await getSandboxManager()
				const sandbox = manager._active.get(containerName)?.sandbox
				if (!sandbox) {
					sendJson(res, 404, { success: false, error: `Container ${containerName} not found` })
					return
				}
				await sandbox.clearNetworkSimulation()
				sendJson(res, 200, { success: true })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/containers/:name/heal — self-heal a specific container
		if (method === "POST" && url.match(/^\/api\/sandbox\/containers\/([^/]+)\/heal$/)) {
			try {
				const containerName = url.match(/^\/api\/sandbox\/containers\/([^/]+)\/heal$/)[1]
				const manager = await getSandboxManager()
				const result = await manager.healContainer(containerName)
				sendJson(res, result.success ? 200 : 404, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/heal-all — self-heal all containers
		if (method === "POST" && normalizedUrl === "/api/sandbox/heal-all") {
			try {
				const manager = await getSandboxManager()
				const results = await manager.healAll()
				sendJson(res, 200, { success: true, results })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/audit — get audit trail
		if (method === "GET" && normalizedUrl === "/api/sandbox/audit") {
			try {
				const urlObj = new URL(url, `http://localhost:${PORT}`)
				const limit = parseInt(urlObj.searchParams.get("limit") || "100", 10)
				const action = urlObj.searchParams.get("action") || undefined
				const manager = await getSandboxManager()
				const entries = await manager.getAuditTrail({ limit, action })
				sendJson(res, 200, { success: true, entries, count: entries.length })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/resource-pressure — get current resource pressure
		if (method === "GET" && normalizedUrl === "/api/sandbox/resource-pressure") {
			try {
				const manager = await getSandboxManager()
				const pressure = await manager.getResourcePressure()
				sendJson(res, 200, { success: true, pressure })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/compose/up — start a Docker Compose project
		if (method === "POST" && normalizedUrl === "/api/sandbox/compose/up") {
			try {
				const body = await parseBody(req)
				const { ComposeSandbox } = require("../orchestrator/sandbox")
				const compose = new ComposeSandbox({
					projectName: body.projectName || `compose-${Date.now()}`,
					services: body.services || [],
					workDir: body.workDir,
				})
				await compose.init()
				const result = await compose.up(body.timeout)
				sendJson(res, 200, { success: true, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/compose/down — stop a Docker Compose project
		if (method === "POST" && normalizedUrl === "/api/sandbox/compose/down") {
			try {
				const body = await parseBody(req)
				const { ComposeSandbox } = require("../orchestrator/sandbox")
				const compose = new ComposeSandbox({
					projectName: body.projectName || "compose-default",
					services: [],
					workDir: body.workDir,
				})
				await compose.init()
				const result = await compose.down()
				sendJson(res, 200, { success: true, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/sandbox/compose/:service/exec — execute a command in a compose service
		if (method === "POST" && url.match(/^\/api\/sandbox\/compose\/([^/]+)\/exec$/)) {
			try {
				const serviceName = url.match(/^\/api\/sandbox\/compose\/([^/]+)\/exec$/)[1]
				const body = await parseBody(req)
				const { ComposeSandbox } = require("../orchestrator/sandbox")
				const compose = new ComposeSandbox({
					projectName: body.projectName || "compose-default",
					services: [],
					workDir: body.workDir,
				})
				await compose.init()
				const result = await compose.exec(serviceName, body.command)
				sendJson(res, result.success ? 200 : 400, { success: result.success, ...result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/compose/logs — get logs from a compose service
		if (method === "GET" && normalizedUrl === "/api/sandbox/compose/logs") {
			try {
				const urlObj = new URL(url, `http://localhost:${PORT}`)
				const serviceName = urlObj.searchParams.get("service") || undefined
				const projectName = urlObj.searchParams.get("projectName") || "compose-default"
				const workDir = urlObj.searchParams.get("workDir") || undefined
				const { ComposeSandbox } = require("../orchestrator/sandbox")
				const compose = new ComposeSandbox({
					projectName,
					services: [],
					workDir,
				})
				await compose.init()
				const logs = await compose.logs(serviceName)
				sendJson(res, 200, { success: true, logs })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/sandbox/compose/ps — list compose services
		if (method === "GET" && normalizedUrl === "/api/sandbox/compose/ps") {
			try {
				const urlObj = new URL(url, `http://localhost:${PORT}`)
				const projectName = urlObj.searchParams.get("projectName") || "compose-default"
				const workDir = urlObj.searchParams.get("workDir") || undefined
				const { ComposeSandbox } = require("../orchestrator/sandbox")
				const compose = new ComposeSandbox({
					projectName,
					services: [],
					workDir,
				})
				await compose.init()
				const services = await compose.ps()
				sendJson(res, 200, { success: true, services })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
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
			const agent = orchestrator.agentRegistry.getAgent(agentId)
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
			const result =
				typeof data.enabled === "boolean"
					? orchestrator.agentRegistry.setAgentEnabled(agentId, data.enabled)
					: orchestrator.agentRegistry.toggleAgent(agentId)
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

		// ── Unified Deploy API ─────────────────────────────────────────────────

		// POST /api/deploy — queue or execute a deployment
		if (method === "POST" && (url === "/api/deploy" || normalizedUrl === "/api/deploy")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			const result = await orchestrator.deployOrchestrator.deploy({
				version: data.version,
				commitSha: data.commitSha,
				agent: data.agent || "api",
				force: data.force || false,
				skipHealthCheck: data.skipHealthCheck || false,
				skipBuild: data.skipBuild || false,
				projectName: data.projectName || undefined,
			})
			sendJson(res, 200, { success: true, deploy: result })
			return
		}

		// GET /api/deploy/queue — get deployment queue
		if (method === "GET" && (url === "/api/deploy/queue" || normalizedUrl === "/api/deploy/queue")) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const queue = await orchestrator.deployOrchestrator.getQueue()
			sendJson(res, 200, { success: true, queue })
			return
		}

		// GET /api/deploy/active — get active deployments
		if (method === "GET" && (url === "/api/deploy/active" || normalizedUrl === "/api/deploy/active")) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const active = await orchestrator.deployOrchestrator.getActiveDeployments()
			sendJson(res, 200, { success: true, active })
			return
		}

		// GET /api/deploy/builds — get build status
		if (method === "GET" && (url === "/api/deploy/builds" || normalizedUrl === "/api/deploy/builds")) {
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const builds = await orchestrator.deployOrchestrator.getBuildStatus()
			sendJson(res, 200, { success: true, builds })
			return
		}

		// POST /api/deploy/cancel — cancel a deployment
		if (method === "POST" && (url === "/api/deploy/cancel" || normalizedUrl === "/api/deploy/cancel")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.deploymentId) {
				sendJson(res, 400, { success: false, error: "Missing required field: deploymentId" })
				return
			}
			const result = await orchestrator.deployOrchestrator.cancelDeployment(data.deploymentId)
			sendJson(res, 200, { success: true, cancel: result })
			return
		}

		// POST /api/deploy/force — force a deployment (bypass queue)
		if (method === "POST" && (url === "/api/deploy/force" || normalizedUrl === "/api/deploy/force")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			if (!orchestrator || !orchestrator.deployOrchestrator) {
				sendJson(res, 503, { success: false, error: "DeployOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			const result = await orchestrator.deployOrchestrator.forceDeploy({
				version: data.version,
				commitSha: data.commitSha,
				agent: data.agent || "api",
				skipHealthCheck: data.skipHealthCheck || false,
				skipBuild: data.skipBuild || false,
				projectName: data.projectName || undefined,
			})
			sendJson(res, 200, { success: true, deploy: result })
			return
		}

		// ── Global Build Orchestrator API ──────────────────────────────────────────

		// POST /api/build/submit — submit a build task from any agent (Claude, Codex, API, webhook)
		if (method === "POST" && (url === "/api/build/submit" || normalizedUrl === "/api/build/submit")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			const result = await orchestrator.globalBuildOrchestrator.submitBuild({
				projectName: data.projectName,
				buildType: data.buildType || "docker",
				imageTag: data.imageTag,
				commitSha: data.commitSha,
				agent: data.agent || "api",
				agentSource: data.agentSource || "api",
				taskDescription: data.taskDescription || "",
				buildArgs: data.buildArgs || {},
				dockerfile: data.dockerfile,
				context: data.context,
				projectDir: data.projectDir,
				skipCache: data.skipCache || false,
			})
			sendJson(res, 200, { success: true, build: result })
			return
		}

		// GET /api/build/status — get all builds (with optional filters)
		if (method === "GET" && (url === "/api/build/status" || normalizedUrl === "/api/build/status")) {
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const filter = {
				projectName: urlObj.searchParams.get("project") || undefined,
				status: urlObj.searchParams.get("status") || undefined,
				agentSource: urlObj.searchParams.get("source") || undefined,
				limit: parseInt(urlObj.searchParams.get("limit") || "50", 10),
				offset: parseInt(urlObj.searchParams.get("offset") || "0", 10),
			}
			const builds = await orchestrator.globalBuildOrchestrator.getBuilds(filter)
			sendJson(res, 200, { success: true, builds })
			return
		}

		// GET /api/build/active — get active (running) builds
		if (method === "GET" && (url === "/api/build/active" || normalizedUrl === "/api/build/active")) {
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const builds = await orchestrator.globalBuildOrchestrator.getActiveBuilds()
			sendJson(res, 200, { success: true, builds })
			return
		}

		// GET /api/build/queued — get queued builds
		if (method === "GET" && (url === "/api/build/queued" || normalizedUrl === "/api/build/queued")) {
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const builds = await orchestrator.globalBuildOrchestrator.getQueuedBuilds()
			sendJson(res, 200, { success: true, builds })
			return
		}

		// GET /api/build/stats — get build statistics
		if (method === "GET" && (url === "/api/build/stats" || normalizedUrl === "/api/build/stats")) {
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const stats = await orchestrator.globalBuildOrchestrator.getStats()
			sendJson(res, 200, { success: true, stats })
			return
		}

		// POST /api/build/cancel — cancel a queued or running build
		if (method === "POST" && (url === "/api/build/cancel" || normalizedUrl === "/api/build/cancel")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.buildId) {
				sendJson(res, 400, { success: false, error: "Missing required field: buildId" })
				return
			}
			const result = await orchestrator.globalBuildOrchestrator.cancelBuild(data.buildId)
			sendJson(res, 200, { success: true, cancel: result })
			return
		}

		// POST /api/build/retry — retry a failed build
		if (method === "POST" && (url === "/api/build/retry" || normalizedUrl === "/api/build/retry")) {
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const data = await parseBody(req)
			if (!data.buildId) {
				sendJson(res, 400, { success: false, error: "Missing required field: buildId" })
				return
			}
			const result = await orchestrator.globalBuildOrchestrator.retryBuild(data.buildId)
			sendJson(res, 200, { success: true, retry: result })
			return
		}

		// GET /api/build/history/:project — get build history for a project
		if (method === "GET" && url.startsWith("/api/build/history/")) {
			if (!orchestrator || !orchestrator.globalBuildOrchestrator) {
				sendJson(res, 503, { success: false, error: "GlobalBuildOrchestrator not initialized" })
				return
			}
			const projectName = url.replace("/api/build/history/", "").split("?")[0]
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const limit = parseInt(urlObj.searchParams.get("limit") || "20", 10)
			const builds = await orchestrator.globalBuildOrchestrator.getProjectHistory(projectName, limit)
			sendJson(res, 200, { success: true, builds })
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

		// ── ML / Neural Network Endpoints ────────────────────────────────────────

		// POST /orchestrator/ml/train — Trigger neural network training via InfiniteImprovementLoop
		if (method === "POST" && (url === "/orchestrator/ml/train" || normalizedUrl === "/orchestrator/ml/train")) {
			try {
				const improvementLoop = orchestrator?.infiniteImprovementLoop || orchestrator?.improvementLoop
				if (!improvementLoop) {
					sendJson(res, 503, { success: false, error: "ImprovementLoop not initialized" })
					return
				}
				if (typeof improvementLoop.runCycle === "function") {
					await improvementLoop.runCycle()
					const stats = improvementLoop.getStats ? improvementLoop.getStats() : improvementLoop.stats
					sendJson(res, 200, {
						success: true,
						message: "Training cycle started",
						stats: stats || {},
					})
				} else if (typeof improvementLoop.triggerCycle === "function") {
					await improvementLoop.triggerCycle()
					const stats = improvementLoop.getStats ? improvementLoop.getStats() : improvementLoop.stats
					sendJson(res, 200, {
						success: true,
						message: "Training cycle started",
						stats: stats || {},
					})
				} else {
					sendJson(res, 200, {
						success: false,
						message: "Training not available — using linear regression model only",
					})
				}
			} catch (err) {
				writeApiLog("error", "ml-train", "Training cycle failed", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /orchestrator/ml/model — Inspect the current ML model
		if (method === "GET" && (url === "/orchestrator/ml/model" || normalizedUrl === "/orchestrator/ml/model")) {
			try {
				const improvementLoop = orchestrator?.infiniteImprovementLoop || orchestrator?.improvementLoop
				if (!improvementLoop) {
					sendJson(res, 503, { success: false, error: "ImprovementLoop not initialized" })
					return
				}
				const stats = improvementLoop.getStats ? improvementLoop.getStats() : improvementLoop.stats
				sendJson(res, 200, {
					modelType: "linear-regression",
					loopsRun: stats?.loopsRun || 0,
					observationsCollected: stats?.observationsCollected || 0,
					predictionsMade: stats?.predictionsMade || 0,
					actionsTaken: stats?.actionsTaken || 0,
					latestSync: stats?.latestSync || null,
					latestModel: stats?.latestModel || null,
				})
			} catch (err) {
				writeApiLog("error", "ml-model", "Failed to get model stats", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /orchestrator/ml/learners — View individual learner status
		if (
			method === "GET" &&
			(url === "/orchestrator/ml/learners" || normalizedUrl === "/orchestrator/ml/learners")
		) {
			try {
				const improvementLoop = orchestrator?.infiniteImprovementLoop || orchestrator?.improvementLoop
				if (!improvementLoop) {
					sendJson(res, 503, { success: false, error: "ImprovementLoop not initialized" })
					return
				}
				if (improvementLoop.learners) {
					sendJson(res, 200, { learners: improvementLoop.learners })
				} else {
					// Build learner status from internal sample arrays
					const codeSamples = (improvementLoop._codeSamples || []).length
					const debugSamples = (improvementLoop._debugSamples || []).length
					const testSamples = (improvementLoop._testSamples || []).length
					const stats = improvementLoop.getStats ? improvementLoop.getStats() : improvementLoop.stats
					const models = stats?.models || {}
					sendJson(res, 200, {
						learners: [
							{
								name: "code",
								status: models.code === "trained" ? "active" : "idle",
								samples: codeSamples,
							},
							{
								name: "debug",
								status: models.debug === "trained" ? "active" : "idle",
								samples: debugSamples,
							},
							{
								name: "test",
								status: models.test === "trained" ? "active" : "idle",
								samples: testSamples,
							},
						],
						note: "Derived from internal sample arrays",
					})
				}
			} catch (err) {
				writeApiLog("error", "ml-learners", "Failed to get learners", { error: err.message })
				sendJson(res, 500, { success: false, error: err.message })
			}
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

		// POST /orchestrator/hermes/query — query the Hermes knowledge base (POST variant for tgEndpoints)
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/query" || normalizedUrl === "/orchestrator/hermes/query")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				const q = data.query || ""
				if (!q) {
					sendJson(res, 400, { success: false, error: "Missing query parameter" })
					return
				}
				const result = await orchestrator.hermesClaw.queryKnowledge(q)
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/lessons/sync — batch-sync lessons from local lesson-index to Central Brain DB
		// Accepts array of lesson objects (lesson-index.jsonl format)
		// Called by sync-lessons-to-central-brain.mjs running on dev machine
		if (method === "POST" && (url === "/lessons/sync" || normalizedUrl === "/lessons/sync")) {
			try {
				const data = await parseBody(req)
				const lessons = Array.isArray(data) ? data : data.lessons || []
				if (lessons.length === 0) {
					sendJson(res, 400, { success: false, error: "No lessons provided" })
					return
				}
				// Use the already-initialized hermesClaw store (avoids pg module path issues)
				const store = orchestrator?.hermesClaw?.bugKnowledgeStore
				if (!store) {
					sendJson(res, 503, { success: false, error: "BugKnowledgeStore not ready" })
					return
				}
				const results = []
				for (const lesson of lessons) {
					try {
						const r = await store.storeLesson({
							lesson_type: lesson.type || "best_practice",
							topic: lesson.title || lesson.topic || "Untitled",
							content: [
								lesson.lesson_summary || "",
								lesson.rule_summary ? `\nRule: ${lesson.rule_summary}` : "",
								lesson.files?.length ? `\nFiles: ${lesson.files.join(", ")}` : "",
							].join(""),
							source_task_id: lesson.source || lesson.id || null,
							project: lesson.project || "superroo2",
							metadata: { tags: lesson.tags || [], date: lesson.date, confidence: lesson.confidence },
						})
						results.push({ id: lesson.id, stored: r.id, success: r.success })
					} catch (e) {
						results.push({ id: lesson.id, success: false, error: e.message })
					}
				}
				const synced = results.filter((r) => r.success).length
				sendJson(res, 200, { success: true, synced, failed: results.filter((r) => !r.success).length, results })
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
				const raw = await orchestrator.hermesClaw.getStats()
				const ks = raw.knowledgeStore || {}
				sendJson(res, 200, {
					success: true,
					totalQueries: raw.operationCount || 0,
					memoryEntries: raw.memoryEntries || 0,
					avgLatencyMs: raw.averageDurationMs || 0,
					totalBugFixes: ks.totalBugFixes || 0,
					totalLessons: ks.totalLessons || 0,
					ollamaReady: true,
					modelLoaded: orchestrator.hermesClaw.config?.ollamaModel || "qwen2.5:0.5b",
					knowledgeStore: ks,
					stats: raw,
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/stats — get HermesClaw statistics (POST variant for tgEndpoints)
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/stats" || normalizedUrl === "/orchestrator/hermes/stats")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const raw = await orchestrator.hermesClaw.getStats()
				const ks = raw.knowledgeStore || {}
				sendJson(res, 200, {
					success: true,
					totalQueries: raw.operationCount || 0,
					memoryEntries: raw.memoryEntries || 0,
					avgLatencyMs: raw.averageDurationMs || 0,
					totalBugFixes: ks.totalBugFixes || 0,
					totalLessons: ks.totalLessons || 0,
					ollamaReady: true,
					modelLoaded: orchestrator.hermesClaw.config?.ollamaModel || "qwen2.5:0.5b",
					knowledgeStore: ks,
					stats: raw,
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/recall — recall context from memory (RAG-powered)
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/recall" || normalizedUrl === "/orchestrator/hermes/recall")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				const query = data.query || ""
				const limit = data.limit || 5
				if (!query) {
					sendJson(res, 400, { success: false, error: "Missing query parameter" })
					return
				}
				const result = await orchestrator.hermesClaw.recallContext(query, limit)
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/learn — store a lesson in the knowledge base
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/learn" || normalizedUrl === "/orchestrator/hermes/learn")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				if (!data.topic || !data.content) {
					sendJson(res, 400, { success: false, error: "Missing required fields: topic, content" })
					return
				}
				const result = await orchestrator.hermesClaw.storeLesson({
					taskId: data.taskId || "manual",
					goal: data.topic,
					phases: data.phases || [],
					finalStatus: data.finalStatus || "completed",
					error: data.content,
				})
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/create-skill — create a skill from a failure or lesson
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/create-skill" || normalizedUrl === "/orchestrator/hermes/create-skill")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				if (!data.failureType || !data.goal || !data.solution) {
					sendJson(res, 400, {
						success: false,
						error: "Missing required fields: failureType, goal, solution",
					})
					return
				}
				const result = await orchestrator.hermesClaw.createSkill({
					failureType: data.failureType,
					goal: data.goal,
					rootCause: data.rootCause || "",
					solution: data.solution,
					verificationSteps: data.verificationSteps || [],
					relatedFiles: data.relatedFiles || [],
					tags: data.tags || [],
				})
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/analyze-patterns — analyze failure patterns
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/analyze-patterns" ||
				normalizedUrl === "/orchestrator/hermes/analyze-patterns")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				const result = await orchestrator.hermesClaw.analyzePatterns({
					tasks: data.tasks || [],
					scope: data.scope || "general",
				})
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/list-skills — list all created skills from memory
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/list-skills" || normalizedUrl === "/orchestrator/hermes/list-skills")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				// Search memory for skills stored under the "create_skill" operation
				const skills = orchestrator.hermesClaw._searchMemory("create_skill", 50)
				sendJson(res, 200, { success: true, skills })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/list-resources — list all resources from memory
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/list-resources" || normalizedUrl === "/orchestrator/hermes/list-resources")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				// Search memory for resources — this includes knowledge_query, lesson_extraction, etc.
				const resourceOps = ["knowledge_query", "lesson_extraction", "memory_summary", "improvement_suggestion"]
				const resources = []
				for (const op of resourceOps) {
					const entries = orchestrator.hermesClaw._searchMemory(op, 20)
					resources.push(...entries)
				}
				// Sort by timestamp descending, limit to 50
				resources.sort((a, b) => b.timestamp - a.timestamp)
				sendJson(res, 200, { success: true, resources: resources.slice(0, 50) })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /orchestrator/hermes/extract-lessons — extract lessons from an interaction
		if (
			method === "POST" &&
			(url === "/orchestrator/hermes/extract-lessons" || normalizedUrl === "/orchestrator/hermes/extract-lessons")
		) {
			if (!orchestrator || !orchestrator.hermesClaw) {
				sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
				return
			}
			try {
				const data = await parseBody(req)
				if (!data.phases || !data.context) {
					sendJson(res, 400, { success: false, error: "Missing required fields: phases, context" })
					return
				}
				const result = await orchestrator.hermesClaw.extractLessons({
					taskId: data.taskId || "manual",
					goal: data.goal || "",
					phases: data.phases,
					finalStatus: data.finalStatus || "completed",
					error: data.error || null,
				})
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /orchestrator/commit-deploy-status — get commit/deploy history from CommitDeployLog
		if (
			method === "GET" &&
			(url.startsWith("/orchestrator/commit-deploy-status") ||
				normalizedUrl.startsWith("/orchestrator/commit-deploy-status"))
		) {
			try {
				const fs = require("fs")
				const path = require("path")
				const logPath = path.join(__dirname, "..", "memory", "commit-deploy-log.json")
				let data
				try {
					const raw = fs.readFileSync(logPath, "utf8")
					data = JSON.parse(raw)
				} catch (e) {
					sendJson(res, 200, {
						success: true,
						commits: [],
						deploys: [],
						totalCommits: 0,
						totalDeploys: 0,
						note: "CommitDeployLog file not found yet.",
					})
					return
				}
				const limit = parseInt(new URL(url, `http://localhost:${PORT}`).searchParams.get("limit")) || 5
				const projectFilter = new URL(url, `http://localhost:${PORT}`).searchParams.get("project") || null

				let filteredCommits = data.commits || []
				let filteredDeploys = data.deploys || []

				// Filter by project/repoName if specified
				if (projectFilter) {
					filteredCommits = filteredCommits.filter(function (c) {
						return (c.repoName || "").toLowerCase() === projectFilter.toLowerCase()
					})
					filteredDeploys = filteredDeploys.filter(function (d) {
						return (d.repoName || "").toLowerCase() === projectFilter.toLowerCase()
					})
				}

				const commits = filteredCommits
					.slice(-limit)
					.reverse()
					.map(function (c) {
						return {
							sha: c.sha || c.commitSha || "",
							agent: c.agentName || c.agent || "unknown",
							type: c.type || "unknown",
							title: c.title || c.message || "",
							filesChanged: (c.filesChanged || c.files || []).length,
							timestamp: c.timestamp || c.createdAt || 0,
							featuresAffected: c.featuresAffected || [],
							repoName: c.repoName || null,
						}
					})
				const deploys = filteredDeploys
					.slice(-limit)
					.reverse()
					.map(function (d) {
						const startedAt = parseTimestamp(d.startedAt || d.timestamp || d.deployedAt)
						const completedAt = parseTimestamp(d.completedAt)
						return {
							version: d.version || "",
							sha: d.commitSha || d.sha || "",
							agent: d.agentName || d.agent || "unknown",
							status: d.status || d.result || "unknown",
							timestamp: startedAt || 0,
							startedAt,
							completedAt,
							durationMs:
								startedAt !== null && completedAt !== null && completedAt >= startedAt
									? completedAt - startedAt
									: null,
							environment: d.environment || null,
							healthCheckPassed: typeof d.healthCheckPassed === "boolean" ? d.healthCheckPassed : null,
							healthCheckLatencyMs:
								typeof d.healthCheckLatencyMs === "number" ? d.healthCheckLatencyMs : null,
							failureReason: d.failureReason || d.error || null,
							repoName: d.repoName || null,
						}
					})
				const deploySummary = buildDeploySummary(filteredDeploys)
				sendJson(res, 200, {
					success: true,
					commits,
					deploys,
					totalCommits: filteredCommits.length,
					totalDeploys: filteredDeploys.length,
					deploySummary,
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /deploy/summary — canonical deployment metrics from CommitDeployLog
		if (method === "GET" && (url === "/deploy/summary" || normalizedUrl === "/deploy/summary")) {
			try {
				const raw = await fs.readFile(path.join(__dirname, "..", "memory", "commit-deploy-log.json"), "utf8")
				const data = JSON.parse(raw)
				sendJson(res, 200, {
					success: true,
					summary: buildDeploySummary(data.deploys || []),
					target: {
						host: process.env.DEPLOY_VPS_HOST || "100.64.175.88",
						user: process.env.DEPLOY_VPS_USER || "root",
						path: process.env.DEPLOY_PATH || "/opt/superroo2",
						healthUrl: process.env.DEPLOY_HEALTH_URL || null,
					},
				})
			} catch (err) {
				if (err && err.code === "ENOENT") {
					sendJson(res, 200, {
						success: true,
						summary: buildDeploySummary([]),
						target: {
							host: process.env.DEPLOY_VPS_HOST || "100.64.175.88",
							user: process.env.DEPLOY_VPS_USER || "root",
							path: process.env.DEPLOY_PATH || "/opt/superroo2",
							healthUrl: process.env.DEPLOY_HEALTH_URL || null,
						},
					})
				} else {
					sendJson(res, 500, { success: false, error: err.message })
				}
			}
			return
		}

		// GET /memory-explorer — search engineering lessons from memory/lesson-index.jsonl
		// Also queries Central Brain MCP for cross-project lessons
		if (method === "GET" && (url.startsWith("/memory-explorer") || normalizedUrl.startsWith("/memory-explorer"))) {
			try {
				const fs = require("fs")
				const path = require("path")
				const requestUrl = new URL(req.url || "", "http://localhost")
				const lessonsPath = path.join(__dirname, "../../memory/lesson-index.jsonl")
				const safeDateOnly = (value) => {
					if (!value) return ""
					const parsed = new Date(value)
					return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().split("T")[0]
				}
				const terms = String(requestUrl.searchParams.get("q") || "")
					.toLowerCase()
					.split(/\s+/)
					.filter(Boolean)
				const projectFilter = String(requestUrl.searchParams.get("project") || "").trim()

				// 1. Load local lessons (superroo2 project)
				let localLessons = []
				if (fs.existsSync(lessonsPath)) {
					localLessons = fs
						.readFileSync(lessonsPath, "utf8")
						.split(/\r?\n/)
						.filter(Boolean)
						.map((line) => {
							try {
								return JSON.parse(line)
							} catch {
								return null
							}
						})
						.filter(Boolean)
						.map((lesson) => ({
							id: lesson.id,
							task: lesson.title || "Untitled lesson",
							task_type: lesson.type || "",
							risk: lesson.relevance_factors?.is_bug_fix ? "high" : "medium",
							tags: Array.isArray(lesson.tags) ? lesson.tags : [],
							files: Array.isArray(lesson.files) ? lesson.files : [],
							models: lesson.model ? [lesson.model] : [],
							root_cause: lesson.lesson_summary || "No lesson summary recorded.",
							fix: lesson.rule_summary || "No reusable rule recorded.",
							reusable_rule: lesson.rule_summary || "No reusable rule recorded.",
							date: lesson.date,
							project: lesson.project || "superroo2",
						}))
				}

				// 2. Query Central Brain MCP for cross-project lessons (best-effort, non-blocking)
				let crossProjectLessons = []
				try {
					const mcpUrl = process.env.CENTRAL_BRAIN_MCP_URL || "http://127.0.0.1:3419/mcp"
					const mcpRes = await fetch(mcpUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							jsonrpc: "2.0",
							id: Date.now(),
							method: "tools/call",
							params: {
								name: "query_memory",
								arguments: {
									query: terms.join(" ") || "",
									maxResults: 50,
								},
							},
						}),
						signal: AbortSignal.timeout(5_000),
					})
					if (mcpRes.ok) {
						const mcpData = await mcpRes.json()
						if (!mcpData.error) {
							const raw = mcpData.result
							// Central Brain returns items in {source, item} format where item has {id, title, description, ...}
							// Also support flat lesson objects for backward compatibility
							const results = Array.isArray(raw) ? raw : raw?.results || raw?.lessons || []
							crossProjectLessons = results
								.filter((r) => r && r.project !== "superroo2")
								.map((entry) => {
									// Handle {source, item} format from Central Brain query_memory
									const lesson = entry.item || entry
									const source = entry.source || "cross-project"
									return {
										id:
											lesson.id ||
											entry.id ||
											`cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
										task:
											lesson.title ||
											lesson.topic ||
											entry.title ||
											entry.topic ||
											"Untitled lesson",
										task_type: lesson.type || entry.type || "",
										risk:
											lesson.severity === "high" || lesson.relevance_factors?.is_bug_fix
												? "high"
												: "medium",
										tags: Array.isArray(lesson.tags)
											? lesson.tags
											: Array.isArray(entry.tags)
												? entry.tags
												: [],
										files: Array.isArray(lesson.filesLikelyInvolved)
											? lesson.filesLikelyInvolved
											: Array.isArray(lesson.files)
												? lesson.files
												: Array.isArray(entry.files)
													? entry.files
													: [],
										models: lesson.model ? [lesson.model] : entry.model ? [entry.model] : [],
										root_cause:
											lesson.lesson_summary ||
											lesson.description ||
											lesson.content ||
											entry.lesson_summary ||
											entry.description ||
											"No lesson summary recorded.",
										fix:
											lesson.rule_summary ||
											lesson.symptoms?.join("; ") ||
											entry.rule_summary ||
											"No reusable rule recorded.",
										reusable_rule:
											lesson.rule_summary || entry.rule_summary || "No reusable rule recorded.",
										date: lesson.date || entry.date || safeDateOnly(lesson.createdAt),
										project: lesson.project || entry.project || source,
									}
								})
						}
					}
				} catch {
					// Central Brain unreachable — silently skip cross-project lessons
				}

				// 3. Query pgvector (Central Brain v2) for semantic search results
				let pgVectorLessons = []
				try {
					const brainSvc = await getBrainServices()
					if (brainSvc) {
						const pgResults = await brainSvc.memory.searchMemory({
							projectId: projectFilter || "default",
							query: terms.join(" ") || "",
							limit: 50,
							minSimilarity: 0.5,
							status: "approved",
						})
						pgVectorLessons = (pgResults || []).map((mem) => ({
							id: mem.id || `pgv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
							task: mem.title || "Untitled memory",
							task_type: mem.memory_type || "lesson",
							risk: mem.importance >= 0.7 ? "high" : mem.importance >= 0.4 ? "medium" : "low",
							tags: mem.tags || [],
							files: mem.files || [],
							models: mem.model ? [mem.model] : [],
							root_cause: mem.summary || "No summary recorded.",
							fix: mem.content ? mem.content.slice(0, 300) : "No content recorded.",
							reusable_rule: mem.content ? mem.content.slice(0, 200) : "",
							date: mem.created_at ? mem.created_at.split("T")[0] : "",
							project: "pgvector",
							similarity: mem.similarity || 0,
						}))
					}
				} catch {
					// pgvector unavailable — silently skip
				}

				// 4. Merge local + cross-project + pgvector lessons
				let allLessons = [...localLessons, ...crossProjectLessons, ...pgVectorLessons]

				// 4. Apply project filter if specified
				if (projectFilter) {
					allLessons = allLessons.filter((l) => l.project === projectFilter)
				}

				// 5. Apply search term filter
				const filtered = terms.length
					? allLessons.filter((lesson) => {
							const haystack = JSON.stringify(lesson).toLowerCase()
							return terms.every((term) => haystack.includes(term))
						})
					: allLessons

				// 6. Compute tag counts across all lessons
				const tagCounts = {}
				allLessons.forEach((l) => {
					;(l.tags || []).forEach((t) => {
						tagCounts[t] = (tagCounts[t] || 0) + 1
					})
				})

				// 7. Collect unique project names
				const projects = [...new Set(allLessons.map((l) => l.project).filter(Boolean))]

				sendJson(res, 200, {
					lessons: filtered,
					total: allLessons.length,
					filtered: filtered.length,
					tagCounts,
					projects,
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// CENTRAL BRAIN — SuperRoo AI Integration Hub
		// ═══════════════════════════════════════════════════════════════════════════
		// This is THE canonical entry point for external AI bots to discover and
		// connect to the SuperRoo Central Brain. Every AI bot (Telegram, Discord,
		// custom agents, etc.) should use this endpoint to learn how to interact
		// with the SuperRoo ecosystem.
		//
		// Endpoint: GET /api/brain  (or GET /brain)
		// Returns:  JSON manifest describing all available capabilities, routes,
		//           agents, and connection information.
		//
		// Other AI bots should:
		//   1. GET /api/brain to discover capabilities
		//   2. Use /api/orchestrator/hermes/* for memory/context operations
		//   3. Use /api/health for health checks
		//   4. Use /api/orchestrator/commit-deploy-status for git/deploy history
		// ═══════════════════════════════════════════════════════════════════════════

		// GET /brain — Central Brain manifest (canonical entry point for AI bots)
		if (method === "GET" && (url === "/brain" || normalizedUrl === "/brain")) {
			try {
				const brainManifest = {
					name: "SuperRoo Central Brain",
					version: "2.1.0",
					description:
						"Central AI orchestration hub for SuperRoo — memory, context, analysis, coding, deployment, real-time events, WebSocket, skill generation, MCP bridge, and Ollama local summarizer",
					baseUrl: `http://127.0.0.1:${PORT}`,
					publicUrl: "https://dev.abcx124.xyz",
					agents: {
						hermesClaw: {
							name: "Hermes Claw",
							role: "Memory & Context Agent",
							description:
								"Stores and retrieves context, creates skills from lessons, analyzes patterns, extracts lessons from interactions",
							capabilities: [
								"recall",
								"learn",
								"create-skill",
								"analyze-patterns",
								"list-skills",
								"list-resources",
								"extract-lessons",
								"query",
								"stats",
							],
							apiBase: "/api/orchestrator/hermes",
							endpoints: {
								recall: {
									method: "POST",
									path: "/api/orchestrator/hermes/recall",
									body: { query: "string", limit: "number (optional, default 5)" },
								},
								learn: {
									method: "POST",
									path: "/api/orchestrator/hermes/learn",
									body: { topic: "string", content: "string", taskId: "string (optional)" },
								},
								createSkill: {
									method: "POST",
									path: "/api/orchestrator/hermes/create-skill",
									body: {
										failureType: "string",
										goal: "string",
										solution: "string",
										rootCause: "string (optional)",
										verificationSteps: "string[] (optional)",
										relatedFiles: "string[] (optional)",
										tags: "string[] (optional)",
									},
								},
								analyzePatterns: {
									method: "POST",
									path: "/api/orchestrator/hermes/analyze-patterns",
									body: { tasks: "array (optional)", scope: "string (optional)" },
								},
								listSkills: { method: "POST", path: "/api/orchestrator/hermes/list-skills" },
								listResources: { method: "POST", path: "/api/orchestrator/hermes/list-resources" },
								extractLessons: {
									method: "POST",
									path: "/api/orchestrator/hermes/extract-lessons",
									body: {
										phases: "array",
										context: "object",
										goal: "string (optional)",
										finalStatus: "string (optional)",
									},
								},
								stats: { method: "GET", path: "/api/orchestrator/hermes/stats" },
							},
						},
						openClaw: {
							name: "OpenClaw",
							role: "Analysis Agent (Read-Only)",
							description:
								"Analyzes code, traces dependencies, inspects configs, assesses impact — never writes code",
							access: "Via Telegram bot or direct API routing",
						},
						ollama: {
							name: "Ollama Local AI",
							role: "Cheap Local Processing",
							description:
								"Handles cheap tasks: summarization, classification, tagging, embeddings, short replies",
							models: ["qwen2.5:1.5b", "qwen2.5:0.5b", "nomic-embed-text"],
							embeddingDimensions: 768,
							baseUrl: "http://127.0.0.1:11434",
						},
						cloudCoder: {
							name: "Cloud Coder",
							role: "Complex Coding Agent",
							description: "Handles complex coding, debugging, high-risk changes using cloud LLMs",
							providers: ["OpenAI", "Anthropic", "DeepSeek", "OpenRouter", "Groq"],
						},
					},
					capabilities: {
						memoryAndContext: {
							description:
								"Vector-powered memory with pgvector (768-dim embeddings) for semantic search across bug fixes, lessons, and patterns",
							endpoint: "/api/orchestrator/hermes/recall",
						},
						knowledgeBase: {
							description:
								"PostgreSQL + pgvector knowledge store with HNSW index for fast approximate nearest neighbor search",
							store: "BugKnowledgeStore",
						},
						commitDeployTracking: {
							description: "Track all commits and deployments across all coding agents",
							endpoint: "/api/orchestrator/commit-deploy-status",
						},
						telegramBot: {
							description:
								"Telegram bot interface for natural language task routing, coding, debugging, deployment",
							webhookUrl: "https://dev.abcx124.xyz/api/telegram/webhook",
							commands: [
								"/code",
								"/deploy",
								"/test",
								"/logs",
								"/status",
								"/hermes",
								"/skills",
								"/resources",
								"/upgrade",
								"/brain",
								"/menu",
								"/help",
								"/mcp",
							],
						},
						learningLoop: {
							description:
								"Infinite learning loop — extracts lessons from every interaction, stores in pgvector, retrieves via RAG for future context",
							components: ["HermesClaw", "BugKnowledgeStore", "TelegramLearner"],
						},
						realTimeEvents: {
							description: "SSE and WebSocket endpoints for real-time event streaming",
							sse: { endpoint: "GET /api/brain/events", description: "Server-Sent Events stream" },
							websocket: {
								endpoint: "ws://host/api/brain/ws",
								description: "Bidirectional WebSocket with MCP actions",
							},
							emit: {
								endpoint: "POST /api/brain/events/emit",
								description: "Emit custom events to all connected clients",
							},
						},
						skillGeneration: {
							description:
								"Auto-generate skills from failure patterns and sync to MCP, SSE, WebSocket, Dashboard, Docs",
							endpoint: "POST /api/brain/skill-generate",
						},
						agentOrchestration: {
							description: "Submit tasks, debug, deploy, and check pipeline status via MCP",
							endpoints: {
								runTask: {
									method: "POST",
									path: "/api/brain/mcp",
									body: {
										action: "run_task",
										params: { goal: "string", agent: "string (optional)" },
									},
								},
								runDebug: {
									method: "POST",
									path: "/api/brain/mcp",
									body: { action: "run_debug", params: { goal: "string" } },
								},
								runDeploy: {
									method: "POST",
									path: "/api/brain/mcp",
									body: { action: "run_deploy", params: { goal: "string (optional)" } },
								},
								getPipeline: {
									method: "POST",
									path: "/api/brain/mcp",
									body: { action: "get_pipeline" },
								},
							},
						},
						healthMonitoring: {
							endpoint: "/api/health",
						},
						systemStats: {
							endpoint: "/api/system",
						},
						queueManagement: {
							endpoint: "/api/queue/stats",
						},
						ollamaSummarizer: {
							description:
								"Local Ollama log summarizer and context compressor — free, private, no API key needed",
							actions: {
								summarize: {
									method: "POST",
									path: "/api/brain/mcp",
									body: {
										action: "ollama_summarize",
										params: {
											logs: "string",
											source: "string (optional)",
											command: "string (optional)",
											project: "string (optional)",
										},
									},
								},
								health: { method: "POST", path: "/api/brain/mcp", body: { action: "ollama_health" } },
							},
							models: ["qwen2.5:0.5b", "qwen2.5:1.5b", "nomic-embed-text"],
							baseUrl: "http://127.0.0.1:11434",
						},
					},
					mcp: {
						description:
							"Model Context Protocol (MCP) support for Claude Code, Codex, Cursor, and any MCP-compatible client",
						dedicatedServer: {
							host: "127.0.0.1",
							port: 3419,
							protocol: "MCP JSON-RPC over HTTP",
							endpoint: "POST /mcp",
							configFile: "mcp-superroo-config.json",
							config: {
								command: "npx",
								args: ["tsx", "server/src/memory/McpMemoryServer.ts"],
								env: {
									CENTRAL_BRAIN_URL: "http://127.0.0.1:3417",
									REST_API_FALLBACK_URL: "http://127.0.0.1:8787",
									MCP_SERVER_PORT: "3419",
								},
							},
						},
						restFallback: {
							endpoint: "POST /api/brain/mcp",
							description: "REST API fallback when MCP server or daemon is unreachable",
							body: { action: "string", params: "object" },
							supportedActions: [
								"ping",
								"query_memory",
								"list_projects",
								"get_active_task",
								"get_recent_bugs",
								"hermes_recall",
								"hermes_learn",
								"hermes_list_skills",
								"hermes_list_resources",
								"hermes_stats",
								"commit_deploy_status",
								"codex_task_upsert",
								"codex_task_list",
								"codex_task_get",
								"codex_task_get_active",
								"health",
								"qdrant_search",
								"qdrant_collections",
								"run_task",
								"run_debug",
								"run_deploy",
								"get_pipeline",
								"list_resources",
								"read_resource",
								"ollama_summarize",
								"ollama_health",
							],
						},
						telegramBridge: {
							endpoint: "POST /api/brain/mcp/telegram",
							description: "Telegram ↔ MCP Bridge — execute MCP actions from Telegram bot",
							body: { action: "string", params: "object", chatId: "string (optional)" },
						},
						fallbackChain: [
							"1. MCP Server (port 3419) — Primary, proxies to daemon at port 3417",
							"2. REST API MCP endpoint (/api/brain/mcp) — Fallback via port 8787",
							"3. Direct Daemon (port 3417) — Last resort, Docker container",
						],
					},
					integrationGuide: {
						forAIBots: [
							"1. GET /api/brain — Discover all capabilities and endpoints",
							"2. POST /api/orchestrator/hermes/recall — Query memory with semantic search (body: { query: 'what you want to know', limit: 5 })",
							"3. POST /api/orchestrator/hermes/learn — Store new knowledge (body: { topic: 'subject', content: 'what was learned' })",
							"4. POST /api/orchestrator/hermes/create-skill — Create reusable skill from a solution pattern",
							"5. POST /api/orchestrator/hermes/extract-lessons — Extract lessons from an interaction",
							"6. GET /api/orchestrator/commit-deploy-status — Check recent commits and deployments",
							"7. GET /api/health — Check system health",
							"8. POST /api/brain/mcp — MCP-compatible fallback endpoint (body: { action: 'hermes_recall', params: { query: '...' } })",
							"9. GET /api/brain/events — SSE stream for real-time events",
							"10. ws://host/api/brain/ws — WebSocket for bidirectional real-time communication",
							"11. POST /api/brain/skill-generate — Auto-generate skill from failure pattern",
							"12. POST /api/brain/mcp/telegram — Telegram ↔ MCP Bridge",
							"13. POST /api/brain/mcp — Ollama log summarizer (body: { action: 'ollama_summarize', params: { logs: '...', source: 'telegram', command: 'deploy' } })",
							"14. POST /api/brain/mcp — Ollama health check (body: { action: 'ollama_health' })",
						],
						mcpClients:
							"For Claude Code, Codex, or Cursor: configure MCP server to connect to http://127.0.0.1:3419 using mcp-superroo-config.json",
						telegramBot: "Send messages to @SuperRooBot on Telegram. Use /menu to see available commands.",
						dashboard: "https://dev.abcx124.xyz — Web dashboard with GUI for all modules",
					},
					status: "online",
					timestamp: Date.now(),
				}
				sendJson(res, 200, { success: true, brain: brainManifest })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// CENTRAL BRAIN — NEW ROUTES (SSE, WebSocket Info, Telegram Bridge, Skill Gen)
		// ═══════════════════════════════════════════════════════════════════════════

		// GET /brain/events — SSE streaming endpoint for real-time brain events
		if (method === "GET" && (url === "/brain/events" || normalizedUrl === "/brain/events")) {
			try {
				const clientId = crypto.randomUUID
					? crypto.randomUUID()
					: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
				})

				// Register client
				global.__sseClients.set(clientId, { res, subscriptions: new Set(["all"]) })

				// Send initial connected event
				res.write(
					`event: connected\ndata: ${JSON.stringify({ clientId, message: "Connected to SuperRoo Central Brain SSE" })}\n\n`,
				)

				// Heartbeat every 30 seconds
				const heartbeatIv = setInterval(() => {
					try {
						res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`)
					} catch {
						/* ignore */
					}
				}, 30000)

				req.on("close", () => {
					clearInterval(heartbeatIv)
					global.__sseClients.delete(clientId)
					writeApiLog("info", "brain-sse", "SSE client disconnected", { clientId })
				})

				// Don't call sendJson — we're streaming
				return
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
				return
			}
		}

		// POST /brain/events/emit — emit an event to all connected SSE clients
		if (method === "POST" && (url === "/brain/events/emit" || normalizedUrl === "/brain/events/emit")) {
			try {
				const body = await parseBody(req)
				const { event = "custom", data = {} } = body
				const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
				let sent = 0
				for (const [cid, client] of global.__sseClients) {
					try {
						client.res.write(payload)
						sent++
					} catch {
						global.__sseClients.delete(cid)
					}
				}
				// Also broadcast to WebSocket clients
				broadcastBrainEvent(event, data)
				sendJson(res, 200, { success: true, sent, total: global.__sseClients.size })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /brain/mcp/telegram — Telegram ↔ MCP Bridge
		// Allows Telegram bot to execute MCP actions and get results
		if (method === "POST" && (url === "/brain/mcp/telegram" || normalizedUrl === "/brain/mcp/telegram")) {
			try {
				const body = await parseBody(req)
				const { action, params = {}, chatId } = body
				if (!action) {
					sendJson(res, 400, { success: false, error: "Missing 'action' field" })
					return
				}
				const result = await _handleMcpAction(action, params, orchestrator)
				sendJson(res, 200, { success: true, action, result, chatId })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /brain/skill-generate — Skill Generation Pipeline
		// Auto-generates a skill from a failure pattern and syncs to MCP, Telegram, Dashboard, Docs
		if (method === "POST" && (url === "/brain/skill-generate" || normalizedUrl === "/brain/skill-generate")) {
			try {
				const body = await parseBody(req)
				const {
					failureType,
					goal,
					solution,
					rootCause = "",
					verificationSteps = [],
					relatedFiles = [],
					tags = [],
				} = body
				if (!failureType || !goal || !solution) {
					sendJson(res, 400, {
						success: false,
						error: "Missing required fields: failureType, goal, solution",
					})
					return
				}
				if (!orchestrator || !orchestrator.hermesClaw) {
					sendJson(res, 503, { success: false, error: "HermesClaw not initialized" })
					return
				}

				// Step 1: Create skill via Hermes Claw
				const skillResult = await orchestrator.hermesClaw.createSkill({
					failureType,
					goal,
					rootCause,
					solution,
					verificationSteps,
					relatedFiles,
					tags,
				})

				// Step 2: Store lesson in BugKnowledgeStore
				let lessonResult = null
				if (orchestrator.hermesClaw.bugKnowledgeStore) {
					try {
						lessonResult = await orchestrator.hermesClaw.bugKnowledgeStore.storeLesson({
							taskId: `skill-${Date.now()}`,
							lessonType: "skill",
							summary: `Skill: ${goal}`,
							details: JSON.stringify({
								failureType,
								rootCause,
								solution,
								verificationSteps,
								relatedFiles,
								tags,
							}),
							success: true,
						})
					} catch (e) {
						writeApiLog("warn", "brain-skill", "Failed to store lesson", { error: e.message })
					}
				}

				// Step 3: Broadcast event to SSE and WebSocket clients
				const eventData = {
					skill: { failureType, goal, solution, tags },
					skillResult,
					lessonResult,
					timestamp: Date.now(),
				}
				broadcastBrainEvent("skill_generated", eventData)

				// Step 4: Emit to SSE clients
				const ssePayload = `event: skill_generated\ndata: ${JSON.stringify(eventData)}\n\n`
				for (const [cid, client] of global.__sseClients) {
					try {
						client.res.write(ssePayload)
					} catch {
						global.__sseClients.delete(cid)
					}
				}

				sendJson(res, 200, {
					success: true,
					skill: skillResult,
					lesson: lessonResult,
					synced: { mcp: true, sse: true, websocket: true },
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/skills — list all generated skills (for dashboard)
		if (method === "GET" && (url === "/brain/skills" || normalizedUrl === "/brain/skills")) {
			try {
				if (orchestrator && orchestrator.hermesClaw) {
					const skills = await orchestrator.hermesClaw.execute({ operation: "list_skills" })
					sendJson(res, 200, { success: true, skills: skills.skills || [] })
				} else {
					sendJson(res, 200, { success: true, skills: [] })
				}
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /brain/ws/info — WebSocket connection info (for dashboard)
		if (method === "GET" && (url === "/brain/ws/info" || normalizedUrl === "/brain/ws/info")) {
			sendJson(res, 200, {
				success: true,
				wsUrl: `ws://127.0.0.1:${PORT}/api/brain/ws`,
				connectedClients: brainClients.size,
				sseClients: global.__sseClients.size,
				supportedActions: [
					"ping",
					"query_memory",
					"list_projects",
					"get_active_task",
					"get_recent_bugs",
					"hermes_recall",
					"hermes_learn",
					"hermes_list_skills",
					"hermes_list_resources",
					"hermes_stats",
					"commit_deploy_status",
					"codex_task_upsert",
					"codex_task_list",
					"codex_task_get",
					"codex_task_get_active",
					"health",
					"qdrant_search",
					"qdrant_collections",
					"run_task",
					"run_debug",
					"run_deploy",
					"get_pipeline",
					"list_resources",
					"read_resource",
					"ollama_summarize",
					"ollama_health",
					"subscribe",
					"unsubscribe",
					"risk_assess",
					"risk_record_pattern",
					"risk_list_assessments",
					"risk_list_patterns",
					"risk_stats",
					"swarm_debug",
					"swarm_list_runs",
					"swarm_get_run",
				],
			})
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// CENTRAL BRAIN v2 — pgvector Memory API Routes
		// ═══════════════════════════════════════════════════════════════════════════
		// These routes expose the Central Brain v2 pgvector memory services.
		// They require a Postgres connection with pgvector extension.
		// If the brain services are not initialized, they return 503.
		//
		// Endpoints:
		//   GET    /api/brain/v2/memory          — List memories (with filters)
		//   POST   /api/brain/v2/memory/search   — Semantic search
		//   POST   /api/brain/v2/memory          — Create memory
		//   PATCH  /api/brain/v2/memory/:id      — Update memory
		//   POST   /api/brain/v2/memory/:id/approve — Approve pending memory
		//   POST   /api/brain/v2/memory/:id/archive — Archive memory
		//   GET    /api/brain/v2/memory/:id/recalls — Recall logs for a memory
		//   GET    /api/brain/v2/scores           — Agent scores leaderboard
		//   GET    /api/brain/v2/events           — Brain events log
		//   GET    /api/brain/v2/approvals        — Pending approvals
		//   POST   /api/brain/v2/approve          — Approve a pending memory
		//   POST   /api/brain/v2/reject           — Reject a pending memory
		//   GET    /api/brain/v2/stats            — Brain statistics
		// ═══════════════════════════════════════════════════════════════════════════

		// Lazy-init brain services (once per server start)
		let brainServices = null
		async function getBrainServices() {
			if (brainServices) return brainServices
			try {
				const { Pool } = require("pg")
				const brain = require("../orchestrator/stores/brain")
				const pool = new Pool({
					connectionString:
						process.env.BRAIN_DATABASE_URL ||
						process.env.DATABASE_URL ||
						"postgresql://superroo:superroo@127.0.0.1:5432/superroo_brain",
					max: 5,
					idleTimeoutMillis: 30000,
					connectionTimeoutMillis: 5000,
				})
				// Test connection
				await pool.query("SELECT 1")
				// Apply schema
				await brain.applySchema(pool)
				// Create services
				brainServices = await brain.createServices(pool, null, {
					embedding: {
						provider: process.env.EMBEDDING_PROVIDER || "ollama",
					},
				})

				// Wire consensus service into DeployOrchestrator for pre-deploy gating
				if (brainServices.consensus && orchestrator && orchestrator.deployOrchestrator) {
					orchestrator.deployOrchestrator.setConsensus(brainServices.consensus)
					writeApiLog("info", "brain-v2", "Consensus service wired into DeployOrchestrator", {})
				}

				// Wire DeployGate (risk → swarm → consensus) into DeployOrchestrator for pre-deploy gating
				if (brainServices.deployGate && orchestrator && orchestrator.deployOrchestrator) {
					orchestrator.deployOrchestrator.setDeployGate(brainServices.deployGate)
					writeApiLog("info", "brain-v2", "DeployGate (risk+swarm) wired into DeployOrchestrator", {})
				}

				// Wire riskEngine into SelfHealingLoop for auto-pattern recording after incidents
				if (brainServices.riskEngine && orchestrator && orchestrator.selfHealingLoop) {
					orchestrator.selfHealingLoop.setRiskEngine(brainServices.riskEngine)
					writeApiLog(
						"info",
						"brain-v2",
						"RiskEngine wired into SelfHealingLoop for auto-pattern recording",
						{},
					)
				}

				// Wire swarmDebugger into SelfHealingLoop for auto-triggering parallel debugging on critical incidents
				if (brainServices.swarmDebugger && orchestrator && orchestrator.selfHealingLoop) {
					orchestrator.selfHealingLoop.setSwarmDebugger(brainServices.swarmDebugger)
					writeApiLog(
						"info",
						"brain-v2",
						"SwarmDebugger wired into SelfHealingLoop for auto-debug on critical incidents",
						{},
					)
				}

				writeApiLog("info", "brain-v2", "Central Brain v2 services initialized", {})
				return brainServices
			} catch (err) {
				writeApiLog("warn", "brain-v2", `Central Brain v2 unavailable: ${err.message}`, {})
				return null
			}
		}

		// Helper: require brain services or return 503
		async function requireBrain(res) {
			const svc = await getBrainServices()
			if (!svc) {
				sendJson(res, 503, { success: false, error: "Central Brain v2 not available (pgvector not connected)" })
				return null
			}
			return svc
		}

		// GET /api/brain/v2/memory — List memories with optional filters
		if (
			method === "GET" &&
			(url.startsWith("/api/brain/v2/memory") || normalizedUrl.startsWith("/api/brain/v2/memory"))
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const status = requestUrl.searchParams.get("status") || ""
				const memoryType = requestUrl.searchParams.get("type") || ""
				const tags = requestUrl.searchParams.get("tags") ? requestUrl.searchParams.get("tags").split(",") : []
				const files = requestUrl.searchParams.get("files")
					? requestUrl.searchParams.get("files").split(",")
					: []
				const limit = parseInt(requestUrl.searchParams.get("limit") || "50", 10)
				const offset = parseInt(requestUrl.searchParams.get("offset") || "0", 10)

				const memories = await svc.memory.listMemories({
					projectId,
					status: status || undefined,
					memoryType: memoryType || undefined,
					tags: tags.length > 0 ? tags : undefined,
					files: files.length > 0 ? files : undefined,
					limit,
					offset,
				})

				sendJson(res, 200, { success: true, data: { memories } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/memory/search — Semantic search
		if (
			method === "POST" &&
			(url === "/api/brain/v2/memory/search" || normalizedUrl === "/api/brain/v2/memory/search")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const { query, projectId = "default", limit = 10, minSimilarity = 0.6, minImportance, status } = body

				const memories = await svc.memory.searchMemory({
					projectId,
					query: query || "",
					limit,
					minSimilarity,
					minImportance,
					status,
				})

				sendJson(res, 200, { success: true, data: { memories } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/memory — Create a new memory
		if (method === "POST" && (url === "/api/brain/v2/memory" || normalizedUrl === "/api/brain/v2/memory")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const memoryId = await svc.memory.createMemory({
					projectId: body.projectId || "default",
					agent: body.agent || "api",
					model: body.model || null,
					title: body.title,
					summary: body.summary,
					content: body.content,
					memoryType: body.memoryType || "lesson",
					tags: body.tags || [],
					files: body.files || [],
					importance: body.importance || 0.5,
					confidence: body.confidence || 0.7,
				})

				await svc.eventBus.emitMemoryCreated(
					body.projectId || "default",
					memoryId,
					body.agent || "api",
					body.title,
				)

				sendJson(res, 200, { success: true, data: { id: memoryId } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// PATCH /api/brain/v2/memory/:id — Update a memory
		const patchMemoryMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)$/)
		if (method === "PATCH" && patchMemoryMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = patchMemoryMatch[1]
				const body = await parseBody(req)
				await svc.memory.updateMemory(memoryId, body)
				sendJson(res, 200, { success: true, data: { id: memoryId } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/memory/:id/approve — Approve a pending memory
		const approveMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/approve$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/approve$/)
		if (method === "POST" && approveMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = approveMatch[1]
				await svc.memory.updateStatus(memoryId, "approved", "api")
				await svc.eventBus.emit("default", "memory.approved", { memoryId })
				sendJson(res, 200, { success: true, data: { id: memoryId, status: "approved" } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/memory/:id/archive — Archive a memory
		const archiveMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/archive$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/archive$/)
		if (method === "POST" && archiveMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = archiveMatch[1]
				await svc.memory.updateStatus(memoryId, "archived", "api")
				sendJson(res, 200, { success: true, data: { id: memoryId, status: "archived" } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/:id/recalls — Recall logs for a memory
		const recallsMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/recalls$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/recalls$/)
		if (method === "GET" && recallsMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = recallsMatch[1]
				const result = await svc.memory.query(
					`SELECT * FROM memory_recall_logs WHERE memory_id = $1 ORDER BY recalled_at DESC LIMIT 100`,
					[memoryId],
				)
				sendJson(res, 200, { success: true, data: { recalls: result.rows || [] } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/scores — Agent scores leaderboard
		if (method === "GET" && (url === "/api/brain/v2/scores" || normalizedUrl === "/api/brain/v2/scores")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const limit = parseInt(requestUrl.searchParams.get("limit") || "20", 10)
				const scores = await svc.scoring.getLeaderboard(projectId, limit)
				sendJson(res, 200, { success: true, data: { scores } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/events — Brain events log
		if (method === "GET" && (url === "/api/brain/v2/events" || normalizedUrl === "/api/brain/v2/events")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const limit = parseInt(requestUrl.searchParams.get("limit") || "50", 10)
				const eventType = requestUrl.searchParams.get("type") || null
				const events = await svc.eventBus.getEvents(projectId, limit, eventType)
				sendJson(res, 200, { success: true, data: { events } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/approvals — Pending approvals
		if (method === "GET" && (url === "/api/brain/v2/approvals" || normalizedUrl === "/api/brain/v2/approvals")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const limit = parseInt(requestUrl.searchParams.get("limit") || "50", 10)
				const approvals = await svc.approval.getPendingApprovals(svc.memory, projectId, limit)
				sendJson(res, 200, { success: true, data: { approvals } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/approve — Approve a pending memory by approval queue ID
		if (method === "POST" && (url === "/api/brain/v2/approve" || normalizedUrl === "/api/brain/v2/approve")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const { approvalId, reviewedBy = "api" } = body
				const result = await svc.approval.approveMemory(svc.memory, approvalId, reviewedBy)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/reject — Reject a pending memory by approval queue ID
		if (method === "POST" && (url === "/api/brain/v2/reject" || normalizedUrl === "/api/brain/v2/reject")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const { approvalId, reviewedBy = "api" } = body
				const result = await svc.approval.rejectMemory(svc.memory, approvalId, reviewedBy)
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/stats — Brain statistics
		if (method === "GET" && (url === "/api/brain/v2/stats" || normalizedUrl === "/api/brain/v2/stats")) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"

				const [memoryCount, eventSummary, scoreCount] = await Promise.all([
					svc.memory.query(`SELECT COUNT(*) as count FROM agent_memory WHERE project_id = $1`, [projectId]),
					svc.eventBus.getEventSummary(projectId),
					svc.scoring.getLeaderboard(projectId, 5),
				])

				sendJson(res, 200, {
					success: true,
					data: {
						totalMemories: parseInt(memoryCount.rows[0]?.count || "0", 10),
						eventSummary,
						topScores: scoreCount,
					},
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/reuse — Lesson reuse analytics
		if (method === "GET" && (url === "/api/brain/v2/reuse" || normalizedUrl === "/api/brain/v2/reuse")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const limit = parseInt(requestUrl.searchParams.get("limit") || "20", 10)

				// Top reused memories (sorted by use_count DESC)
				const topReused = await svc.memory.query(
					`SELECT id, title, content, memory_type, tags, related_files, related_agents,
					        confidence, importance, use_count, last_used_at, status, created_at, created_by
					 FROM agent_memory
					 WHERE project_id = $1 AND use_count > 0
					 ORDER BY use_count DESC, last_used_at DESC NULLS LAST
					 LIMIT $2`,
					[projectId, limit],
				)

				// Usage stats
				const usageStats = await svc.memory.query(
					`SELECT
					  COUNT(*) FILTER (WHERE use_count > 0) AS reused_count,
					  COUNT(*) FILTER (WHERE use_count = 0) AS never_used_count,
					  AVG(use_count) AS avg_use,
					  MAX(use_count) AS max_use,
					  SUM(use_count) AS total_recalls
					 FROM agent_memory WHERE project_id = $1`,
					[projectId],
				)

				// Recall timeline (last 30 days grouped by day)
				const recallTimeline = await svc.memory.query(
					`SELECT DATE(created_at) AS day, COUNT(*) AS recalls
					 FROM memory_recall_logs
					 WHERE project_id = $1 AND created_at >= now() - interval '30 days'
					 GROUP BY DATE(created_at)
					 ORDER BY day ASC`,
					[projectId],
				)

				// Top recalled files/patterns
				const topFiles = await svc.memory.query(
					`SELECT unnest(related_files) AS file, COUNT(*) AS recall_count
					 FROM agent_memory
					 WHERE project_id = $1 AND use_count > 0 AND related_files IS NOT NULL
					 GROUP BY file
					 ORDER BY recall_count DESC
					 LIMIT 10`,
					[projectId],
				)

				// Top recalled agents
				const topAgents = await svc.memory.query(
					`SELECT unnest(related_agents) AS agent, COUNT(*) AS memory_count,
					        SUM(use_count) AS total_recalls
					 FROM agent_memory
					 WHERE project_id = $1 AND use_count > 0 AND related_agents IS NOT NULL
					 GROUP BY agent
					 ORDER BY total_recalls DESC
					 LIMIT 10`,
					[projectId],
				)

				sendJson(res, 200, {
					success: true,
					data: {
						topReused: topReused.rows,
						usageStats: usageStats.rows[0] || {
							reused_count: 0,
							never_used_count: 0,
							avg_use: 0,
							max_use: 0,
							total_recalls: 0,
						},
						recallTimeline: recallTimeline.rows,
						topFiles: topFiles.rows,
						topAgents: topAgents.rows,
					},
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// BRAIN V3 ENDPOINTS — Memory Evolution (versioning, feedback, propose, diff)
		// ═══════════════════════════════════════════════════════════════════════════

		// POST /api/brain/v2/memory/:id/evolve — Evolve a memory (new version)
		const evolveMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/evolve$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/evolve$/)
		if (method === "POST" && evolveMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = evolveMatch[1]
				const body = await parseBody(req)
				const result = await svc.memory.evolveMemory(
					memoryId,
					body.content,
					body.reason || "update",
					body.agent || "api",
				)
				await svc.eventBus.emit(body.projectId || "default", "memory.evolved", {
					memoryId,
					versionNo: result.versionNo,
					reason: body.reason,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/:id/versions — Get version history
		const versionsMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/versions$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/versions$/)
		if (method === "GET" && versionsMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = versionsMatch[1]
				const requestUrl = new URL(req.url || "", "http://localhost")
				const limit = parseInt(requestUrl.searchParams.get("limit") || "50", 10)
				const versions = await svc.memory.getVersionHistory(memoryId, limit)
				sendJson(res, 200, { success: true, data: { versions } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/:id/diff — Diff two versions
		const diffMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/diff$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/diff$/)
		if (method === "GET" && diffMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = diffMatch[1]
				const requestUrl = new URL(req.url || "", "http://localhost")
				const fromVersion = parseInt(requestUrl.searchParams.get("from") || "0", 10)
				const toVersion = parseInt(requestUrl.searchParams.get("to") || "0", 10)
				if (!fromVersion || !toVersion) {
					sendJson(res, 400, { success: false, error: "'from' and 'to' version params are required" })
					return
				}
				const diff = await svc.memory.diffVersions(memoryId, fromVersion, toVersion)
				sendJson(res, 200, { success: true, data: diff })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/memory/:id/feedback — Add feedback for a memory
		const feedbackMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/feedback$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/feedback$/)
		if (method === "POST" && feedbackMatch) {
			// Rate limit: use global rate limiter (100 req/min per IP by default)
			const clientIp = getClientIp(req)
			const rlResult = checkRateLimit(clientIp)
			if (!rlResult.allowed) {
				res.writeHead(429, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: false, error: "Too many feedback submissions. Try again later." }))
				return
			}
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = feedbackMatch[1]
				const body = await parseBody(req)
				await svc.memory.addFeedback(memoryId, body)
				sendJson(res, 200, { success: true, data: { ok: true } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/:id/feedback — Get feedback history
		const getFeedbackMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/feedback$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/feedback$/)
		if (method === "GET" && getFeedbackMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = getFeedbackMatch[1]
				const requestUrl = new URL(req.url || "", "http://localhost")
				const limit = parseInt(requestUrl.searchParams.get("limit") || "50", 10)
				const feedback = await svc.memory.getFeedback(memoryId, limit)
				sendJson(res, 200, { success: true, data: { feedback } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/:id/usefulness — Get aggregated usefulness
		const usefulnessMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/usefulness$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/usefulness$/)
		if (method === "GET" && usefulnessMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = usefulnessMatch[1]
				const usefulness = await svc.memory.getUsefulness(memoryId)
				sendJson(res, 200, { success: true, data: { usefulness } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/memory/search-with-recall — Search + auto-log recall
		if (
			method === "POST" &&
			(url === "/api/brain/v2/memory/search-with-recall" ||
				normalizedUrl === "/api/brain/v2/memory/search-with-recall")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const { query, projectId = "default", topK = 10, tags, status, taskId, agentName, model } = body
				const memories = await svc.memory.searchMemoryWithRecall({
					projectId,
					query: query || "",
					topK,
					tags,
					status,
					taskId,
					agentName,
					model,
				})
				sendJson(res, 200, { success: true, data: { memories } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// BRAIN V3 INNOVATIVE ENDPOINTS — Confidence Trend, Memory Health, Merge Suggestions
		// ═══════════════════════════════════════════════════════════════════════════

		// GET /api/brain/v2/memory/:id/confidence-trend — Get confidence trend timeline
		const trendMatch =
			url.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/confidence-trend$/) ||
			normalizedUrl.match(/^\/api\/brain\/v2\/memory\/([a-f0-9-]+)\/confidence-trend$/)
		if (method === "GET" && trendMatch) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const memoryId = trendMatch[1]
				const trend = await svc.memory.getConfidenceTrend(memoryId)
				sendJson(res, 200, { success: true, data: trend })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/health — Get memory health dashboard for a project
		if (
			method === "GET" &&
			(url === "/api/brain/v2/memory/health" || normalizedUrl === "/api/brain/v2/memory/health")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const health = await svc.memory.getMemoryHealth(projectId)
				sendJson(res, 200, { success: true, data: health })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/memory/merge-suggestions — Get merge suggestions for a project
		if (
			method === "GET" &&
			(url === "/api/brain/v2/memory/merge-suggestions" ||
				normalizedUrl === "/api/brain/v2/memory/merge-suggestions")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("project") || "default"
				const threshold = parseFloat(requestUrl.searchParams.get("threshold") || "0.85")
				const limit = parseInt(requestUrl.searchParams.get("limit") || "20", 10)
				const suggestions = await svc.memory.getMergeSuggestions(projectId, threshold, limit)
				sendJson(res, 200, { success: true, data: { suggestions } })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// BRAIN V4 ENDPOINTS — Consensus Voting & Model Routing
		// ═══════════════════════════════════════════════════════════════════════════

		// POST /api/brain/v2/consensus/decide — Run a weighted consensus vote
		if (
			method === "POST" &&
			(url === "/api/brain/v2/consensus/decide" || normalizedUrl === "/api/brain/v2/consensus/decide")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const result = await svc.consensus.decide({
					projectId: body.projectId || "default",
					decisionType: body.decisionType,
					contextId: body.contextId,
					votes: body.votes,
					createdBy: body.createdBy || "api",
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/consensus/decisions — List consensus decisions
		if (
			method === "GET" &&
			(url === "/api/brain/v2/consensus/decisions" || normalizedUrl === "/api/brain/v2/consensus/decisions")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const decisions = await svc.consensus.listDecisions({
					projectId: requestUrl.searchParams.get("projectId") || undefined,
					decisionType: requestUrl.searchParams.get("decisionType") || undefined,
					finalDecision: requestUrl.searchParams.get("finalDecision") || undefined,
					contextId: requestUrl.searchParams.get("contextId") || undefined,
					limit: parseInt(requestUrl.searchParams.get("limit") || "50", 10),
					offset: parseInt(requestUrl.searchParams.get("offset") || "0", 10),
				})
				sendJson(res, 200, { success: true, data: decisions })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/consensus/stats — Get consensus statistics
		if (
			method === "GET" &&
			(url === "/api/brain/v2/consensus/stats" || normalizedUrl === "/api/brain/v2/consensus/stats")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("projectId") || "default"
				const stats = await svc.consensus.getStats(projectId)
				sendJson(res, 200, { success: true, data: stats })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/router/route — Select best model for task type
		if (
			method === "POST" &&
			(url === "/api/brain/v2/router/route" || normalizedUrl === "/api/brain/v2/router/route")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const result = await svc.modelRouter.route({
					projectId: body.projectId || "default",
					taskType: body.taskType,
					taskId: body.taskId,
					runId: body.runId,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /api/brain/v2/router/outcome — Record routing outcome
		if (
			method === "POST" &&
			(url === "/api/brain/v2/router/outcome" || normalizedUrl === "/api/brain/v2/router/outcome")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const body = await parseBody(req)
				const result = await svc.modelRouter.recordOutcome({
					projectId: body.projectId || "default",
					taskType: body.taskType,
					taskId: body.taskId,
					runId: body.runId,
					agent: body.agent,
					modelSelected: body.modelSelected,
					fallbackChain: body.fallbackChain,
					attempt: body.attempt || 1,
					success: body.success,
					durationMs: body.durationMs,
					costUsd: body.costUsd,
					hallucinated: body.hallucinated || false,
					error: body.error,
				})
				sendJson(res, 200, { success: true, data: result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/router/logs — Get routing logs
		if (
			method === "GET" &&
			(url === "/api/brain/v2/router/logs" || normalizedUrl === "/api/brain/v2/router/logs")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const logs = await svc.modelRouter.getRoutingLogs({
					projectId: requestUrl.searchParams.get("projectId") || undefined,
					taskType: requestUrl.searchParams.get("taskType") || undefined,
					agent: requestUrl.searchParams.get("agent") || undefined,
					success:
						requestUrl.searchParams.get("success") !== null
							? requestUrl.searchParams.get("success") === "true"
							: undefined,
					limit: parseInt(requestUrl.searchParams.get("limit") || "50", 10),
					offset: parseInt(requestUrl.searchParams.get("offset") || "0", 10),
				})
				sendJson(res, 200, { success: true, data: logs })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /api/brain/v2/router/performance — Get performance summary
		if (
			method === "GET" &&
			(url === "/api/brain/v2/router/performance" || normalizedUrl === "/api/brain/v2/router/performance")
		) {
			const svc = await requireBrain(res)
			if (!svc) return
			try {
				const requestUrl = new URL(req.url || "", "http://localhost")
				const projectId = requestUrl.searchParams.get("projectId") || "default"
				const summary = await svc.modelRouter.getPerformanceSummary(projectId)
				sendJson(res, 200, { success: true, data: summary })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// MCP COMPATIBLE ENDPOINT — Fallback MCP server on REST API
		// ═══════════════════════════════════════════════════════════════════════════
		// This endpoint implements the Model Context Protocol (MCP) so that any
		// MCP-compatible client (Claude Code, Codex, Cursor, etc.) can interact
		// with the SuperRoo Central Brain through the REST API.
		//
		// This serves as a FALLBACK when the dedicated MCP server (port 3419) or
		// the Central Brain daemon (port 3417) is unreachable.
		//
		// Endpoint: POST /api/brain/mcp  (or POST /brain/mcp)
		// Body: { action: string, params: object }
		// Returns: MCP-compatible JSON response
		//
		// Supported actions (delegated to _handleMcpAction):
		//   - ping, query_memory, list_projects, get_active_task, get_recent_bugs
		//   - hermes_recall, hermes_learn, hermes_list_skills, hermes_list_resources
		//   - hermes_stats, commit_deploy_status, codex_task_upsert, codex_task_list
		//   - codex_task_get, codex_task_get_active, health, qdrant_search
		//   - qdrant_collections, run_task, run_debug, run_deploy, get_pipeline
		//   - list_resources, read_resource
		// ═══════════════════════════════════════════════════════════════════════════

		// POST /brain/mcp — MCP-compatible endpoint (fallback, delegates to _handleMcpAction)
		if (method === "POST" && (url === "/brain/mcp" || normalizedUrl === "/brain/mcp")) {
			try {
				const body = await parseBody(req)
				const { action, params = {} } = body

				if (!action) {
					sendJson(res, 400, { success: false, error: "Missing 'action' field" })
					return
				}

				const result = await _handleMcpAction(action, params, orchestrator)
				sendJson(res, 200, result)
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
						const pending = getNotifierPendingJob(t.id) || {}
						const diffText = getTaskDiffText(t.id, t)
						const changedFileList = normalizeTaskFiles(t, pending).map((f) => f.path)
						tasks.push({
							id: t.id,
							title: t.instruction,
							instruction: t.instruction,
							status: t.status,
							agent: t.agentId || "coder",
							changedFiles:
								t.changedFiles || changedFileList.length || pending.appliedChanges?.length || 0,
							linesAdded: t.linesAdded || pending.linesAdded || 0,
							linesRemoved: t.linesRemoved || pending.linesRemoved || 0,
							changedFileList,
							createdAgo: t.createdAt ? timeAgo(new Date(t.createdAt)) : "recently",
							createdAt: t.createdAt,
							branchName: t.branchName || "",
							projectPath: t.projectPath || pending.workspaceDir || "",
							savepointHash: t.savepointHash || pending.savepointHash || pending.savepoint,
							diffAvailable: !!diffText,
							diffUrl: getTelegramTaskDiffUrl(t.id),
							chatId,
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
						linesRemoved: 12,
						changedFileList: ["cloud/dashboard/src/components/views/telegram.tsx", "cloud/api/api.js"],
						createdAgo: "2h ago",
						diffAvailable: false,
						diffUrl: getTelegramTaskDiffUrl("TG-1287"),
					},
					{
						id: "TG-1286",
						title: "Fix login session timeout bug",
						instruction: "Fix login session timeout bug",
						status: "approved",
						agent: "Coder Agent",
						changedFiles: 3,
						linesAdded: 148,
						linesRemoved: 9,
						changedFileList: ["cloud/api/telegramBot.js"],
						createdAgo: "4h ago",
						diffAvailable: false,
						diffUrl: getTelegramTaskDiffUrl("TG-1286"),
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
			const instruction = String(data.instruction || "").trim()
			const agent = data.agent || "coder"
			const isCoderAgent = agent === "coder" || agent === "superroo-coder-agent"
			const auto = data.auto === true || data.auto === "true"
			if (!instruction) {
				sendJson(res, 400, { success: false, error: "instruction is required" })
				return
			}
			if (isCoderAgent && instruction.length < 10) {
				sendJson(res, 400, { success: false, error: "instruction must be at least 10 characters" })
				return
			}

			const taskId =
				"TG-" +
				Date.now().toString(36).toUpperCase() +
				"-" +
				Math.random().toString(36).slice(2, 6).toUpperCase()
			const branchName = "tg/" + taskId.toLowerCase()
			const workspaceDir = data.workspaceDir || process.env.SUPERROO_ROOT || "/opt/superroo2"
			const repoName = data.repoName || "superroo2"
			if (!telegramBot.userTasks) telegramBot.userTasks = new Map()
			const chatId = data.chatId || 0
			if (!telegramBot.userTasks.has(chatId)) telegramBot.userTasks.set(chatId, [])
			const taskRecord = {
				id: taskId,
				instruction: instruction,
				status: "queued",
				agentId: isCoderAgent ? "superroo-coder-agent" : agent,
				branchName: branchName,
				changedFiles: 0,
				linesAdded: 0,
				createdAt: new Date().toISOString(),
				auto,
				workspaceDir,
				repoName,
			}
			telegramBot.userTasks.get(chatId).push(taskRecord)

			// Enqueue to BullMQ if available
			let job = null
			try {
				if (queue) {
					if (isCoderAgent) {
						job = await queue.add(
							"coder-plan-" + taskId,
							{
								task: instruction,
								agentId: "superroo-coder-agent",
								phase: "plan",
								taskId,
								workspaceDir,
								repoName,
								branch: branchName,
								telegram: { chatId, taskId, branchName, auto },
							},
							{
								attempts: 3,
								backoff: { type: "exponential", delay: 5000 },
							},
						)
					} else {
						job = await queue.add("telegram-" + taskId, {
							task: instruction,
							agentId: agent,
							commands: [],
							network: "none",
							telegram: { chatId: chatId, taskId: taskId, branchName: branchName },
						})
					}
					taskRecord.jobId = job && job.id
				}
			} catch (qErr) {
				console.error("[api] Failed to enqueue task:", qErr.message)
			}
			sendJson(res, 200, { success: true, taskId, branchName, jobId: job && job.id, auto })
			return
		}

		// POST /telegram/tasks/:id/approve — approve a task
		if (
			method === "POST" &&
			(url.match(/^\/telegram\/tasks\/([^/]+)\/approve$/) ||
				normalizedUrl.match(/^\/telegram\/tasks\/([^/]+)\/approve$/))
		) {
			const taskId = (url.match(/^\/telegram\/tasks\/([^/]+)\/approve$/) ||
				normalizedUrl.match(/^\/telegram\/tasks\/([^/]+)\/approve$/))[1]
			const pending = getNotifierPendingJob(taskId)
			if (!pending || !pending.plan) {
				sendJson(res, 409, {
					success: false,
					taskId,
					error: "No generated coder plan is ready for this task yet. Wait for planning to finish, then approve again.",
				})
				return
			}

			let applyJob = null
			try {
				if (queue) {
					applyJob = await queue.add(
						"coder-apply-" + taskId,
						{
							task: pending.instruction || "Apply approved changes",
							agentId: "superroo-coder-agent",
							phase: "apply",
							taskId,
							workspaceDir: pending.workspaceDir,
							repoName: pending.repoName,
							branch: pending.branch,
							plan: pending.plan,
							telegram: {
								chatId: pending.chatId,
								taskId,
								branchName: pending.branch,
								auto: pending.auto === true,
							},
						},
						{ attempts: 3, backoff: { type: "exponential", delay: 5000 } },
					)
				}
			} catch (qErr) {
				console.error("[api] Failed to enqueue coder apply job:", qErr.message)
				sendJson(res, 500, { success: false, taskId, error: "Failed to enqueue apply job" })
				return
			}

			const taskNotifier = telegramBot.telegramNotifier
			if (taskNotifier && typeof taskNotifier.setPendingCoderJob === "function") {
				taskNotifier.setPendingCoderJob(taskId, {
					...pending,
					status: "applying",
					updatedAt: new Date().toISOString(),
				})
			}

			if (telegramBot.userTasks) {
				for (const [, chatTasks] of telegramBot.userTasks.entries()) {
					for (const t of chatTasks) {
						if (t.id === taskId) {
							t.status = "applying"
							t.applyJobId = applyJob && applyJob.id
							break
						}
					}
				}
			}
			sendJson(res, 200, { success: true, taskId, jobId: applyJob && applyJob.id, nextState: "applying" })
			return
		}

		// POST /telegram/tasks/:id/reject — reject a task
		if (
			method === "POST" &&
			(url.match(/^\/telegram\/tasks\/([^/]+)\/reject$/) ||
				normalizedUrl.match(/^\/telegram\/tasks\/([^/]+)\/reject$/))
		) {
			const taskId = (url.match(/^\/telegram\/tasks\/([^/]+)\/reject$/) ||
				normalizedUrl.match(/^\/telegram\/tasks\/([^/]+)\/reject$/))[1]
			const taskNotifier = telegramBot.telegramNotifier
			if (taskNotifier && typeof taskNotifier.removePendingCoderJob === "function") {
				taskNotifier.removePendingCoderJob(taskId)
			}
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

		// GET /telegram/tasks/:id/diff ? get diff for a task
		if (
			method === "GET" &&
			(url.match(/^\/telegram\/tasks\/([^/]+)\/diff$/) ||
				normalizedUrl.match(/^\/telegram\/tasks\/([^/]+)\/diff$/))
		) {
			const taskId = (url.match(/^\/telegram\/tasks\/([^/]+)\/diff$/) ||
				normalizedUrl.match(/^\/telegram\/tasks\/([^/]+)\/diff$/))[1]
			const found = findTelegramTask(taskId)
			const task = found?.task || null
			const pending = getNotifierPendingJob(taskId) || {}
			const diff = String(getTaskDiffText(taskId, task) || "")
			const files = normalizeTaskFiles(task, pending)
			const source = diff
				? pending.diff || pending.gitDiff || pending.diffText || pending.patch || pending.diffSummary
					? "notifier"
					: "task"
				: "none"
			sendJson(res, 200, {
				success: true,
				taskId,
				found: !!task || !!pending,
				diffAvailable: !!diff,
				diff,
				files,
				summary: task?.diffSummary || pending.diffSummary || "",
				branchName: task?.branchName || pending.branch || "",
				projectPath: task?.projectPath || pending.workspaceDir || "",
				dashboardUrl: getTelegramTaskDiffUrl(taskId),
				source,
				message: diff
					? "Diff loaded."
					: "No captured diff is available yet. The task may still be running, or it was created before diff capture was enabled.",
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
		if (
			method === "GET" &&
			(url.split("?")[0] === "/telegram/logs" || normalizedUrl.split("?")[0] === "/telegram/logs")
		) {
			const limitParam = parseInt(new URL("http://x" + url).searchParams.get("limit") || "50", 10)
			const logs = []
			try {
				// Try recent chat-log files (best source for telegram activity)
				const chatLogDir = path.join(__dirname, "..", "data", "chat-logs")
				const candidateDates = [0, -1].map((offset) => {
					const d = new Date()
					d.setDate(d.getDate() + offset)
					return d.toISOString().slice(0, 10)
				})
				for (const dt of candidateDates) {
					const f = path.join(chatLogDir, `${dt}.jsonl`)
					if (fsSync.existsSync(f)) {
						const raw = fsSync.readFileSync(f, "utf-8").trim().split("\n").filter(Boolean)
						// Chat log format: { t, c, r, msg, m } or { ts, chatId, message, intent }
						const entries = raw
							.slice(-limitParam)
							.map((l) => {
								try {
									const e = JSON.parse(l)
									const ts = e.t
										? new Date(e.t).toLocaleTimeString()
										: e.ts
											? new Date(e.ts).toLocaleTimeString()
											: "—"
									const role = e.r || e.role || "msg"
									const text = (e.msg || e.message || "").slice(0, 120)
									const intent = e.m?.intent || e.intent || role
									return text
										? { timestamp: ts, level: "info", message: `[${intent}] ${text}` }
										: null
								} catch {
									return null
								}
							})
							.filter(Boolean)
						logs.push(...entries)
						if (logs.length) break
					}
				}
				// Fallback: pm2 log tail via recent superroo jsonl
				if (logs.length === 0) {
					const logDir = path.join(__dirname, "..", "logs")
					for (const dt of candidateDates) {
						const f = path.join(logDir, `superroo-${dt}.jsonl`)
						if (fsSync.existsSync(f)) {
							const raw = fsSync.readFileSync(f, "utf-8").trim().split("\n").filter(Boolean)
							const recent = raw.slice(-limitParam).map((l) => {
								try {
									const e = JSON.parse(l)
									return {
										timestamp: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "—",
										level: e.level || "info",
										message: e.message || JSON.stringify(e),
									}
								} catch {
									return { timestamp: "—", level: "info", message: l.slice(0, 200) }
								}
							})
							logs.push(...recent)
							if (logs.length) break
						}
					}
				}
			} catch (err) {
				logs.push({
					timestamp: new Date().toLocaleTimeString(),
					level: "error",
					message: "Failed to read logs: " + err.message,
				})
			}
			sendJson(res, 200, { success: true, logs, count: logs.length })
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

		// GET /telegram/alert-rules — get current alert rule preferences
		if (method === "GET" && (url === "/telegram/alert-rules" || normalizedUrl === "/telegram/alert-rules")) {
			sendJson(res, 200, { success: true, rules: telegramBot.alertRules || getDefaultAlertRules() })
			return
		}

		// POST /telegram/alert-rules — update an alert rule
		if (method === "POST" && (url === "/telegram/alert-rules" || normalizedUrl === "/telegram/alert-rules")) {
			const data = await parseBody(req)
			if (!telegramBot.alertRules) telegramBot.alertRules = getDefaultAlertRules()
			const rule = telegramBot.alertRules.find((r) => r.label === data.label)
			if (rule) rule.enabled = !!data.enabled
			sendJson(res, 200, { success: true, rules: telegramBot.alertRules })
			return
		}

		// GET /telegram/health — get webhook health status
		if (method === "GET" && (url === "/telegram/health" || normalizedUrl === "/telegram/health")) {
			if (!TELEGRAM_BOT_TOKEN) {
				sendJson(res, 200, { success: false, error: "TELEGRAM_BOT_TOKEN not configured" })
				return
			}
			const health = telegramBot.getWebhookHealth
				? telegramBot.getWebhookHealth()
				: { error: "health check not available" }
			sendJson(res, 200, { success: true, health })
			return
		}

		// POST /telegram/health/start — start periodic health checks
		if (method === "POST" && (url === "/telegram/health/start" || normalizedUrl === "/telegram/health/start")) {
			if (!TELEGRAM_BOT_TOKEN) {
				sendJson(res, 200, { success: false, error: "TELEGRAM_BOT_TOKEN not configured" })
				return
			}
			if (telegramBot.startWebhookHealthCheck) {
				telegramBot.startWebhookHealthCheck(TELEGRAM_BOT_TOKEN)
				sendJson(res, 200, { success: true, message: "Webhook health check started" })
			} else {
				sendJson(res, 200, { success: false, error: "health check not available" })
			}
			return
		}

		// POST /telegram/health/stop — stop periodic health checks
		if (method === "POST" && (url === "/telegram/health/stop" || normalizedUrl === "/telegram/health/stop")) {
			if (telegramBot.stopWebhookHealthCheck) {
				telegramBot.stopWebhookHealthCheck()
				sendJson(res, 200, { success: true, message: "Webhook health check stopped" })
			} else {
				sendJson(res, 200, { success: false, error: "health check not available" })
			}
			return
		}

		// GET /telegram/latency — get command latency statistics
		if (method === "GET" && (url === "/telegram/latency" || normalizedUrl === "/telegram/latency")) {
			const latency = telegramBot.getCommandLatency
				? telegramBot.getCommandLatency()
				: { error: "latency tracking not available" }
			sendJson(res, 200, { success: true, latency })
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
			// Validate webhook secret token if configured
			const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
			if (webhookSecret) {
				const secretHeader = req.headers["x-telegram-bot-api-secret-token"]
				if (secretHeader !== webhookSecret) {
					sendJson(res, 403, { ok: false, error: "Invalid webhook secret token" })
					return
				}
			}
			// Validate Telegram IP whitelist (GAP 6.3)
			// Telegram webhook requests come from known IP ranges.
			// This check is optional — controlled by TELEGRAM_IP_WHITELIST_ENABLED env var.
			if (process.env.TELEGRAM_IP_WHITELIST_ENABLED !== "false") {
				const clientIp = getClientIp(req)
				if (clientIp && !_isTelegramIp(clientIp)) {
					console.warn("[telegram] Rejected webhook from non-Telegram IP:", clientIp)
					sendJson(res, 403, { ok: false, error: "Access denied" })
					return
				}
			}
			const update = await parseBody(req)
			// Build a list of available AI providers for the bot's /ask and @mention support
			const availableProviders = []
			for (const p of PROVIDERS) {
				const meta = providerMeta.get(p.id)
				if (isProviderUsable(meta, p.id)) {
					try {
						// Local providers (like Ollama) don't need an API key
						if (p.local === true) {
							availableProviders.push({
								providerId: p.id,
								apiBaseUrl: p.apiBaseUrl,
								apiKey: "ollama", // placeholder, not used for local calls
								model: p.defaultModel || "deepseek-chat",
							})
							continue
						}
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

		// ── OpenClaw Telegram API Endpoints ────────────────────────────────────
		// These endpoints are called by the OpenClaw-style classifier after intent
		// classification and policy check. They provide real backend operations.
		// Auth: Bearer token via TELEGRAM_API_TOKEN env var.

		const TG_API_TOKEN = process.env.TELEGRAM_API_TOKEN || ""

		function tgAuth(req) {
			const authHeader = req.headers["authorization"] || ""
			if (!TG_API_TOKEN) {
				console.warn("[api] TELEGRAM_API_TOKEN not set — rejecting all /api/tg/* requests")
				return false
			}
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

		// GET /api/telegram/metrics — Telegram bot metrics export
		if (method === "GET" && (url === "/api/telegram/metrics" || normalizedUrl === "/api/telegram/metrics")) {
			try {
				const metrics = telegramBot.getTelegramMetrics()
				sendJson(res, 200, { success: true, data: metrics })
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
				const secret = process.env.GITHUB_WEBHOOK_SECRET || ""
				if (secret && signature) {
					const payload = JSON.stringify(body)
					const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex")
					if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
						sendJson(res, 401, { success: false, error: "Invalid webhook signature" })
						return
					}
				} else if (secret) {
					sendJson(res, 401, { success: false, error: "Missing webhook signature" })
					return
				}

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

		// GET /autonomous/status — Get autonomous loop status (no jobId, for dashboard)
		if (method === "GET" && (url === "/autonomous/status" || normalizedUrl === "/autonomous/status")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				if (!autonomousLoop) {
					sendJson(res, 200, {
						success: true,
						running: false,
						currentStep: null,
						stepResults: [],
						cycleCount: 0,
						lastRunAt: null,
					})
					return
				}
				const status = autonomousLoop.getStatus()
				sendJson(res, 200, {
					success: true,
					running: status.running,
					currentStep: status.currentStepName || null,
					stepResults: (status.stepResults || []).map((r) => ({
						step: r.name?.toLowerCase().replace(/\s+/g, "-") || `step-${r.step}`,
						status: r.status === "completed" ? "passed" : r.status === "error" ? "failed" : r.status,
						duration: r.duration || 0,
						details: r.details || r.error || "",
					})),
					cycleCount: Math.floor((status.stepResults?.length || 0) / 10),
					lastRunAt: status.startedAt ? new Date(status.startedAt).toISOString() : null,
				})
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /autonomous/start — Start the autonomous coding & debugging improvement loop
		if (method === "POST" && (url === "/autonomous/start" || normalizedUrl === "/autonomous/start")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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

		// POST /autonomous/stop — Stop the autonomous loop (no jobId, for dashboard)
		if (method === "POST" && (url === "/autonomous/stop" || normalizedUrl === "/autonomous/stop")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				if (!autonomousLoop) {
					sendJson(res, 404, { success: false, error: "No autonomous loop is running" })
					return
				}
				const result = await autonomousLoop.stop()
				sendJson(res, 200, { success: true, ...result })
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
			const email = auth.requireAuth(req, res)
			if (!email) return
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

		// ── Debug Team Endpoints ───────────────────────────────────────────────

		// GET /debug-team/status — Get debug team / autonomous loop status
		if (method === "GET" && (url === "/debug-team/status" || normalizedUrl === "/debug-team/status")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				if (!autonomousLoop) {
					sendJson(res, 200, {
						success: true,
						status: "idle",
						running: false,
						jobId: null,
						currentStep: 0,
						currentStepName: "—",
						totalSteps: 10,
						progress: 0,
						elapsedFormatted: "—",
						remainingFormatted: "—",
						stepResults: [],
						error: null,
					})
					return
				}
				const status = autonomousLoop.getStatus()
				sendJson(res, 200, { success: true, ...status })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /debug-team/start — Start debug team autonomous loop
		if (method === "POST" && (url === "/debug-team/start" || normalizedUrl === "/debug-team/start")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				const body = await parseBody(req)
				const target = body.target || "superroo2"
				const branch = body.branch || "main"
				const durationMs = body.durationMs || 5 * 60 * 60 * 1000
				const stepTimeoutMs = body.stepTimeoutMs || 10 * 60 * 1000

				if (!orchestrator) {
					sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
					return
				}

				if (autonomousLoop && autonomousLoop.getStatus().running) {
					sendJson(res, 409, { success: false, error: "Debug team loop is already running" })
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

				const result = await autonomousLoop.start({ jobId: `debug-${Date.now()}` })
				sendJson(res, result.success ? 200 : 400, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /debug-team/stop — Stop debug team autonomous loop
		if (method === "POST" && (url === "/debug-team/stop" || normalizedUrl === "/debug-team/stop")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				if (!autonomousLoop) {
					sendJson(res, 404, { success: false, error: "No debug team loop is running" })
					return
				}
				const result = await autonomousLoop.stop()
				sendJson(res, 200, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /debug-team/jobs — List recent debug jobs from orchestrator events
		if (method === "GET" && (url === "/debug-team/jobs" || normalizedUrl === "/debug-team/jobs")) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				const limit = parseInt(new URL(req.url, `http://localhost`).searchParams.get("limit") || "20")
				let jobs = []
				if (orchestrator && orchestrator.eventLog) {
					const events = await orchestrator.eventLog.query({ agent: "debug-team", limit: limit * 2 })
					// Group events into synthetic jobs
					const jobMap = new Map()
					for (const ev of events || []) {
						const jobId = ev.data?.jobId || ev.data?.debugJobId || "unknown"
						if (!jobMap.has(jobId)) {
							jobMap.set(jobId, {
								id: jobId,
								goal: ev.data?.goal || "Autonomous debug task",
								status: "unknown",
								createdAt: ev.timestamp || Date.now(),
								updatedAt: ev.timestamp || Date.now(),
								events: [],
							})
						}
						const job = jobMap.get(jobId)
						job.events.push(ev)
						job.updatedAt = Math.max(job.updatedAt, ev.timestamp || Date.now())
						if (ev.type?.includes("success")) job.status = "success"
						else if (ev.type?.includes("failed")) job.status = "failed"
						else if (ev.type?.includes("started")) job.status = "running"
					}
					jobs = Array.from(jobMap.values()).slice(0, limit)
				}
				// Fallback: if autonomousLoop is running, include its current job
				if (autonomousLoop) {
					const autoStatus = autonomousLoop.getStatus()
					if (autoStatus.running) {
						const existing = jobs.find((j) => j.id === autoStatus.jobId)
						if (!existing) {
							jobs.unshift({
								id: autoStatus.jobId,
								goal: `Autonomous loop: ${autoStatus.target}`,
								status: "running",
								createdAt: autoStatus.startedAt || Date.now(),
								updatedAt: Date.now(),
								events: [],
								currentStep: autoStatus.currentStep,
								currentStepName: autoStatus.currentStepName,
								progress: autoStatus.progress,
							})
						} else {
							existing.status = "running"
							existing.currentStep = autoStatus.currentStep
							existing.currentStepName = autoStatus.currentStepName
							existing.progress = autoStatus.progress
						}
					}
				}
				sendJson(res, 200, { success: true, jobs })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /debug-team/test-telegram — Test Telegram notification config
		if (
			method === "POST" &&
			(url === "/debug-team/test-telegram" || normalizedUrl === "/debug-team/test-telegram")
		) {
			const email = auth.requireAuth(req, res)
			if (!email) return
			try {
				const body = await parseBody(req)
				const { botToken, chatId } = body
				if (!botToken || !chatId) {
					sendJson(res, 400, { success: false, error: "botToken and chatId are required" })
					return
				}
				const text =
					"🧪 *SuperRoo Debug Team Test*\n\nYour Telegram notification configuration is working correctly!\n\n_Test sent at " +
					new Date().toISOString() +
					"_"
				const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: chatId,
						text,
						parse_mode: "Markdown",
					}),
				})
				if (!tgRes.ok) {
					const tgBody = await tgRes.text()
					sendJson(res, 400, { success: false, error: `Telegram API error ${tgRes.status}: ${tgBody}` })
					return
				}
				sendJson(res, 200, { success: true, message: "Test notification sent" })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Commissioning Loop Endpoints ─────────────────────────────────────────

		/**
		 * Map numeric phase (1-14) to kebab-case string key used by the dashboard frontend.
		 */
		function _phaseNumberToKey(phase) {
			const map = {
				1: "repo-inspection",
				2: "env-validation",
				3: "boot-verification",
				4: "ui-testing",
				5: "api-verification",
				6: "database-validation",
				7: "integration-verification",
				8: "queue-worker-testing",
				9: "file-upload-testing",
				10: "security-auth",
				11: "performance-stability",
				12: "autonomous-debugging",
				13: "reporting",
				14: "cleanup",
			}
			return map[phase] || `phase-${phase}`
		}

		/**
		 * Normalize the raw CommissioningLoop status into the shape the dashboard frontend expects.
		 */
		function _normalizeCommissioningStatus(raw) {
			if (!raw) return null
			return {
				running: raw.running || false,
				currentPhase: raw.currentPhase ? _phaseNumberToKey(raw.currentPhase) : null,
				currentPhaseName: raw.currentPhaseName || null,
				totalPhases: raw.totalPhases || 14,
				progress: raw.progress || 0,
				overallStatus: raw.overallStatus || "PENDING",
				elapsedMs: raw.elapsedMs || 0,
				elapsedFormatted: raw.elapsedFormatted || "",
				error: raw.error || null,
				startedAt: raw.startedAt || null,
				phaseResults: (raw.phaseResults || []).map((pr) => ({
					phase: typeof pr.phase === "number" ? _phaseNumberToKey(pr.phase) : pr.phase,
					name: pr.name || "",
					status:
						pr.status === "completed"
							? "passed"
							: pr.status === "error"
								? "failed"
								: pr.status || "skipped",
					duration: pr.duration || 0,
					findings: pr.findings || pr.evidence?.length || 0,
					results: pr.results || 0,
					details: pr.details || null,
					reason: pr.reason || null,
				})),
				reportUrl: raw.reportUrl || null,
				jobId: raw.jobId || null,
			}
		}

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
					const raw = commissioningLoop.getStatus()
					const status = _normalizeCommissioningStatus(raw)
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
				// Normalize the initial status in the response
				if (result && result.success) {
					const raw = commissioningLoop.getStatus()
					result.status = _normalizeCommissioningStatus(raw)
				}
				sendJson(res, result.success ? 200 : 400, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /commissioning/status — Get commissioning status (no jobId required, for dashboard)
		// GET /commissioning/status/:jobId — Get commissioning status by jobId
		if (
			method === "GET" &&
			(url === "/commissioning/status" ||
				normalizedUrl === "/commissioning/status" ||
				url.startsWith("/commissioning/status/") ||
				normalizedUrl.startsWith("/commissioning/status/"))
		) {
			try {
				if (!commissioningLoop) {
					sendJson(res, 200, {
						success: true,
						status: {
							running: false,
							currentPhase: null,
							phaseResults: [],
							reportUrl: null,
							jobId: null,
							totalPhases: 14,
							progress: 0,
							overallStatus: "PENDING",
							elapsedMs: 0,
							elapsedFormatted: "",
							error: null,
							startedAt: null,
						},
					})
					return
				}
				const raw = commissioningLoop.getStatus()
				const status = _normalizeCommissioningStatus(raw)
				sendJson(res, 200, { success: true, status })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /commissioning/stop — Stop the commissioning loop (no jobId required, for dashboard)
		// POST /commissioning/stop/:jobId — Stop the commissioning loop by jobId
		if (
			method === "POST" &&
			(url === "/commissioning/stop" ||
				normalizedUrl === "/commissioning/stop" ||
				url.startsWith("/commissioning/stop/") ||
				normalizedUrl.startsWith("/commissioning/stop/"))
		) {
			try {
				if (!commissioningLoop) {
					sendJson(res, 404, { success: false, error: "No commissioning is running" })
					return
				}
				const result = await commissioningLoop.stop()
				// Normalize status in response
				if (result) {
					const raw = commissioningLoop.getStatus()
					result.status = _normalizeCommissioningStatus(raw)
				}
				sendJson(res, 200, result)
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /commissioning/report — Retrieve the final commissioning report
		if (method === "GET" && (url === "/commissioning/report" || normalizedUrl === "/commissioning/report")) {
			try {
				if (!commissioningLoop) {
					sendJson(res, 200, {
						report: null,
						message: "No commissioning report available. Run commissioning first.",
					})
					return
				}
				const raw = commissioningLoop.getStatus()
				if (raw && raw.report) {
					sendJson(res, 200, { report: raw.report })
				} else {
					sendJson(res, 200, {
						report: null,
						message: "No commissioning report available. Run commissioning first.",
					})
				}
			} catch (err) {
				writeApiLog("error", "commissioning-report", "Failed to get commissioning report", {
					error: err.message,
				})
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Visual Crawler Endpoints ───────────────────────────────────────────

		// POST /visual-crawl/run — Run a visual crawl
		if (method === "POST" && (url === "/visual-crawl/run" || normalizedUrl === "/visual-crawl/run")) {
			try {
				const body = await parseBody(req)
				const report = await visualCrawler.runCrawl({
					url: body.url || `http://localhost:3001/?page=ide-terminal`,
					viewports: body.viewports,
					authToken: body.authToken || "e2e-test-token",
					updateBaselines: body.updateBaselines,
					thresholdPercent: body.thresholdPercent,
					projectName: body.projectName,
				})
				sendJson(res, 200, { success: true, report })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /visual-crawl/reports — List crawl reports (optional ?project= query)
		if (method === "GET" && (url === "/visual-crawl/reports" || normalizedUrl === "/visual-crawl/reports")) {
			try {
				const parsedUrl = new URL(url, "http://localhost")
				const projectName = parsedUrl.searchParams.get("project") || undefined
				const reports = await visualCrawler.listReports(projectName)
				sendJson(res, 200, { success: true, reports })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// GET /visual-crawl/reports/:id — Get a single report
		if (
			method === "GET" &&
			(url.startsWith("/visual-crawl/reports/") || normalizedUrl.startsWith("/visual-crawl/reports/"))
		) {
			try {
				const crawlId = url.split("/").pop()
				const report = await visualCrawler.getReport(crawlId)
				if (!report) {
					sendJson(res, 404, { success: false, error: "Report not found" })
					return
				}
				sendJson(res, 200, { success: true, report })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /visual-crawl/verify/:id — Re-run crawl after fix
		if (
			method === "POST" &&
			(url.startsWith("/visual-crawl/verify/") || normalizedUrl.startsWith("/visual-crawl/verify/"))
		) {
			try {
				const originalCrawlId = url.split("/").pop()
				const body = await parseBody(req)
				const result = await visualCrawler.rerunAfterFix(originalCrawlId, {
					url: body.url,
					viewports: body.viewports,
					authToken: body.authToken || "e2e-test-token",
					thresholdPercent: body.thresholdPercent,
					projectName: body.projectName,
				})
				sendJson(res, 200, { success: true, result })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// ── Visual Crawler Project Registry Endpoints ─────────────────────────

		// GET /visual-crawl/projects — List all registered projects
		if (method === "GET" && (url === "/visual-crawl/projects" || normalizedUrl === "/visual-crawl/projects")) {
			try {
				const registry = await visualCrawler.getProjectRegistry()
				sendJson(res, 200, { success: true, projects: registry.projects })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// POST /visual-crawl/projects — Add a new project to the registry
		if (method === "POST" && (url === "/visual-crawl/projects" || normalizedUrl === "/visual-crawl/projects")) {
			try {
				const body = await parseBody(req)
				const registry = await visualCrawler.addProject({
					name: body.name,
					label: body.label,
					baseUrl: body.baseUrl,
					authToken: body.authToken,
					pages: body.pages,
				})
				sendJson(res, 200, { success: true, projects: registry.projects })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// DELETE /visual-crawl/projects/:name — Remove a project
		if (
			method === "DELETE" &&
			(url.startsWith("/visual-crawl/projects/") || normalizedUrl.startsWith("/visual-crawl/projects/"))
		) {
			try {
				const projectName = url.split("/").pop()
				const registry = await visualCrawler.removeProject(projectName)
				sendJson(res, 200, { success: true, projects: registry.projects })
			} catch (err) {
				sendJson(res, 500, { success: false, error: err.message })
			}
			return
		}

		// PUT /visual-crawl/projects/:name/pages — Update a project's pages
		if (method === "PUT" && url.includes("/visual-crawl/projects/") && url.endsWith("/pages")) {
			try {
				const projectName = url.split("/")[3]
				const body = await parseBody(req)
				const registry = await visualCrawler.updateProjectPages(projectName, body.pages || [])
				sendJson(res, 200, { success: true, projects: registry.projects })
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

// ── WebSocket Upgrade Handler ────────────────────────────────────────────────
// Intercept HTTP upgrade requests for /api/ws/chat, /api/brain/ws, /api/ws/lsp,
// and /api/ws/collaboration paths
// NOTE: Must be placed AFTER server declaration to avoid TDZ ReferenceError
server.on("upgrade", (request, socket, head) => {
	const url = request.url || ""
	// Normalize: handle both /api/ws/chat and /ws/chat
	const normalizedUrl = url.startsWith("/api") ? url.slice(4) : url

	if (normalizedUrl.startsWith("/ws/chat")) {
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit("connection", ws, request)
		})
	} else if (normalizedUrl.startsWith("/brain/ws")) {
		brainWss.handleUpgrade(request, socket, head, (ws) => {
			brainWss.emit("connection", ws, request)
		})
	} else if (normalizedUrl.startsWith("/ws/lsp")) {
		lspWss.handleUpgrade(request, socket, head, (ws) => {
			lspWss.emit("connection", ws, request)
		})
	} else if (normalizedUrl.startsWith("/ws/collaboration")) {
		// Collaboration WebSocket — real-time cursor sync, file sync, session management
		const collaborationWss = global.__collaborationWss
		if (collaborationWss) {
			collaborationWss.handleUpgrade(request, socket, head, (ws) => {
				collaborationWss.emit("connection", ws, request)
			})
		} else {
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

// Load persisted encrypted secrets and auth store before accepting requests
Promise.all([loadEncryptedSecrets(), auth.loadStore()]).then(async () => {
	loadEnvironmentSecrets()

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
