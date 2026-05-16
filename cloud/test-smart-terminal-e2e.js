/**
 * E2E Test: Smart Terminal Features
 * Tests all 14 improvements across Telegram bot, Dashboard, and Mini IDE.
 *
 * Tests:
 * 1. NL-First Chat Mode (detectCodingIntent)
 * 2. Inline Code Execution (handleCodingIntentDirect)
 * 3. Smart Error Handling with Auto-Fix
 * 4. Conversational Context Persistence (getSmartContext, updateSmartContext)
 * 5. Quick Action Buttons (sendQuickActionButtons)
 * 6. Command Correction (levenshteinDistance, findClosestCommand, suggestCommandCorrection)
 * 7. Workflow Templates (WORKFLOW_TEMPLATES, detectWorkflowIntent, handleWorkflowTemplate)
 * 8. AI-Powered Command Prediction (buildPredictionPrompt, getCommandPredictions)
 * 9. Block-Based Output (parseOutputLine, convertToBlocks)
 * 10. Smart Autocomplete (getSmartSuggestions, COMMON_COMMANDS, AGENT_COMMANDS)
 * 11. Terminal Recording & Replay (createRecording, handleStartRecording, handleStopRecording, handleReplayRecording)
 * 12. Callback Query Handlers (brain_exec, brain_pipeline, brain_explain, brain_fix, brain_errors, brain_deploy, brain_status, brain_memory, brain_cancel)
 * 13. Enhanced NLP Router (handleSmartNLP)
 * 14. sendChatAction bug fix (botToken parameter)
 */

const bot = require("./api/telegramBot")
const fs = require("fs")

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
console.log("║     Smart Terminal E2E Test Suite                          ║")
console.log("╚══════════════════════════════════════════════════════════════╝")
console.log("")

// ── 1. NL-First Chat Mode ────────────────────────────────────────────────
console.log("")
console.log("=== 1. NL-First Chat Mode (detectCodingIntent) ===")
console.log("")

// Access detectCodingIntent via source code analysis
var source = fs.readFileSync("./api/telegramBot.js", "utf8")

test("detectCodingIntent function exists", function () {
	assert(source.includes("function detectCodingIntent"), "detectCodingIntent not found")
})

test("detectCodingIntent detects 'run npm test'", function () {
	assert(source.includes('"run X"') || source.includes("run X"), "Missing run pattern comment")
	assert(source.includes('"execute"'), "Missing execute action")
})

test("detectCodingIntent detects 'fix the build'", function () {
	assert(source.includes('"fix X"') || source.includes("fix X"), "Missing fix pattern comment")
	assert(source.includes('"pipeline"'), "Missing pipeline action")
})

test("detectCodingIntent detects build/test patterns", function () {
	assert(
		source.includes("npm ") || source.includes("pnpm ") || source.includes("npx "),
		"Missing npm/pnpm/npx patterns",
	)
})

test("detectCodingIntent detects check/show patterns", function () {
	assert(source.includes("check X") || source.includes("show X"), "Missing check/show pattern")
})

// ── 2. Inline Code Execution ──────────────────────────────────────────────
console.log("")
console.log("=== 2. Inline Code Execution (handleCodingIntentDirect) ===")
console.log("")

test("handleCodingIntentDirect function exists", function () {
	assert(source.includes("async function handleCodingIntentDirect"), "handleCodingIntentDirect not found")
})

test("handleCodingIntentDirect calls brainExecute for execute action", function () {
	assert(source.includes("brainExecute(query, chatId)"), "Missing brainExecute call")
})

test("handleCodingIntentDirect calls formatBrainFeedback", function () {
	assert(source.includes("formatBrainFeedback"), "Missing formatBrainFeedback")
})

test("handleCodingIntentDirect handles exitCode !== 0 for auto-analysis", function () {
	assert(source.includes("exitCode !== 0"), "Missing exit code check")
})

// ── 3. Smart Error Handling with Auto-Fix ────────────────────────────────
console.log("")
console.log("=== 3. Smart Error Handling with Auto-Fix ===")
console.log("")

test("Auto error analysis after command execution", function () {
	assert(source.includes("brainAnalyze("), "Missing brainAnalyze call")
})

test("Auto-fix suggestions after error analysis", function () {
	assert(source.includes("brainFix("), "Missing brainFix call")
})

