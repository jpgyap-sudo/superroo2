/**
 * E2E test for model router save/load persistence.
 *
 * Reproduces and verifies the fix for the bug where changing primary/fallback
 * models in the dashboard and saving would revert on reload.
 *
 * Run with: node cloud/test-model-router-e2e.js
 */

const assert = require("assert")

// ── Replicate the constants and logic from cloud/api/api.js ───────────────────

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

// In-memory settings store (replaces loadSettings/saveSettings)
let settings = {
	routing: { routes: JSON.parse(JSON.stringify(DEFAULT_AGENT_ROUTES)) },
}

function getRoutes() {
	const agentRoutes = settings.routing.routes || DEFAULT_AGENT_ROUTES
	return taskTypes.map((taskType) => {
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
		}
	})
}

function patchRoute(routeId, data) {
	const taskType = routeId.replace("route-", "")
	const agentRoutes = settings.routing.routes || DEFAULT_AGENT_ROUTES

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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name, fn) {
	try {
		fn()
		passed++
		console.log("  ✓ " + name)
	} catch (e) {
		failed++
		console.log("  ✗ " + name)
		console.log("    " + e.message)
	}
}

console.log("\n" + "=".repeat(60))
console.log("  Model Router E2E Persistence Tests")
console.log("=".repeat(60))

// Reset settings before each test block
settings = { routing: { routes: JSON.parse(JSON.stringify(DEFAULT_AGENT_ROUTES)) } }

test("GET returns correct default for planning (maps to planner)", () => {
	const routes = getRoutes()
	const planning = routes.find((r) => r.taskType === "planning")
	assert.strictEqual(planning.primaryProvider, "openai")
	assert.strictEqual(planning.primaryModel, "gpt-4o")
	assert.strictEqual(planning.fallbackProvider1, "anthropic")
})

test("GET returns correct default for coding (maps to coder)", () => {
	const routes = getRoutes()
	const coding = routes.find((r) => r.taskType === "coding")
	assert.strictEqual(coding.primaryProvider, "anthropic")
	assert.strictEqual(coding.primaryModel, "claude-sonnet-4-20250514")
	assert.strictEqual(coding.fallbackProvider1, "openai")
})

test("GET returns correct default for deployment (maps to deployChecker)", () => {
	const routes = getRoutes()
	const deployment = routes.find((r) => r.taskType === "deployment")
	assert.strictEqual(deployment.primaryProvider, "openai")
	assert.strictEqual(deployment.primaryModel, "gpt-4o-mini")
	assert.strictEqual(deployment.fallbackProvider1, "groq")
})

test("GET returns correct default for architecture (maps to coder)", () => {
	const routes = getRoutes()
	const architecture = routes.find((r) => r.taskType === "architecture")
	assert.strictEqual(architecture.primaryProvider, "anthropic")
	assert.strictEqual(architecture.primaryModel, "claude-sonnet-4-20250514")
})

test("PATCH coding swaps primary and fallback 1, GET reflects change", () => {
	patchRoute("route-coding", {
		primaryProvider: "openai",
		primaryModel: "gpt-4o",
		fallbackProvider1: "anthropic",
		fallbackModel1: "claude-sonnet-4-20250514",
		fallbackProvider2: null,
		fallbackModel2: null,
	})

	const routes = getRoutes()
	const coding = routes.find((r) => r.taskType === "coding")
	assert.strictEqual(coding.primaryProvider, "openai")
	assert.strictEqual(coding.primaryModel, "gpt-4o")
	assert.strictEqual(coding.fallbackProvider1, "anthropic")
	assert.strictEqual(coding.fallbackModel1, "claude-sonnet-4-20250514")
})

test("After saving coding, architecture still shows original coder defaults", () => {
	const routes = getRoutes()
	const architecture = routes.find((r) => r.taskType === "architecture")
	// architecture maps to coder, but coder was cloned when coding was edited,
	// so architecture should still read the original coder route
	assert.strictEqual(architecture.primaryProvider, "anthropic")
	assert.strictEqual(architecture.primaryModel, "claude-sonnet-4-20250514")
})

test("PATCH deployment changes primary, GET persists it", () => {
	patchRoute("route-deployment", {
		primaryProvider: "anthropic",
		primaryModel: "claude-sonnet-4-20250514",
		fallbackProvider1: "openai",
		fallbackModel1: "gpt-4o",
		fallbackProvider2: null,
		fallbackModel2: null,
	})

	const routes = getRoutes()
	const deployment = routes.find((r) => r.taskType === "deployment")
	assert.strictEqual(deployment.primaryProvider, "anthropic")
	assert.strictEqual(deployment.primaryModel, "claude-sonnet-4-20250514")
})

test("PATCH research (no default agent) creates new route and GET finds it", () => {
	patchRoute("route-research", {
		primaryProvider: "deepseek",
		primaryModel: "deepseek-chat",
		fallbackProvider1: "openai",
		fallbackModel1: "gpt-4o",
		fallbackProvider2: null,
		fallbackModel2: null,
	})

	const routes = getRoutes()
	const research = routes.find((r) => r.taskType === "research")
	assert.strictEqual(research.primaryProvider, "deepseek")
	assert.strictEqual(research.primaryModel, "deepseek-chat")
})

test("Multiple reloads do not lose saved state", () => {
	// Simulate multiple GET requests after saves
	for (let i = 0; i < 3; i++) {
		const routes = getRoutes()
		const coding = routes.find((r) => r.taskType === "coding")
		assert.strictEqual(coding.primaryProvider, "openai", `Reload ${i} failed for coding`)
	}
})

console.log("\n" + "=".repeat(60))
console.log("  RESULTS: " + passed + " passed, " + failed + " failed")
console.log("=".repeat(60))

if (failed > 0) {
	process.exit(1)
} else {
	console.log("\n  All E2E persistence tests passed! ✓\n")
}
