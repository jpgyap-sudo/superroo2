/**
 * Full-Stack Crawl Test
 * Tests ALL dashboard pages, API endpoints, features, and functionality.
 * Crawls the entire website and cloud infrastructure.
 *
 * Usage: node cloud/test-full-stack-crawl.js
 */

const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")

// ── Configuration ──────────────────────────────────────────────
const VPS_HOST = "104.248.225.250"
const DASHBOARD_PORT = 3001
const API_PORT = 8787
const MINI_IDE_PORT = 8081

const BASE_API = `http://${VPS_HOST}:${API_PORT}`
const BASE_DASHBOARD = `http://${VPS_HOST}:${DASHBOARD_PORT}`
const BASE_MINI_IDE = `http://${VPS_HOST}:${MINI_IDE_PORT}`

// ── Test Framework ─────────────────────────────────────────────
var passed = 0
var failed = 0
var total = 0
var results = []

function test(name, fn) {
	total++
	try {
		const result = fn()
		if (result && typeof result.then === "function") {
			// Async test
			return result
				.then(() => {
					passed++
					results.push({ name, status: "PASS" })
					console.log("  ✅ " + name)
				})
				.catch((e) => {
					failed++
					results.push({ name, status: "FAIL", error: e.message })
					console.log("  ❌ " + name + ": " + e.message)
				})
		}
		passed++
		results.push({ name, status: "PASS" })
		console.log("  ✅ " + name)
	} catch (e) {
		failed++
		results.push({ name, status: "FAIL", error: e.message })
		console.log("  ❌ " + name + ": " + e.message)
	}
}

function assert(condition, msg) {
	if (!condition) throw new Error(msg || "Assertion failed")
}

function assertEqual(actual, expected, msg) {
	if (actual !== expected) {
		throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
	}
}

// ── HTTP Helpers ───────────────────────────────────────────────
function fetchUrl(url, options = {}) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith("https") ? https : http
		const req = client.get(url, options, (res) => {
			let data = ""
			res.on("data", (chunk) => (data += chunk))
			res.on("end", () => {
				resolve({
					status: res.statusCode,
					headers: res.headers,
					body: data,
					json: () => {
						try {
							return JSON.parse(data)
						} catch {
							return null
						}
					},
				})
			})
		})
		req.on("error", reject)
		req.setTimeout(15000, () => {
			req.destroy()
			reject(new Error("Timeout"))
		})
	})
}

function postUrl(url, body, options = {}) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith("https") ? https : http
		const data = JSON.stringify(body)
		const parsed = new URL(url)
		const req = client.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: parsed.pathname + parsed.search,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(data),
					...options.headers,
				},
			},
			(res) => {
				let responseData = ""
				res.on("data", (chunk) => (responseData += chunk))
				res.on("end", () => {
					resolve({
						status: res.statusCode,
						headers: res.headers,
						body: responseData,
						json: () => {
							try {
								return JSON.parse(responseData)
							} catch {
								return null
							}
						},
					})
				})
			}
		)
		req.on("error", reject)
		req.setTimeout(15000, () => {
			req.destroy()
			reject(new Error("Timeout"))
		})
		req.write(data)
		req.end()
	})
}

// ── Dashboard Pages ────────────────────────────────────────────
const DASHBOARD_PAGES = [
	{ id: "overview", label: "Overview", file: "overview.tsx" },
	{ id: "working-tree", label: "Working Tree", file: "working-tree.tsx" },
	{ id: "jobs", label: "Jobs", file: "jobs.tsx" },
	{ id: "queue", label: "Queue", file: "queue.tsx" },
	{ id: "agents", label: "Agents", file: "agents.tsx" },
	{ id: "bugs", label: "Bugs", file: "bugs.tsx" },
	{ id: "healing", label: "Healing", file: "healing.tsx" },
	{ id: "monitoring", label: "Monitoring", file: "monitoring.tsx" },
	{ id: "skill-generator", label: "Skill Generator", file: "skill-generator.tsx" },
	{ id: "logs", label: "Logs", file: "logs.tsx" },
	{ id: "docker", label: "Docker Sandbox", file: "docker.tsx" },
	{ id: "approvals", label: "Approvals", file: "approvals.tsx" },
	{ id: "api-keys", label: "API Keys", file: "api-keys.tsx" },
	{ id: "settings", label: "Settings", file: "settings.tsx" },
	{ id: "ai", label: "AI Assistant", file: "ai-assistant.tsx" },
	{ id: "model-router", label: "Model Router", file: "model-router.tsx" },
	{ id: "github", label: "GitHub", file: "github.tsx" },
	{ id: "ide-terminal", label: "IDE Terminal", file: "ide-terminal.tsx" },
	{ id: "projects", label: "Projects", file: "projects.tsx" },
	{ id: "telegram", label: "Telegram", file: "telegram.tsx" },
	{ id: "auto-deploy", label: "Auto Deploy", file: "auto-deploy.tsx" },
]