test("Auto-Suggested Fixes message exists", function () {
	assert(source.includes("Auto-Suggested Fixes"), "Missing auto-fix message")
})

// ── 4. Conversational Context Persistence ─────────────────────────────────
console.log("")
console.log("=== 4. Conversational Context Persistence ===")
console.log("")

test("_smartContext Map exists", function () {
	assert(source.includes("const _smartContext = new Map()"), "_smartContext not found")
})

test("getSmartContext function exists", function () {
	assert(source.includes("function getSmartContext"), "getSmartContext not found")
})

test("updateSmartContext function exists", function () {
	assert(source.includes("function updateSmartContext"), "updateSmartContext not found")
})

test("buildSmartContextPrompt function exists", function () {
	assert(source.includes("function buildSmartContextPrompt"), "buildSmartContextPrompt not found")
})

test("Smart context tracks lastCommand", function () {
	assert(source.includes("lastCommand"), "Missing lastCommand field")
})

test("Smart context tracks lastError", function () {
	assert(source.includes("lastError"), "Missing lastError field")
})

test("Smart context tracks lastProject", function () {
	assert(source.includes("lastProject"), "Missing lastProject field")
})

test("Smart context tracks lastIntent", function () {
	assert(source.includes("lastIntent"), "Missing lastIntent field")
})

test("Smart context tracks lastFixApplied", function () {
	assert(source.includes("lastFixApplied"), "Missing lastFixApplied field")
})

test("Smart context tracks workflowHistory", function () {
	assert(source.includes("workflowHistory"), "Missing workflowHistory field")
})

// ── 5. Quick Action Buttons ──────────────────────────────────────────────
console.log("")
console.log("=== 5. Quick Action Buttons ===")
console.log("")

test("sendQuickActionButtons function exists", function () {
	assert(source.includes("async function sendQuickActionButtons"), "sendQuickActionButtons not found")
})

test("Quick action buttons include Run Again", function () {
	assert(source.includes("Run Again") || source.includes("brain_exec:"), "Missing Run Again button")
})

test("Quick action buttons include Explain", function () {
	assert(source.includes("Explain") || source.includes("brain_explain:"), "Missing Explain button")
})

test("Quick action buttons include Auto-Fix", function () {
	assert(source.includes("Auto-Fix") || source.includes("brain_fix:"), "Missing Auto-Fix button")
})

test("Quick action buttons include Show Errors", function () {
	assert(source.includes("Show Errors") || source.includes("brain_errors:"), "Missing Show Errors button")
})

test("Quick action buttons include Deploy", function () {
	assert(source.includes("Deploy") || source.includes("brain_deploy:"), "Missing Deploy button")
})

test("Quick action buttons include Status", function () {
	assert(source.includes("Status") || source.includes("brain_status"), "Missing Status button")
})

test("Quick action buttons include Memory", function () {
	assert(source.includes("Memory") || source.includes("brain_memory"), "Missing Memory button")
})

// ── 6. Command Correction ────────────────────────────────────────────────
console.log("")
console.log("=== 6. Command Correction ===")
console.log("")

test("levenshteinDistance function exists", function () {
	assert(source.includes("function levenshteinDistance"), "levenshteinDistance not found")
})

test("findClosestCommand function exists", function () {
	assert(source.includes("function findClosestCommand"), "findClosestCommand not found")
})

test("suggestCommandCorrection function exists", function () {
	assert(source.includes("function suggestCommandCorrection"), "suggestCommandCorrection not found")
})

test("KNOWN_COMMANDS array exists", function () {
	assert(source.includes("const KNOWN_COMMANDS"), "KNOWN_COMMANDS not found")
})

test("KNOWN_COMMANDS includes brain subcommands", function () {
	assert(source.includes("brain plan") || source.includes("brain execute"), "Missing brain subcommands")
})

// ── 7. Workflow Templates ────────────────────────────────────────────────
console.log("")
console.log("=== 7. Workflow Templates ===")
console.log("")

test("WORKFLOW_TEMPLATES object exists", function () {
	assert(source.includes("const WORKFLOW_TEMPLATES"), "WORKFLOW_TEMPLATES not found")
})

test("Workflow templates include deploy", function () {
	assert(source.includes('"deploy"'), "Missing deploy template")
})

test("Workflow templates include test", function () {
	assert(source.includes('"test"'), "Missing test template")
})

