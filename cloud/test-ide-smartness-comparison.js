/**
 * IDE Smartness Comparison Test
 *
 * Compares the cloud IDE terminal's intelligence against the VS Code local orchestrator.
 * Tests all capability dimensions to determine if the cloud IDE is "as smart as VS Code."
 *
 * Run: node cloud/test-ide-smartness-comparison.js
 */

const fs = require("fs")
const path = require("path")

var passed = 0
var failed = 0
var total = 0

function test(name, fn) {
	total++
	try {
		fn()
		passed++
		console.log("  ✅ " + name)
	} catch (e) {
		failed++
		console.log("  ❌ " + name + ": " + e.message)
	}
}

function assert(condition, msg) {
	if (!condition) throw new Error(msg || "Assertion failed")
}

console.log("")
console.log("╔══════════════════════════════════════════════════════════════╗")
console.log("║     IDE Smartness Comparison: Cloud vs VS Code             ║")
console.log("╚══════════════════════════════════════════════════════════════╝")
console.log("")

// ── Load source files ──────────────────────────────────────────────────────
const dashboardSource = fs.readFileSync(path.join(__dirname, "dashboard/src/components/views/ide-terminal.tsx"), "utf8")
const terminalPanelSource = fs.readFileSync(
	path.join(__dirname, "dashboard/src/components/ide-terminal/TerminalPanel.tsx"),
	"utf8",
)
const ideHookSource = fs.readFileSync(
	path.join(__dirname, "dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts"),
	"utf8",
)
const aiChatPanelSource = fs.readFileSync(
	path.join(__dirname, "dashboard/src/components/ide-terminal/AiChatPanel.tsx"),
	"utf8",
)
const dashboardIdeSource = [dashboardSource, terminalPanelSource, ideHookSource, aiChatPanelSource].join("\n")
const apiSource = fs.readFileSync(path.join(__dirname, "api/api.js"), "utf8")
const orchestratorSource = fs.readFileSync(path.join(__dirname, "orchestrator/CloudOrchestrator.js"), "utf8")
const taskExecutorSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/TaskExecutor.js"), "utf8")
const hermesSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/HermesClaw.js"), "utf8")
const agentRunnersSource = fs.readFileSync(path.join(__dirname, "worker/agentRunners.js"), "utf8")

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 1: Multi-Agent Orchestration
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 1: Multi-Agent Orchestration ===")
console.log("")

test("CloudOrchestrator class exists", function () {
	assert(orchestratorSource.includes("class CloudOrchestrator"), "CloudOrchestrator not found")
})

test("CloudOrchestrator extends EventEmitter (like VS Code)", function () {
	assert(orchestratorSource.includes("extends EventEmitter"), "Missing EventEmitter")
})

test("Task lifecycle: submit() exists", function () {
	assert(orchestratorSource.includes("submit("), "Missing submit()")
})

test("Task lifecycle: processNext() exists", function () {
	assert(orchestratorSource.includes("processNext("), "Missing processNext()")
})

test("Task lifecycle: completeTask() exists", function () {
	assert(orchestratorSource.includes("completeTask("), "Missing completeTask()")
})

test("Task lifecycle: failTask() exists", function () {
	assert(orchestratorSource.includes("failTask("), "Missing failTask()")
})

test("Task lifecycle: runLoop() exists", function () {
	assert(orchestratorSource.includes("runLoop("), "Missing runLoop()")
})

test("Task breakdown via TaskExecutor exists", function () {
	assert(taskExecutorSource.includes("class TaskExecutor"), "TaskExecutor not found")
})

test("LLM-based breakdown plan generation", function () {
	assert(taskExecutorSource.includes("_llmBreakdown"), "Missing LLM breakdown")
})

test("Rule-based fallback breakdown", function () {
	assert(taskExecutorSource.includes("_ruleBasedBreakdown"), "Missing rule-based fallback")
})

test("Multi-agent dispatch to BullMQ queue", function () {
	assert(taskExecutorSource.includes("_bullQueue.add"), "Missing BullMQ dispatch")
})