// ── API Endpoints ──────────────────────────────────────────────
const API_ENDPOINTS = [
	// Public endpoints (no auth required)
	{ path: "/api/health", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/jobs", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/queue/stats", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/logs", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/healing/incidents", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/docker/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/system/stats", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/providers", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/agents", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/bugs", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/features", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/deployments", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/approvals", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/auto-deploy/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/github/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/orchestrator/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/orchestrator/hermes/stats", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/telegram/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/skill-generator/list", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/working-tree", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/status", method: "GET", auth: false, expectedStatus: 200 },
	// IDE workspace endpoints
	{ path: "/api/ide-workspace/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/ide-workspace/orchestrator/status", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/ide-workspace/hermes/recall", method: "GET", auth: false, expectedStatus: 200 },
	{ path: "/api/ide-workspace/hermes/stats", method: "GET", auth: false, expectedStatus: 200 },
	// POST endpoints
	{ path: "/api/ide-workspace/chat", method: "POST", auth: false, expectedStatus: 200, body: { message: "hello", sessionId: "test-crawl" } },
]

// ── Tests ──────────────────────────────────────────────────────

async function runAllTests() {
	console.log("\n╔══════════════════════════════════════════════════════════════╗")
	console.log("║     Full-Stack Crawl Test Suite                            ║")
	console.log("╚══════════════════════════════════════════════════════════════╝")
	console.log("")

	// ── Category 1: Dashboard Pages ──
	console.log("\n=== Category 1: Dashboard Pages (Component Exports) ===")
	const viewsDir = path.join(__dirname, "dashboard/src/components/views")
	const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith(".tsx"))

	for (const page of DASHBOARD_PAGES) {
		test(`Dashboard page "${page.label}" (${page.id}) component file exists`, () => {
			assert(fs.existsSync(path.join(viewsDir, page.file)), `File ${page.file} not found`)
		})
	}

	// Check all view files export a component
	for (const file of viewFiles) {
		const content = fs.readFileSync(path.join(viewsDir, file), "utf-8")
		const name = file.replace(".tsx", "")
		test(`View file "${file}" exports a component`, () => {
			const hasExport = content.includes("export ") && (content.includes("function ") || content.includes("const "))
			assert(hasExport, `No export found in ${file}`)
		})
	}

	// ── Category 2: Dashboard Page Registration ──
	console.log("\n=== Category 2: Dashboard Page Registration ===")
	const pageContent = fs.readFileSync(path.join(__dirname, "dashboard/src/app/page.tsx"), "utf-8")

	for (const page of DASHBOARD_PAGES) {
		test(`Page "${page.id}" registered in PAGES map`, () => {
			assert(pageContent.includes(`"${page.id}":`), `Page "${page.id}" not found in PAGES map`)
		})
		test(`Page "${page.id}" has import statement`, () => {
			const importName = page.file.replace(".tsx", "")
			const pascalName = importName
				.split("-")
				.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
				.join("")
			const viewName = importName === "ide-terminal" ? "IdeTerminalView" :
				importName === "model-router" ? "ModelRouterView" :
				importName === "ai-assistant" ? "AiAssistantView" :
				importName === "skill-generator" ? "SkillGeneratorView" :
				importName === "api-keys" ? "ApiKeysView" :
				importName === "auto-deploy" ? "AutoDeployView" :
				importName === "working-tree" ? "WorkingTreeView" :
				pascalName + "View"
			assert(pageContent.includes(viewName), `Import ${viewName} not found for page ${page.id}`)
		})
	}

	// ── Category 3: Sidebar Navigation ──
	console.log("\n=== Category 3: Sidebar Navigation ===")
	const sidebarContent = fs.readFileSync(path.join(__dirname, "dashboard/src/components/sidebar.tsx"), "utf-8")

	for (const page of DASHBOARD_PAGES) {
		test(`Sidebar has navigation item for "${page.label}"`, () => {
			assert(sidebarContent.includes(page.label) || sidebarContent.includes(page.id), `Sidebar missing "${page.label}"`)
		})
	}

	// ── Category 4: API Endpoint Tests (Live VPS) ──
	console.log("\n=== Category 4: API Endpoint Tests (Live VPS) ===")

	// Health endpoint
	try {
		const healthRes = await fetchUrl(`${BASE_API}/api/health`)
		test("GET /api/health returns 200", () => {
			assertEqual(healthRes.status, 200, `Expected 200, got ${healthRes.status}`)
		})
		const health = healthRes.json()
		test("GET /api/health returns valid JSON", () => {
			assert(health !== null, "Response is not valid JSON")
		})
		test("GET /api/health has status field", () => {
			assert(health && health.status, "Missing status field")
		})
		test("API is online", () => {
			assert(health && health.status === "online", `API status: ${health?.status}`)
		})
		test("Health response includes redis status", () => {
			assert(health && "redis" in health, "Missing redis field")
		})
		test("Health response includes worker status", () => {
			assert(health && "worker" in health, "Missing worker field")
		})
		if (health && health.orchestrator) {
			test("Orchestrator is running", () => {
				assert(health.orchestrator.running === true, "Orchestrator not running")
			})
			test("Orchestrator has modules loaded", () => {
				assert(Array.isArray(health.orchestrator.modules) && health.orchestrator.modules.length > 0, "No modules loaded")
			})
			test("Orchestrator has hermesClaw module", () => {
				assert(health.orchestrator.modules.includes("hermesClaw"), "HermesClaw not loaded")
			})
			test("Orchestrator has safetyManager module", () => {
				assert(health.orchestrator.modules.includes("safetyManager"), "SafetyManager not loaded")
			})
			test("Orchestrator has healingBus module", () => {
				assert(health.orchestrator.modules.includes("healingBus"), "HealingBus not loaded")
			})
			test("Orchestrator has taskQueue module", () => {
				assert(health.orchestrator.modules.includes("taskQueue"), "TaskQueue not loaded")
			})
			test("Orchestrator has memory module", () => {
				assert(health.orchestrator.modules.includes("memory"), "Memory not loaded")
			})
		}
	} catch (e) {
		test("API health endpoint reachable", () => { throw e })
	}

	// Test all API endpoints
	for (const ep of API_ENDPOINTS) {
		try {
			const url = `${BASE_API}${ep.path}`
			let res
			if (ep.method === "POST") {
				res = await postUrl(url, ep.body || {})
			} else {
				res = await fetchUrl(url)
			}

			test(`${ep.method} ${ep.path} returns ${ep.expectedStatus}`, () => {
				assertEqual(res.status, ep.expectedStatus, `Expected ${ep.expectedStatus}, got ${res.status}`)
			})

			if (res.status === 200) {
				const json = res.json()
				test(`${ep.method} ${ep.path} returns valid JSON`, () => {
					assert(json !== null, "Response is not valid JSON")
				})
			}
		} catch (e) {
			test(`${ep.method} ${ep.path} is reachable`, () => { throw e })
		}
	}

	// ── Category 5: Dashboard HTML Load ──
	console.log("\n=== Category 5: Dashboard HTML Load ===")
	try {
		const dashRes = await fetchUrl(`${BASE_DASHBOARD}/`)
		test("Dashboard (port 3001) loads", () => {
			assertEqual(dashRes.status, 200, `Expected 200, got ${dashRes.status}`)
		})
		test("Dashboard returns HTML", () => {
			assert(dashRes.body.includes("<!DOCTYPE html>") || dashRes.body.includes("<html"), "Response is not HTML")
		})
		test("Dashboard has SuperRoo title", () => {
			assert(dashRes.body.includes("SuperRoo") || dashRes.body.includes("superroo"), "Missing SuperRoo in HTML")
		})
	} catch (e) {
		test("Dashboard is reachable", () => { throw e })
	}

	// ── Category 6: Mini IDE ──
	console.log("\n=== Category 6: Mini IDE ===")
	try {
		const miniRes = await fetchUrl(`${BASE_MINI_IDE}/`)
		test("Mini IDE (port 8081) loads", () => {
			assertEqual(miniRes.status, 200, `Expected 200, got ${miniRes.status}`)
		})
	} catch (e) {
		test("Mini IDE is reachable", () => { throw e })
	}

	// ── Category 7: Orchestrator Module Files ──
	console.log("\n=== Category 7: Orchestrator Module Files ===")
	const orchestratorModules = [
		"CloudOrchestrator.js",
		"index.js",
		"modules/TaskExecutor.js",
		"modules/HermesClaw.js",
		"modules/SafetyManager.js",
		"modules/HealingBus.js",
		"modules/BugRegistry.js",
		"modules/FeatureRegistry.js",
		"modules/SelfHealingLoop.js",
		"modules/InfiniteImprovementLoop.js",
		"modules/CPUGuard.js",
	]

	for (const mod of orchestratorModules) {
		test(`Orchestrator module "${mod}" exists`, () => {
			assert(fs.existsSync(path.join(__dirname, "orchestrator", mod)), `Module ${mod} not found`)
		})
	}

	// ── Category 8: Worker Files ──
	console.log("\n=== Category 8: Worker Files ===")
	const workerFiles = [
		"agentRunners.js",
		"orchestratorWorker.js",
		"autoDeployer.js",
	]
	for (const wf of workerFiles) {
		test(`Worker file "${wf}" exists`, () => {
			assert(fs.existsSync(path.join(__dirname, "worker", wf)), `Worker file ${wf} not found`)
		})
	}

	// ── Category 9: API File Structure ──
	console.log("\n=== Category 9: API File Structure ===")
	const apiFiles = [
		"api.js",
		"telegramBot.js",
	]
	for (const af of apiFiles) {
		test(`API file "${af}" exists`, () => {
			assert(fs.existsSync(path.join(__dirname, "api", af)), `API file ${af} not found`)
		})
	}

	// ── Category 10: IDE Terminal Features ──
	console.log("\n=== Category 10: IDE Terminal Features ===")
	const ideContent = fs.readFileSync(path.join(__dirname, "dashboard/src/components/views/ide-terminal.tsx"), "utf-8")

	const ideFeatures = [
		{ name: "Block-based terminal output", pattern: "OutputBlock" },
		{ name: "Smart autocomplete suggestions", pattern: "AutocompleteSuggestion" },
		{ name: "Terminal recording", pattern: "TerminalRecording" },
		{ name: "AI Assistant panel", pattern: "showAiPanel" },
		{ name: "File explorer panel", pattern: "showFilePanel" },
		{ name: "Terminal maximize", pattern: "isTerminalMaximized" },
		{ name: "Keyboard shortcuts modal", pattern: "showShortcuts" },
		{ name: "Ctrl+V paste handler", pattern: "handlePaste" },
		{ name: "Drag-and-drop file upload", pattern: "handleDragEnter" },
		{ name: "Image paste for AI", pattern: "image/png" },
		{ name: "Agent suggestions via / commands", pattern: "getAgentSuggestions" },
		{ name: "Pipeline bar visualization", pattern: "pipeline" },
		{ name: "File tree component", pattern: "FileTree" },
		{ name: "Recording replay modal", pattern: "showRecordings" },
		{ name: "Terminal resize handle", pattern: "handleTerminalResizeMouseDown" },
		{ name: "Output block collapse/expand", pattern: "toggleBlockCollapse" },
		{ name: "Output block copy", pattern: "handleCopyTerminal" },
		{ name: "Orchestrator status fetch", pattern: "fetchOrchestratorStatus" },
		{ name: "Hermes stats fetch", pattern: "fetchHermesStats" },
		{ name: "Deployments fetch", pattern: "fetchDeployments" },
	]

	for (const feature of ideFeatures) {
		test(`IDE Terminal: ${feature.name}`, () => {
			assert(ideContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in ide-terminal.tsx`)
		})
	}

	// ── Category 11: AI Assistant Features ──
	console.log("\n=== Category 11: AI Assistant Features ===")
	const aiContent = fs.readFileSync(path.join(__dirname, "dashboard/src/components/views/ai-assistant.tsx"), "utf-8")

	const aiFeatures = [
		{ name: "Workflow templates", pattern: "WORKFLOWS" },
		{ name: "Job queue display", pattern: "jobs" },
		{ name: "Queue stats", pattern: "QueueStats" },
		{ name: "Agent configuration", pattern: "AgentConfig" },
		{ name: "Workflow execution", pattern: "runWorkflow" },
		{ name: "Agent resumption", pattern: "resumeAgent" },
	]

	for (const feature of aiFeatures) {
		test(`AI Assistant: ${feature.name}`, () => {
			assert(aiContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in ai-assistant.tsx`)
		})
	}

	// ── Category 12: Sidebar Navigation Features ──
	console.log("\n=== Category 12: Sidebar Navigation Features ===")
	const sidebarFeatures = [
		{ name: "Navigation items array", pattern: "NAV" },
		{ name: "Page state management", pattern: "setPage" },
		{ name: "Active page highlighting", pattern: "active" },
		{ name: "Icon rendering", pattern: "LucideIcon" },
	]

	for (const feature of sidebarFeatures) {
		test(`Sidebar: ${feature.name}`, () => {
			assert(sidebarContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in sidebar.tsx`)
		})
	}

	// ── Category 13: API Handler Features ──
	console.log("\n=== Category 13: API Handler Features ===")
	const apiContent = fs.readFileSync(path.join(__dirname, "api/api.js"), "utf-8")

	const apiFeatures = [
		{ name: "Health endpoint", pattern: "/api/health" },
		{ name: "Jobs endpoint", pattern: "/api/jobs" },
		{ name: "Queue stats endpoint", pattern: "/api/queue/stats" },
		{ name: "Logs endpoint", pattern: "/api/logs" },
		{ name: "Healing incidents endpoint", pattern: "/api/healing/incidents" },
		{ name: "Docker status endpoint", pattern: "/api/docker/status" },
		{ name: "Orchestrator status endpoint", pattern: "/api/orchestrator/status" },
		{ name: "IDE workspace chat endpoint", pattern: "/api/ide-workspace/chat" },
		{ name: "IDE workspace status endpoint", pattern: "/api/ide-workspace/status" },
		{ name: "IDE workspace orchestrator status", pattern: "/api/ide-workspace/orchestrator/status" },
		{ name: "Hermes query endpoint", pattern: "/api/orchestrator/hermes/query" },
		{ name: "Hermes lesson endpoint", pattern: "/api/orchestrator/hermes/lesson" },
		{ name: "Hermes stats endpoint", pattern: "/api/orchestrator/hermes/stats" },
		{ name: "Auto-deploy status endpoint", pattern: "/api/auto-deploy/status" },
		{ name: "GitHub status endpoint", pattern: "/api/github/status" },
		{ name: "Telegram status endpoint", pattern: "/api/telegram/status" },
		{ name: "Provider management", pattern: "/api/providers" },
		{ name: "Agent routes", pattern: "/api/agents" },
		{ name: "Bug registry", pattern: "/api/bugs" },
		{ name: "Feature registry", pattern: "/api/features" },
		{ name: "Deployments", pattern: "/api/deployments" },
		{ name: "Approvals", pattern: "/api/approvals" },
		{ name: "Skill generator", pattern: "/api/skill-generator" },
		{ name: "Working tree", pattern: "/api/working-tree" },
		{ name: "System stats", pattern: "/api/system/stats" },
		{ name: "WebSocket support", pattern: "ws" },
		{ name: "Orchestrator initialization", pattern: "initOrchestrator" },
		{ name: "OpenClaw-powered chat", pattern: "orchestrator.submit" },
		{ name: "Hermes context recall in chat", pattern: "hermesClaw.recallContext" },
		{ name: "Hermes lesson extraction in chat", pattern: "hermesClaw.extractLessons" },
		{ name: "Port retry logic", pattern: "listenWithRetry" },
		{ name: "Safe module require", pattern: "safeRequire" },
		{ name: "Unhandled rejection handler", pattern: "unhandledRejection" },
	]

	for (const feature of apiFeatures) {
		test(`API: ${feature.name}`, () => {
			assert(apiContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in api.js`)
		})
	}

	// ── Category 14: Telegram Bot Features ──
	console.log("\n=== Category 14: Telegram Bot Features ===")
	const tgContent = fs.readFileSync(path.join(__dirname, "api/telegramBot.js"), "utf-8")

	const tgFeatures = [
		{ name: "Message sending", pattern: "sendMessage" },
		{ name: "Chat action", pattern: "sendChatAction" },
		{ name: "Inline keyboard", pattern: "sendInlineKeyboard" },
		{ name: "Callback query", pattern: "answerCallbackQuery" },
		{ name: "Message editing", pattern: "editMessageText" },
		{ name: "Webhook management", pattern: "setWebhook" },
		{ name: "Session management", pattern: "getSession" },
		{ name: "Auth session check", pattern: "checkAuthSession" },
		{ name: "Conversation context", pattern: "getConversationContext" },
		{ name: "Smart NLP routing", pattern: "handleSmartNLP" },
		{ name: "Coding intent detection", pattern: "detectCodingIntent" },
		{ name: "Workflow templates", pattern: "WORKFLOW_TEMPLATES" },
		{ name: "Command prediction", pattern: "getCommandPredictions" },
		{ name: "Command correction", pattern: "suggestCommandCorrection" },
		{ name: "Quick action buttons", pattern: "sendQuickActionButtons" },
		{ name: "Brain handlers", pattern: "handleBrain" },
		{ name: "Deploy handler", pattern: "handleDeploy" },
		{ name: "Test handler", pattern: "handleTest" },
		{ name: "Code handler", pattern: "handleCode" },
		{ name: "Status handler", pattern: "handleStatus" },
		{ name: "Login handler", pattern: "handleLogin" },
		{ name: "OTP handler", pattern: "handleOTP" },
		{ name: "Project management", pattern: "handleProjects" },
		{ name: "Workspace management", pattern: "handleWorkspace" },
		{ name: "Agent management", pattern: "handleAgents" },
		{ name: "Settings handler", pattern: "handleSettings" },
		{ name: "Mini IDE handler", pattern: "handleMiniIde" },
		{ name: "Orchestrator bridge", pattern: "orchestratorBridge" },
	]

	for (const feature of tgFeatures) {
		test(`Telegram Bot: ${feature.name}`, () => {
			assert(tgContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in telegramBot.js`)
		})
	}

	// ── Category 15: HermesClaw Features ──
	console.log("\n=== Category 15: HermesClaw Features ===")
	const hermesContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/HermesClaw.js"), "utf-8")

	const hermesFeatures = [
		{ name: "Class definition", pattern: "class HermesClaw" },
		{ name: "EventEmitter extension", pattern: "extends EventEmitter" },
		{ name: "Disk persistence", pattern: "_persist" },
		{ name: "Memory storage", pattern: "_memory" },
		{ name: "Context recall", pattern: "recallContext" },
		{ name: "Lesson extraction", pattern: "extractLessons" },
		{ name: "Memory summary", pattern: "generateMemorySummary" },
		{ name: "Skill creation", pattern: "createSkill" },
		{ name: "Pattern analysis", pattern: "analyzePatterns" },
		{ name: "Improvement suggestions", pattern: "suggestImprovements" },
		{ name: "Knowledge query", pattern: "queryKnowledge" },
		{ name: "Memory search", pattern: "_searchMemory" },
		{ name: "Structured data extraction", pattern: "_extractStructuredData" },
		{ name: "Per-operation model routing", pattern: "operationModels" },
		{ name: "OpenAI provider", pattern: "api.openai.com" },
		{ name: "DeepSeek provider", pattern: "api.deepseek.com" },
		{ name: "Stats tracking", pattern: "getStats" },
		{ name: "Stats reset", pattern: "resetStats" },
	]

	for (const feature of hermesFeatures) {
		test(`HermesClaw: ${feature.name}`, () => {
			assert(hermesContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in HermesClaw.js`)
		})
	}

	// ── Category 16: TaskExecutor Features ──
	console.log("\n=== Category 16: TaskExecutor Features ===")
	const teContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/TaskExecutor.js"), "utf-8")

	const teFeatures = [
		{ name: "Class definition", pattern: "class TaskExecutor" },
		{ name: "LLM-based breakdown", pattern: "_llmBreakdown" },
		{ name: "Rule-based breakdown", pattern: "_ruleBasedBreakdown" },
		{ name: "BullMQ queue dispatch", pattern: "BullQueue" },
		{ name: "Parallel execution", pattern: "parallelExecutor" },
		{ name: "Agent definitions", pattern: "AGENT_DEFINITIONS" },
		{ name: "Hermes context recall", pattern: "hermesClaw.recallContext" },
		{ name: "Hermes lesson extraction", pattern: "hermesClaw.extractLessons" },
		{ name: "Sub-task submission", pattern: "orchestrator.submit" },
		{ name: "Event logging", pattern: "eventLog.record" },
		{ name: "Healing bus integration", pattern: "healingBus.reportIncident" },
	]

	for (const feature of teFeatures) {
		test(`TaskExecutor: ${feature.name}`, () => {
			assert(teContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in TaskExecutor.js`)
		})
	}

	// ── Category 17: Agent Runners Features ──
	console.log("\n=== Category 17: Agent Runners Features ===")
	const arContent = fs.readFileSync(path.join(__dirname, "worker/agentRunners.js"), "utf-8")

	const arFeatures = [
		{ name: "Coder runner", pattern: "runCoder" },
		{ name: "Debugger runner", pattern: "runDebugger" },
		{ name: "Tester runner", pattern: "runTester" },
		{ name: "Planner runner", pattern: "runPlanner" },
		{ name: "Deployer runner", pattern: "runDeployer" },
		{ name: "Healer runner", pattern: "runHealer" },
		{ name: "LLM call function", pattern: "callLLM" },
		{ name: "Command execution", pattern: "runCommands" },
		{ name: "File read/write", pattern: "readFileContent" },
		{ name: "Hermes notification", pattern: "notifyHermes" },
		{ name: "Result logging", pattern: "writeResultLog" },
	]

	for (const feature of arFeatures) {
		test(`Agent Runners: ${feature.name}`, () => {
			assert(arContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in agentRunners.js`)
		})
	}

	// ── Category 18: Auto-Deployer Features ──
	console.log("\n=== Category 18: Auto-Deployer Features ===")
	const adContent = fs.readFileSync(path.join(__dirname, "worker/autoDeployer.js"), "utf-8")

	const adFeatures = [
		{ name: "Start deploy function", pattern: "startDeploy" },
		{ name: "Run deploy function", pattern: "runDeploy" },
		{ name: "Cooldown mechanism", pattern: "isInCooldown" },
		{ name: "Force stop deploy", pattern: "forceStopDeploy" },
		{ name: "SSH command execution", pattern: "sshCmd" },
		{ name: "GitHub webhook handler", pattern: "github-webhook" },
		{ name: "Status tracking", pattern: "saveStatus" },
		{ name: "Status loading", pattern: "loadStatus" },
		{ name: "Max duration enforcement", pattern: "MAX_DURATION_MS" },
		{ name: "Cooldown configuration", pattern: "COOLDOWN_MS" },
	]

	for (const feature of adFeatures) {
		test(`Auto-Deployer: ${feature.name}`, () => {
			assert(adContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in autoDeployer.js`)
		})
	}

	// ── Category 19: CloudOrchestrator Features ──
	console.log("\n=== Category 19: CloudOrchestrator Features ===")
	const coContent = fs.readFileSync(path.join(__dirname, "orchestrator/CloudOrchestrator.js"), "utf-8")

	const coFeatures = [
		{ name: "Class definition", pattern: "class CloudOrchestrator" },
		{ name: "EventEmitter extension", pattern: "extends EventEmitter" },
		{ name: "Task submission", pattern: "submit" },
		{ name: "Task processing", pattern: "processNext" },
		{ name: "Task completion", pattern: "completeTask" },
		{ name: "Task failure", pattern: "failTask" },
		{ name: "Main loop", pattern: "runLoop" },
		{ name: "Mode switching", pattern: "setMode" },
		{ name: "Self-improve toggle", pattern: "enableSelfImprove" },
		{ name: "Provider resolver", pattern: "setProviderResolver" },
		{ name: "HermesClaw registration", pattern: "registerHermesClaw" },
		{ name: "Status reporting", pattern: "getStatus" },
		{ name: "Safety mode enum", pattern: "SafetyMode" },
		{ name: "Event logging", pattern: "eventLog.record" },
		{ name: "Task queue integration", pattern: "taskQueue" },
	]

	for (const feature of coFeatures) {
		test(`CloudOrchestrator: ${feature.name}`, () => {
			assert(coContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in CloudOrchestrator.js`)
		})
	}

	// ── Category 20: SafetyManager Features ──
	console.log("\n=== Category 20: SafetyManager Features ===")
	const smContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf-8")

	const smFeatures = [
		{ name: "Class definition", pattern: "class SafetyManager" },
		{ name: "Capability checking", pattern: "checkCapability" },
		{ name: "Command checking", pattern: "checkCommand" },
		{ name: "SQL injection protection", pattern: "checkSql" },
		{ name: "Path checking", pattern: "checkPath" },
		{ name: "Self-improve boundary", pattern: "checkSelfImproveBoundary" },
		{ name: "Blocklist loading", pattern: "_loadBlocklist" },
		{ name: "Safety mode enum", pattern: "SafetyMode" },
	]

	for (const feature of smFeatures) {
		test(`SafetyManager: ${feature.name}`, () => {
			assert(smContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in SafetyManager.js`)
		})
	}

	// ── Category 21: HealingBus Features ──
	console.log("\n=== Category 21: HealingBus Features ===")
	const hbContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/HealingBus.js"), "utf-8")

	const hbFeatures = [
		{ name: "Class definition", pattern: "class HealingBus" },
		{ name: "Incident reporting", pattern: "reportIncident" },
		{ name: "Incident lifecycle", pattern: "IncidentStatus" },
		{ name: "Incident listing", pattern: "list" },
		{ name: "Incident update", pattern: "updateIncident" },
		{ name: "Healing actions", pattern: "logHealingAction" },
		{ name: "Healing metrics", pattern: "getHealingMetrics" },
		{ name: "State transitions", pattern: "transitionState" },
		{ name: "Auto-fix check", pattern: "isAutoFixAllowed" },
		{ name: "Root cause categories", pattern: "RootCauseCategory" },
	]

	for (const feature of hbFeatures) {
		test(`HealingBus: ${feature.name}`, () => {
			assert(hbContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in HealingBus.js`)
		})
	}

	// ── Category 22: SelfHealingLoop Features ──
	console.log("\n=== Category 22: SelfHealingLoop Features ===")
	const shlContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SelfHealingLoop.js"), "utf-8")

	const shlFeatures = [
		{ name: "Class definition", pattern: "class SelfHealingLoop" },
		{ name: "Healing cycle", pattern: "runHealingCycle" },
		{ name: "Incident processing", pattern: "_processIncident" },
		{ name: "Fix task queuing", pattern: "_queueFixTask" },
		{ name: "Escalation check", pattern: "shouldEscalate" },
		{ name: "Failure recording", pattern: "recordFailure" },
		{ name: "Cycle scheduling", pattern: "_scheduleNext" },
	]

	for (const feature of shlFeatures) {
		test(`SelfHealingLoop: ${feature.name}`, () => {
			assert(shlContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in SelfHealingLoop.js`)
		})
	}

	// ── Category 23: InfiniteImprovementLoop Features ──
	console.log("\n=== Category 23: InfiniteImprovementLoop Features ===")
	const iilContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/InfiniteImprovementLoop.js"), "utf-8")

	const iilFeatures = [
		{ name: "Class definition", pattern: "class InfiniteImprovementLoop" },
		{ name: "ML model training", pattern: "_trainModel" },
		{ name: "Action prediction", pattern: "predictAndAct" },
		{ name: "Model merging", pattern: "_triggerMerge" },
		{ name: "Observation and learning", pattern: "observeAndLearn" },
		{ name: "Code sample extraction", pattern: "_extractCodeSamples" },
		{ name: "Debug sample extraction", pattern: "_extractDebugSamples" },
		{ name: "Test sample extraction", pattern: "_extractTestSamples" },
		{ name: "Action validation", pattern: "validateAction" },
		{ name: "Stats reporting", pattern: "getStats" },
	]

	for (const feature of iilFeatures) {
		test(`InfiniteImprovementLoop: ${feature.name}`, () => {
			assert(iilContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in InfiniteImprovementLoop.js`)
		})
	}

	// ── Category 24: CPUGuard Features ──
	console.log("\n=== Category 24: CPUGuard Features ===")
	const cgContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/CPUGuard.js"), "utf-8")

	const cgFeatures = [
		{ name: "CPU usage measurement", pattern: "getCpuUsagePercent" },
		{ name: "RAM usage measurement", pattern: "getRamUsagePercent" },
		{ name: "Resource sampling", pattern: "getResourceSample" },
		{ name: "CPU wait function", pattern: "waitForCpuBelow" },
		{ name: "Guarded agent loop", pattern: "runGuardedAgentLoop" },
		{ name: "Autonomous controller", pattern: "autonomousController" },
		{ name: "Controlled autonomous task", pattern: "runControlledAutonomousTask" },
	]

	for (const feature of cgFeatures) {
		test(`CPUGuard: ${feature.name}`, () => {
			assert(cgContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in CPUGuard.js`)
		})
	}

	// ── Category 25: BugRegistry Features ──
	console.log("\n=== Category 25: BugRegistry Features ===")
	const brContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/BugRegistry.js"), "utf-8")

	const brFeatures = [
		{ name: "Class definition", pattern: "class BugRegistry" },
		{ name: "Bug creation", pattern: "create" },
		{ name: "Bug retrieval", pattern: "get" },
		{ name: "Bug listing", pattern: "list" },
		{ name: "Bug update", pattern: "update" },
		{ name: "Bug deletion", pattern: "delete" },
		{ name: "Fix recording", pattern: "recordFix" },
		{ name: "Fix listing", pattern: "listFixes" },
		{ name: "Stats reporting", pattern: "getStats" },
		{ name: "Status enum", pattern: "BugStatus" },
		{ name: "Severity enum", pattern: "BugSeverity" },
	]

	for (const feature of brFeatures) {
		test(`BugRegistry: ${feature.name}`, () => {
			assert(brContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in BugRegistry.js`)
		})
	}

	// ── Category 26: FeatureRegistry Features ──
	console.log("\n=== Category 26: FeatureRegistry Features ===")
	const frContent = fs.readFileSync(path.join(__dirname, "orchestrator/modules/FeatureRegistry.js"), "utf-8")

	const frFeatures = [
		{ name: "Class definition", pattern: "class FeatureRegistry" },
		{ name: "Feature creation", pattern: "create" },
		{ name: "Feature retrieval", pattern: "get" },
		{ name: "Feature listing", pattern: "list" },
		{ name: "Feature update", pattern: "update" },
		{ name: "Feature deletion", pattern: "delete" },
		{ name: "Stats reporting", pattern: "getStats" },
		{ name: "Status enum", pattern: "FeatureStatus" },
		{ name: "Health enum", pattern: "FeatureHealth" },
	]

	for (const feature of frFeatures) {
		test(`FeatureRegistry: ${feature.name}`, () => {
			assert(frContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in FeatureRegistry.js`)
		})
	}

	// ── Category 27: PM2 Ecosystem Config ──
	console.log("\n=== Category 27: PM2 Ecosystem Config ===")
	const ecoContent = fs.readFileSync(path.join(__dirname, "ecosystem.config.js"), "utf-8")

	const ecoFeatures = [
		{ name: "API app definition", pattern: "superroo-api" },
		{ name: "Dashboard app definition", pattern: "superroo-dashboard" },
		{ name: "Worker app definition", pattern: "superroo-worker" },
		{ name: "Mini IDE app definition", pattern: "superroo-mini-ide" },
		{ name: "Auto-deployer app definition", pattern: "superroo-auto-deployer" },
		{ name: "Port retry config", pattern: "min_uptime" },
		{ name: "Restart delay config", pattern: "restart_delay" },
		{ name: "Max restarts config", pattern: "max_restarts" },
		{ name: "Kill timeout config", pattern: "kill_timeout" },
		{ name: "Error file logging", pattern: "error_file" },
		{ name: "Output file logging", pattern: "out_file" },
	]

	for (const feature of ecoFeatures) {
		test(`PM2 Ecosystem: ${feature.name}`, () => {
			assert(ecoContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in ecosystem.config.js`)
		})
	}

	// ── Category 28: Orchestrator Index Exports ──
	console.log("\n=== Category 28: Orchestrator Index Exports ===")
	const oiContent = fs.readFileSync(path.join(__dirname, "orchestrator/index.js"), "utf-8")

	const oiFeatures = [
		{ name: "CloudOrchestrator export", pattern: "CloudOrchestrator" },
		{ name: "TaskExecutor export", pattern: "TaskExecutor" },
		{ name: "SafetyManager export", pattern: "SafetyManager" },
		{ name: "HealingBus export", pattern: "HealingBus" },
		{ name: "BugRegistry export", pattern: "BugRegistry" },
		{ name: "FeatureRegistry export", pattern: "FeatureRegistry" },
		{ name: "SelfHealingLoop export", pattern: "SelfHealingLoop" },
		{ name: "InfiniteImprovementLoop export", pattern: "InfiniteImprovementLoop" },
		{ name: "HermesClaw export", pattern: "HermesClaw" },
	]

	for (const feature of oiFeatures) {
		test(`Orchestrator Index: ${feature.name}`, () => {
			assert(oiContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in index.js`)
		})
	}

	// ── Category 29: Dashboard Package Config ──
	console.log("\n=== Category 29: Dashboard Package Config ===")
	const dpContent = fs.readFileSync(path.join(__dirname, "dashboard/package.json"), "utf-8")

	const dpFeatures = [
		{ name: "Next.js dependency", pattern: "next" },
		{ name: "React dependency", pattern: "react" },
		{ name: "Tailwind CSS dependency", pattern: "tailwindcss" },
		{ name: "Build script", pattern: "build" },
		{ name: "Dev script", pattern: "dev" },
	]

	for (const feature of dpFeatures) {
		test(`Dashboard Package: ${feature.name}`, () => {
			assert(dpContent.includes(feature.pattern), `Pattern "${feature.pattern}" not found in dashboard/package.json`)
		})
	}

	// ── Results ──
	console.log("\n╔══════════════════════════════════════════════════════════════╗")
	console.log("║     Results                                                 ║")
	console.log("╚══════════════════════════════════════════════════════════════╝")
	console.log("")
	console.log(`  Total: ${total}`)
	console.log(`  Passed: ${passed}`)
	console.log(`  Failed: ${failed}`)
	console.log("")

	if (failed === 0) {
		console.log("  🎉 ALL " + total + " TESTS PASSED!")
	} else {
		console.log("  ❌ " + failed + " TESTS FAILED")
		console.log("\n  Failed tests:")
		for (const r of results) {
			if (r.status === "FAIL") {
				console.log("    - " + r.name + ": " + r.error)
			}
		}
	}

	process.exit(failed > 0 ? 1 : 0)
}

runAllTests().catch((e) => {
	console.error("Fatal error:", e)
	process.exit(1)
})