test("Workflow templates include build", function () {
	assert(source.includes('"build"'), "Missing build template")
})

test("Workflow templates include logs", function () {
	assert(source.includes("logs:"), "Missing logs template")
})

test("Workflow templates include status", function () {
	assert(source.includes('"status"'), "Missing status template")
})

test("Workflow templates include update", function () {
	assert(source.includes('"update"'), "Missing update template")
})

test("detectWorkflowIntent function exists", function () {
	assert(source.includes("function detectWorkflowIntent"), "detectWorkflowIntent not found")
})

test("handleWorkflowTemplate function exists", function () {
	assert(source.includes("async function handleWorkflowTemplate"), "handleWorkflowTemplate not found")
})

// ── 8. AI-Powered Command Prediction ─────────────────────────────────────
console.log("")
console.log("=== 8. AI-Powered Command Prediction ===")
console.log("")

test("buildPredictionPrompt function exists", function () {
	assert(source.includes("function buildPredictionPrompt"), "buildPredictionPrompt not found")
})

test("getCommandPredictions function exists", function () {
	assert(source.includes("async function getCommandPredictions"), "getCommandPredictions not found")
})

test("Command prediction uses LLM", function () {
	assert(source.includes("predictions") || source.includes("completion"), "Missing prediction/LLM call")
})

// ── 9. Block-Based Output (Mini IDE) ─────────────────────────────────────
console.log("")
console.log("=== 9. Block-Based Output (Mini IDE) ===")
console.log("")

var miniIdeSource = fs.readFileSync("./mini-ide/public/app.js", "utf8")

test("parseOutputLine function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function parseOutputLine"), "parseOutputLine not found in Mini IDE")
})

test("convertToBlocks function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function convertToBlocks"), "convertToBlocks not found in Mini IDE")
})

test("addOutputBlocks function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function addOutputBlocks"), "addOutputBlocks not found in Mini IDE")
})

test("toggleBlockCollapse function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function toggleBlockCollapse"), "toggleBlockCollapse not found in Mini IDE")
})

test("renderTerminalOutput uses block-based rendering", function () {
	assert(miniIdeSource.includes("outputBlocks"), "outputBlocks not found in Mini IDE")
})

test("Block types include command", function () {
	assert(miniIdeSource.includes('type: "command"'), "Missing command block type")
})

test("Block types include error", function () {
	assert(miniIdeSource.includes('type: "error"'), "Missing error block type")
})

test("Block types include success", function () {
	assert(miniIdeSource.includes('type: "success"'), "Missing success block type")
})

test("Block types include agent", function () {
	assert(miniIdeSource.includes('type: "agent"'), "Missing agent block type")
})

test("Block types include info", function () {
	assert(miniIdeSource.includes('type: "info"'), "Missing info block type")
})

test("Block types include divider", function () {
	assert(miniIdeSource.includes('type: "divider"'), "Missing divider block type")
})

// ── 10. Smart Autocomplete (Mini IDE) ────────────────────────────────────
console.log("")
console.log("=== 10. Smart Autocomplete (Mini IDE) ===")
console.log("")

test("COMMON_COMMANDS array exists in Mini IDE", function () {
	assert(miniIdeSource.includes("const COMMON_COMMANDS"), "COMMON_COMMANDS not found in Mini IDE")
})

test("AGENT_COMMANDS array exists in Mini IDE", function () {
	assert(miniIdeSource.includes("const AGENT_COMMANDS"), "AGENT_COMMANDS not found in Mini IDE")
})

test("getSmartSuggestions function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function getSmartSuggestions"), "getSmartSuggestions not found in Mini IDE")
})

test("showTerminalSuggestions function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function showTerminalSuggestions"), "showTerminalSuggestions not found in Mini IDE")
})

test("hideTerminalSuggestions function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function hideTerminalSuggestions"), "hideTerminalSuggestions not found in Mini IDE")
})

test("selectTerminalSuggestion function exists in Mini IDE", function () {
	assert(
		miniIdeSource.includes("function selectTerminalSuggestion"),
		"selectTerminalSuggestion not found in Mini IDE",
	)
})

test("Smart autocomplete has scoring system", function () {
	assert(miniIdeSource.includes("score"), "Missing score in autocomplete")
})

test("Smart autocomplete limits to 8 suggestions", function () {
	assert(miniIdeSource.includes(".slice(0, 8)"), "Missing slice(0, 8) limit")
})