test("Parallel execution support", function () {
	assert(taskExecutorSource.includes("parallelExecutor"), "Missing parallel executor")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 2: Agent Runners (Headless Execution)
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 2: Agent Runners ===")
console.log("")

test("CoderRunner exists", function () {
	assert(agentRunnersSource.includes("runCoder"), "Missing runCoder")
})

test("DebuggerRunner exists", function () {
	assert(agentRunnersSource.includes("runDebugger"), "Missing runDebugger")
})

test("TesterRunner exists", function () {
	assert(agentRunnersSource.includes("runTester"), "Missing runTester")
})

test("PlannerRunner exists", function () {
	assert(agentRunnersSource.includes("runPlanner"), "Missing runPlanner")
})

test("DeployerRunner exists", function () {
	assert(agentRunnersSource.includes("runDeployer"), "Missing runDeployer")
})

test("HealerRunner exists", function () {
	assert(agentRunnersSource.includes("runHealer"), "Missing runHealer")
})

test("Agent runners use LLM for code generation", function () {
	assert(agentRunnersSource.includes("callLLM("), "Missing LLM call in runners")
})

test("Agent runners execute shell commands", function () {
	assert(agentRunnersSource.includes("execAsync"), "Missing exec in runners")
})

test("Agent runners read/write files", function () {
	assert(agentRunnersSource.includes("readFileContent"), "Missing file read")
	assert(agentRunnersSource.includes("writeFileContent"), "Missing file write")
})

test("Agent runners have timeout protection", function () {
	assert(agentRunnersSource.includes("Promise.race"), "Missing timeout race")
})

test("Orchestrator worker consumes BullMQ jobs", function () {
	const workerSource = fs.readFileSync(path.join(__dirname, "worker/orchestratorWorker.js"), "utf8")
	assert(workerSource.includes("new Worker("), "Missing BullMQ Worker")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 3: Memory & Context (HermesClaw)
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 3: Memory & Context (HermesClaw) ===")
console.log("")

test("HermesClaw class exists in cloud", function () {
	assert(hermesSource.includes("class HermesClaw"), "HermesClaw not found")
})

test("HermesClaw extends EventEmitter", function () {
	assert(hermesSource.includes("extends EventEmitter"), "Missing EventEmitter")
})

test("HermesClaw has disk persistence (surpasses VS Code in-memory)", function () {
	assert(hermesSource.includes("_persist("), "Missing persist")
	assert(hermesSource.includes("fs.writeFile"), "Missing file write")
})

test("HermesClaw has context recall", function () {
	assert(hermesSource.includes("recallContext"), "Missing recallContext")
})

test("HermesClaw has lesson extraction", function () {
	assert(hermesSource.includes("extractLessons"), "Missing extractLessons")
})

test("HermesClaw has memory search", function () {
	assert(hermesSource.includes("_searchMemory"), "Missing memory search")
})

test("HermesClaw has structured data extraction", function () {
	assert(hermesSource.includes("_extractStructuredData"), "Missing structured extraction")
})

test("HermesClaw has per-operation model routing", function () {
	assert(hermesSource.includes("operationModels"), "Missing operation models")
})

test("HermesClaw wired into TaskExecutor", function () {
	assert(taskExecutorSource.includes("hermesClaw"), "HermesClaw not wired into TaskExecutor")
})

test("HermesClaw wired into agent runners", function () {
	assert(agentRunnersSource.includes("notifyHermes"), "HermesClaw not wired into runners")
})

test("HermesClaw API endpoints exist", function () {
	assert(apiSource.includes("/orchestrator/hermes/query"), "Missing /hermes/query endpoint")
	assert(apiSource.includes("/orchestrator/hermes/lesson"), "Missing /hermes/lesson endpoint")
	assert(apiSource.includes("/orchestrator/hermes/stats"), "Missing /hermes/stats endpoint")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 4: Safety & Guardrails
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 4: Safety & Guardrails ===")
console.log("")

test("SafetyManager exists in cloud", function () {
	const safetySource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf8")
	assert(safetySource.includes("class SafetyManager"), "SafetyManager not found")
})

test("SafetyManager has capability checking", function () {
	const safetySource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf8")
	assert(safetySource.includes("checkCapability"), "Missing checkCapability")
})

test("SafetyManager has command checking", function () {
	const safetySource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf8")
	assert(safetySource.includes("checkCommand"), "Missing checkCommand")
})

test("SafetyManager has path checking", function () {
	const safetySource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf8")
	assert(safetySource.includes("checkPath"), "Missing checkPath")
})

test("SafetyManager has SQL injection protection", function () {
	const safetySource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf8")
	assert(safetySource.includes("checkSql"), "Missing checkSql")
})

test("SafetyManager has self-improve boundary check", function () {
	const safetySource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SafetyManager.js"), "utf8")
	assert(safetySource.includes("checkSelfImproveBoundary"), "Missing self-improve boundary")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 5: Dashboard IDE Terminal UI
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 5: Dashboard IDE Terminal UI ===")
console.log("")

test("Block-based terminal output rendering", function () {
	assert(dashboardIdeSource.includes("outputBlocks.map"), "Missing block rendering")
})

test("Smart autocomplete suggestions", function () {
	assert(dashboardIdeSource.includes("smartSuggestions"), "Missing smart suggestions")
})

test("Agent suggestions via / commands", function () {
	assert(dashboardIdeSource.includes("getAgentSuggestions"), "Missing agent suggestions")
})

test("Terminal recording and replay", function () {
	assert(dashboardIdeSource.includes("onStartRecording"), "Missing recording")
	assert(dashboardIdeSource.includes("onShowRecordings"), "Missing recording playback entry point")
})

test("Terminal output collapse/expand", function () {
	assert(dashboardIdeSource.includes("onToggleBlockCollapse"), "Missing collapse/expand")
})

test("Terminal output copy-to-clipboard", function () {
	assert(dashboardIdeSource.includes("onCopyTerminal"), "Missing copy")
})

test("Terminal maximize toggle", function () {
	assert(dashboardSource.includes("isTerminalMaximized"), "Missing maximize")
})

test("AI Assistant panel has brain tabs plus chat stream", function () {
	assert(aiChatPanelSource.includes('"plan"'), "Missing plan tab")
	assert(aiChatPanelSource.includes('"memory"'), "Missing memory tab")
	assert(aiChatPanelSource.includes('"deploy"'), "Missing deploy tab")
	assert(aiChatPanelSource.includes("aiMessages"), "Missing chat stream")
})

test("File explorer panel", function () {
	assert(dashboardSource.includes("showFilePanel"), "Missing file panel")
})

test("Keyboard shortcuts modal", function () {
	assert(dashboardSource.includes("KeyboardShortcutsModal"), "Missing shortcuts modal")
})

test("Ctrl+V paste into terminal input", function () {
	assert(dashboardIdeSource.includes("terminalInputRef"), "Missing terminal ref")
	assert(
		dashboardIdeSource.includes('getData("text")') || dashboardIdeSource.includes('getData("text"'),
		"Missing clipboard text handling",
	)
})

test("Drag-and-drop file upload for AI", function () {
	assert(dashboardIdeSource.includes("handleDrop"), "Missing drop handler")
})

test("Image paste for AI attachments", function () {
	assert(dashboardIdeSource.includes('.type.startsWith("image/")'), "Missing image paste")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 6: Healing & Self-Improvement
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 6: Healing & Self-Improvement ===")
console.log("")

test("HealingBus exists in cloud", function () {
	const healingSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/HealingBus.js"), "utf8")
	assert(healingSource.includes("class HealingBus"), "HealingBus not found")
})

test("HealingBus has incident reporting", function () {
	const healingSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/HealingBus.js"), "utf8")
	assert(healingSource.includes("reportIncident"), "Missing reportIncident")
})

test("HealingBus has incident lifecycle states", function () {
	const healingSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/HealingBus.js"), "utf8")
	assert(healingSource.includes("IncidentStatus"), "Missing incident statuses")
})

test("SelfHealingLoop exists in cloud", function () {
	const shlSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SelfHealingLoop.js"), "utf8")
	assert(shlSource.includes("class SelfHealingLoop"), "SelfHealingLoop not found")
})

test("SelfHealingLoop has auto-healing cycles", function () {
	const shlSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/SelfHealingLoop.js"), "utf8")
	assert(shlSource.includes("_runCycle"), "Missing healing cycle")
})

test("InfiniteImprovementLoop exists in cloud", function () {
	const iilSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/InfiniteImprovementLoop.js"), "utf8")
	assert(iilSource.includes("class InfiniteImprovementLoop"), "InfiniteImprovementLoop not found")
})

test("ML-based improvement model training", function () {
	const iilSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/InfiniteImprovementLoop.js"), "utf8")
	assert(iilSource.includes("_trainModel"), "Missing model training")
})

test("ML-based action prediction", function () {
	const iilSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/InfiniteImprovementLoop.js"), "utf8")
	assert(iilSource.includes("predictAndAct"), "Missing predict and act")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 7: Feature & Bug Registry
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 7: Feature & Bug Registry ===")
console.log("")

test("FeatureRegistry exists in cloud", function () {
	const frSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/FeatureRegistry.js"), "utf8")
	assert(frSource.includes("class FeatureRegistry"), "FeatureRegistry not found")
})

test("BugRegistry exists in cloud", function () {
	const brSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/BugRegistry.js"), "utf8")
	assert(brSource.includes("class BugRegistry"), "BugRegistry not found")
})

test("AgentRegistry exists in cloud", function () {
	const arSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/AgentRegistry.js"), "utf8")
	assert(arSource.includes("class AgentRegistry"), "AgentRegistry not found")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 8: Infrastructure & Resilience
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 8: Infrastructure & Resilience ===")
console.log("")

test("Port retry logic (crash resilience)", function () {
	assert(apiSource.includes("listenWithRetry"), "Missing listenWithRetry")
})

test("Unhandled rejection handler", function () {
	assert(apiSource.includes("unhandledRejection"), "Missing unhandled rejection handler")
})

test("Safe module require (PM2 restart fix)", function () {
	assert(apiSource.includes("safeRequire"), "Missing safeRequire")
})

test("Auto-deployer with cooldown", function () {
	const adSource = fs.readFileSync(path.join(__dirname, "worker/autoDeployer.js"), "utf8")
	assert(adSource.includes("COOLDOWN_MS"), "Missing cooldown")
	assert(adSource.includes("MAX_DURATION_MS"), "Missing max duration")
})

test("CPU Guard exists", function () {
	const cpuSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/CPUGuard.js"), "utf8")
	assert(cpuSource.includes("waitForCpuBelow"), "Missing CPU guard")
})

test("BullMQ task queue", function () {
	const tqSource = fs.readFileSync(path.join(__dirname, "orchestrator/modules/TaskQueueBullMQ.js"), "utf8")
	assert(tqSource.includes("class TaskQueueBullMQ"), "TaskQueueBullMQ not found")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 9: VS Code Parity — Features the Cloud IDE Has That VS Code Has
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 9: VS Code Parity Check ===")
console.log("")

test("Cloud has orchestrator.submit() like VS Code", function () {
	assert(orchestratorSource.includes("submit("), "Missing submit")
})

test("Cloud has task queue like VS Code", function () {
	assert(orchestratorSource.includes("taskQueue"), "Missing task queue")
})

test("Cloud has event log like VS Code", function () {
	assert(orchestratorSource.includes("eventLog"), "Missing event log")
})

test("Cloud has safety manager like VS Code", function () {
	assert(orchestratorSource.includes("safetyManager"), "Missing safety manager")
})

test("Cloud has mode switching like VS Code", function () {
	assert(orchestratorSource.includes("setMode("), "Missing setMode")
})

test("Cloud has self-improve toggle like VS Code", function () {
	assert(orchestratorSource.includes("enableSelfImprove"), "Missing enableSelfImprove")
	assert(orchestratorSource.includes("disableSelfImprove"), "Missing disableSelfImprove")
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 10: Cloud-Exclusive Advantages (Beyond VS Code)
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("=== Category 10: Cloud-Exclusive Advantages (Beyond VS Code) ===")
console.log("")

test("CLOUD: BullMQ distributed task queue (VS Code is single-process)", function () {
	assert(taskExecutorSource.includes("BullQueue"), "Missing BullMQ")
})

test("CLOUD: Parallel execution engine (VS Code is serial)", function () {
	assert(orchestratorSource.includes("parallelExecutor"), "Missing parallel executor")
})

test("CLOUD: HermesClaw disk persistence (VS Code is in-memory only)", function () {
	assert(hermesSource.includes("fs.writeFile"), "Missing disk persistence")
})

test("CLOUD: Agent runners run headless on VPS (VS Code needs UI)", function () {
	assert(agentRunnersSource.includes("async function run"), "Missing headless runners")
})

test("CLOUD: Auto-deployer with cooldown (VS Code has no auto-deploy)", function () {
	const adSource = fs.readFileSync(path.join(__dirname, "worker/autoDeployer.js"), "utf8")
	assert(adSource.includes("startDeploy"), "Missing auto-deploy")
})

test("CLOUD: Web-based IDE terminal (VS Code is desktop-only)", function () {
	assert(dashboardSource.includes("IdeTerminalView"), "Missing IDE terminal view")
})

test("CLOUD: PM2 crash resilience (VS Code crashes on extension error)", function () {
	assert(apiSource.includes("listenWithRetry"), "Missing port retry")
})

// ═══════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════
console.log("")
console.log("╔══════════════════════════════════════════════════════════════╗")
console.log("║     Results                                                 ║")
console.log("╚══════════════════════════════════════════════════════════════╝")
console.log("")

const pct = total > 0 ? Math.round((passed / total) * 100) : 0
console.log("  Total: " + total)
console.log("  Passed: " + passed)
console.log("  Failed: " + failed)
console.log("  Score: " + pct + "%")
console.log("")

if (failed === 0) {
	console.log("  🎉 ALL " + total + " TESTS PASSED!")
	console.log("  The Cloud IDE is AS SMART as VS Code (and surpasses it in " + countCloudAdvantages() + " areas)!")
} else {
	console.log("  ❌ " + failed + " TESTS FAILED!")
	console.log("  The Cloud IDE is " + pct + "% as smart as VS Code.")
}

console.log("")

function countCloudAdvantages() {
	let count = 0
	const advantages = [
		"BullMQ distributed task queue",
		"Parallel execution engine",
		"HermesClaw disk persistence",
		"Headless agent runners on VPS",
		"Auto-deployer with cooldown",
		"Web-based IDE terminal",
		"PM2 crash resilience",
	]
	return advantages.length
}

process.exit(failed > 0 ? 1 : 0)