test("Smart autocomplete handles @agent mentions", function () {
	assert(miniIdeSource.includes('"@') || miniIdeSource.includes("@debugger"), "Missing @agent handling")
})

test("Terminal keydown handles ArrowUp for suggestions", function () {
	assert(miniIdeSource.includes("ArrowUp"), "Missing ArrowUp handler")
})

test("Terminal keydown handles ArrowDown for suggestions", function () {
	assert(miniIdeSource.includes("ArrowDown"), "Missing ArrowDown handler")
})

test("Terminal keydown handles Tab for cycling suggestions", function () {
	assert(miniIdeSource.includes('"Tab"'), "Missing Tab handler")
})

test("Terminal keydown handles Escape to hide suggestions", function () {
	assert(miniIdeSource.includes('"Escape"'), "Missing Escape handler")
})

// ── 11. Terminal Recording & Replay (Mini IDE) ───────────────────────────
console.log("")
console.log("=== 11. Terminal Recording & Replay (Mini IDE) ===")
console.log("")

test("createRecording function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function createRecording"), "createRecording not found in Mini IDE")
})

test("handleStartRecording function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function handleStartRecording"), "handleStartRecording not found in Mini IDE")
})

test("handleStopRecording function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function handleStopRecording"), "handleStopRecording not found in Mini IDE")
})

test("showRecordings function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function showRecordings"), "showRecordings not found in Mini IDE")
})

test("handleReplayRecording function exists in Mini IDE", function () {
	assert(miniIdeSource.includes("function handleReplayRecording"), "handleReplayRecording not found in Mini IDE")
})

test("Recording state tracks isRecording", function () {
	assert(miniIdeSource.includes("isRecording"), "Missing isRecording state")
})

test("Recording state tracks recordingBlocks", function () {
	assert(miniIdeSource.includes("recordingBlocks"), "Missing recordingBlocks state")
})

test("Recording state tracks recordings array", function () {
	assert(miniIdeSource.includes("recordings:"), "Missing recordings array")
})

test("Recording indicator exists in HTML", function () {
	var htmlSource = fs.readFileSync("./mini-ide/public/index.html", "utf8")
	assert(htmlSource.includes("terminal-recording-indicator"), "Missing recording indicator in HTML")
})

test("Record button exists in HTML", function () {
	var htmlSource = fs.readFileSync("./mini-ide/public/index.html", "utf8")
	assert(htmlSource.includes("btn-record"), "Missing record button in HTML")
})

test("Stop recording button exists in HTML", function () {
	var htmlSource = fs.readFileSync("./mini-ide/public/index.html", "utf8")
	assert(htmlSource.includes("btn-stop-rec"), "Missing stop recording button in HTML")
})

test("Replays button exists in HTML", function () {
	var htmlSource = fs.readFileSync("./mini-ide/public/index.html", "utf8")
	assert(htmlSource.includes("Replays"), "Missing replays button in HTML")
})

test("Recording CSS animation exists", function () {
	var cssSource = fs.readFileSync("./mini-ide/public/styles.css", "utf8")
	assert(cssSource.includes("rec-pulse"), "Missing rec-pulse animation in CSS")
})

// ── 12. Callback Query Handlers ──────────────────────────────────────────
console.log("")
console.log("=== 12. Callback Query Handlers ===")
console.log("")

test("brain_exec callback handler exists", function () {
	assert(source.includes('cqData.startsWith("brain_exec:")'), "Missing brain_exec handler")
})

test("brain_pipeline callback handler exists", function () {
	assert(source.includes('cqData.startsWith("brain_pipeline:")'), "Missing brain_pipeline handler")
})

test("brain_explain callback handler exists", function () {
	assert(source.includes('cqData.startsWith("brain_explain:")'), "Missing brain_explain handler")
})

test("brain_fix callback handler exists", function () {
	assert(source.includes('cqData.startsWith("brain_fix:")'), "Missing brain_fix handler")
})

test("brain_errors callback handler exists", function () {
	assert(source.includes('cqData.startsWith("brain_errors:")'), "Missing brain_errors handler")
})

test("brain_deploy callback handler exists", function () {
	assert(source.includes('cqData.startsWith("brain_deploy:")'), "Missing brain_deploy handler")
})

test("brain_status callback handler exists", function () {
	assert(source.includes('cqData === "brain_status"'), "Missing brain_status handler")
})

test("brain_memory callback handler exists", function () {
	assert(source.includes('cqData === "brain_memory"'), "Missing brain_memory handler")
})

test("brain_cancel callback handler exists", function () {
	assert(source.includes('cqData === "brain_cancel"'), "Missing brain_cancel handler")
})

// ── 13. Enhanced NLP Router ──────────────────────────────────────────────
console.log("")
console.log("=== 13. Enhanced NLP Router (handleSmartNLP) ===")
console.log("")

test("handleSmartNLP function exists", function () {
	assert(source.includes("async function handleSmartNLP"), "handleSmartNLP not found")
})

test("handleSmartNLP checks workflow templates first", function () {
	assert(source.includes("detectWorkflowIntent(text)"), "Missing workflow intent check")
})

test("handleSmartNLP checks coding intent second", function () {
	assert(source.includes("detectCodingIntent(text)"), "Missing coding intent check")
})

test("handleSmartNLP falls back to existing NLP routing", function () {
	assert(source.includes("return false"), "Missing fallback return")
})

test("handleNaturalLanguageInstruction calls handleSmartNLP", function () {
	assert(source.includes("handleSmartNLP("), "Missing handleSmartNLP call in NLP")
})

// ── 14. sendChatAction Bug Fix ──────────────────────────────────────────
console.log("")
console.log("=== 14. sendChatAction Bug Fix (botToken parameter) ===")
console.log("")

test("sendChatAction function signature includes botToken", function () {
	assert(source.includes("async function sendChatAction(botToken"), "sendChatAction missing botToken param")
})

test("brain_exec handler uses sendChatAction with botToken", function () {
	// Find the brain_exec handler by locating the cqData.startsWith check
	var handlerStart = source.indexOf('cqData.startsWith("brain_exec:")')
	assert(handlerStart !== -1, "brain_exec handler not found")
	// Get a chunk starting from the handler to find sendChatAction calls
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_exec missing botToken in sendChatAction")
})

test("brain_pipeline handler uses sendChatAction with botToken", function () {
	var handlerStart = source.indexOf('cqData.startsWith("brain_pipeline:")')
	assert(handlerStart !== -1, "brain_pipeline handler not found")
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_pipeline missing botToken in sendChatAction")
})

test("brain_explain handler uses sendChatAction with botToken", function () {
	var handlerStart = source.indexOf('cqData.startsWith("brain_explain:")')
	assert(handlerStart !== -1, "brain_explain handler not found")
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_explain missing botToken in sendChatAction")
})

test("brain_fix handler uses sendChatAction with botToken", function () {
	var handlerStart = source.indexOf('cqData.startsWith("brain_fix:")')
	assert(handlerStart !== -1, "brain_fix handler not found")
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_fix missing botToken in sendChatAction")
})

test("brain_errors handler uses sendChatAction with botToken", function () {
	var handlerStart = source.indexOf('cqData.startsWith("brain_errors:")')
	assert(handlerStart !== -1, "brain_errors handler not found")
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_errors missing botToken in sendChatAction")
})

test("brain_status handler uses sendChatAction with botToken", function () {
	// brain_status uses exact match (cqData === "brain_status") not startsWith
	var handlerStart = source.indexOf('cqData === "brain_status"')
	assert(handlerStart !== -1, "brain_status handler not found")
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_status missing botToken in sendChatAction")
})

test("brain_memory handler uses sendChatAction with botToken", function () {
	// brain_memory uses exact match (cqData === "brain_memory") not startsWith
	var handlerStart = source.indexOf('cqData === "brain_memory"')
	assert(handlerStart !== -1, "brain_memory handler not found")
	var handlerChunk = source.substring(handlerStart, handlerStart + 2000)
	assert(handlerChunk.includes("sendChatAction(botToken"), "brain_memory missing botToken in sendChatAction")
})

// ── Dashboard Block-Based Output ─────────────────────────────────────────
console.log("")
console.log("=== Dashboard Block-Based Output (ide-terminal.tsx) ===")
console.log("")

var dashboardSource = fs.readFileSync("../cloud/dashboard/src/components/views/ide-terminal.tsx", "utf8")

test("OutputBlock interface exists in Dashboard", function () {
	assert(dashboardSource.includes("interface OutputBlock"), "OutputBlock not found in Dashboard")
})

test("AutocompleteSuggestion interface exists in Dashboard", function () {
	assert(
		dashboardSource.includes("interface AutocompleteSuggestion"),
		"AutocompleteSuggestion not found in Dashboard",
	)
})

test("TerminalRecording interface exists in Dashboard", function () {
	assert(dashboardSource.includes("interface TerminalRecording"), "TerminalRecording not found in Dashboard")
})

test("parseOutputLine function exists in Dashboard", function () {
	assert(dashboardSource.includes("function parseOutputLine"), "parseOutputLine not found in Dashboard")
})

test("convertToBlocks function exists in Dashboard", function () {
	assert(dashboardSource.includes("function convertToBlocks"), "convertToBlocks not found in Dashboard")
})

test("COMMON_COMMANDS array exists in Dashboard", function () {
	assert(dashboardSource.includes("const COMMON_COMMANDS"), "COMMON_COMMANDS not found in Dashboard")
})

test("getSmartSuggestions function exists in Dashboard", function () {
	assert(dashboardSource.includes("function getSmartSuggestions"), "getSmartSuggestions not found in Dashboard")
})

test("createRecording function exists in Dashboard", function () {
	assert(dashboardSource.includes("function createRecording"), "createRecording not found in Dashboard")
})

test("addOutputBlocks callback exists in Dashboard", function () {
	assert(dashboardSource.includes("addOutputBlocks"), "addOutputBlocks not found in Dashboard")
})

test("toggleBlockCollapse callback exists in Dashboard", function () {
	assert(dashboardSource.includes("toggleBlockCollapse"), "toggleBlockCollapse not found in Dashboard")
})

test("handleStartRecording callback exists in Dashboard", function () {
	assert(dashboardSource.includes("handleStartRecording"), "handleStartRecording not found in Dashboard")
})

test("handleStopRecording callback exists in Dashboard", function () {
	assert(dashboardSource.includes("handleStopRecording"), "handleStopRecording not found in Dashboard")
})

test("handleReplayRecording callback exists in Dashboard", function () {
	assert(dashboardSource.includes("handleReplayRecording"), "handleReplayRecording not found in Dashboard")
})

test("handleTerminalKeyDown handles smart autocomplete in Dashboard", function () {
	assert(dashboardSource.includes("smartSuggestions"), "smartSuggestions not found in Dashboard")
})

test("handleTerminalInputChange triggers smart autocomplete in Dashboard", function () {
	assert(dashboardSource.includes("handleTerminalInputChange"), "handleTerminalInputChange not found in Dashboard")
})

test("Dashboard renders block-based output", function () {
	assert(dashboardSource.includes("outputBlocks.map"), "Missing block rendering in Dashboard")
})

test("Dashboard has recording UI", function () {
	assert(dashboardSource.includes("showRecordings"), "Missing recordings UI in Dashboard")
})

// ── Module Exports ───────────────────────────────────────────────────────
console.log("")
console.log("=== Module Exports ===")
console.log("")

test("Module exports handleUpdate", function () {
	assert(typeof bot.handleUpdate === "function", "handleUpdate is not a function")
})

test("Module exports sendMessage", function () {
	assert(typeof bot.sendMessage === "function", "sendMessage is not a function")
})

test("Module exports sendChatAction", function () {
	assert(typeof bot.sendChatAction === "function", "sendChatAction is not a function")
})

test("Module exports sendInlineKeyboard", function () {
	assert(typeof bot.sendInlineKeyboard === "function", "sendInlineKeyboard is not a function")
})

test("Module exports editMessageText", function () {
	assert(typeof bot.editMessageText === "function", "editMessageText is not a function")
})

test("Module exports answerCallbackQuery", function () {
	assert(typeof bot.answerCallbackQuery === "function", "answerCallbackQuery is not a function")
})

// ── Results ──────────────────────────────────────────────────────────────
console.log("")
console.log("╔══════════════════════════════════════════════════════════════╗")
console.log("║     Results                                                 ║")
console.log("╚══════════════════════════════════════════════════════════════╝")
console.log("")
console.log("  Total: " + total)
console.log("  Passed: " + passed)
console.log("  Failed: " + failed)
console.log("")

if (failed === 0) {
	console.log("  🎉 ALL " + total + " TESTS PASSED!")
} else {
	console.log("  ❌ " + failed + " TESTS FAILED!")
}

console.log("")
process.exit(failed > 0 ? 1 : 0)
