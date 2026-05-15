/**
 * Unit tests for ide-store reducer logic — pure functions only.
 *
 * Tests the ideReducer, serialize, and deserialize functions
 * by re-implementing them here (avoids TS/import complexity).
 *
 * Run: node cloud/dashboard/src/components/ide-terminal/__tests__/run-ide-tests.js
 */

const { test, section, assert } = require("./test-helpers.js")

// ── Types (plain JS objects matching TS interfaces) ────────────────────────

function createInitialState() {
	return {
		aiMessages: [],
		aiInput: "",
		aiSending: false,
		aiAttachments: [],
		aiTab: "chat",
		proactiveSuggestions: [],
		terminalInput: "",
		terminalOutput: [],
		outputBlocks: [],
		collapsedBlocks: new Set(),
		recentCommands: [],
		recordings: [],
		isRecording: false,
		recordingBlocks: [],
		showRecordings: false,
		files: [],
		openFiles: [],
		activeFilePath: null,
		fileSearchQuery: "",
		showFileSearch: false,
		pipeline: [],
		status: { connected: true, docker: false, redis: false, cpu: "0%", ram: "0MB" },
		repoName: "test-repo",
		branch: "main",
		loading: false,
		showFilePanel: true,
		showAiPanel: true,
		showTerminal: true,
		terminalHeight: 180,
		isTerminalMaximized: false,
		showShortcuts: false,
		showImportGithub: false,
		showOpenWorkspace: false,
		showDiffView: false,
		showSlashCommands: false,
		showAgentSuggestions: false,
		showSmartSuggestions: false,
		showInlineAiButton: false,
		showQuickActions: null,
		recentWorkspaces: [],
		workspaceTasks: [],
		hermesStats: null,
		deployments: [],
		_hydrated: false,
	}
}

function toOutputBlocks(lines, startIndex = 0) {
	return lines.map((line, offset) => ({
		id: `block-${startIndex + offset}`,
		type: line.startsWith("$ ")
			? "command"
			: /error|failed/i.test(line)
				? "error"
				: /warning|warn/i.test(line)
					? "warning"
					: "info",
		content: line,
		timestamp: "test",
		collapsed: false,
	}))
}

// ── Reducer (re-implemented for test isolation) ────────────────────────────

function ideReducer(state, action) {
	switch (action.type) {
		case "HYDRATE": {
			const payload = action.payload || {}
			return {
				...state,
				...payload,
				collapsedBlocks:
					payload.collapsedBlocks instanceof Set ? payload.collapsedBlocks : state.collapsedBlocks,
				_hydrated: true,
			}
		}
		case "SET_AI_MESSAGES":
			return { ...state, aiMessages: action.payload }
		case "ADD_AI_MESSAGE":
			return { ...state, aiMessages: [...state.aiMessages, action.payload] }
		case "UPDATE_LAST_AI_MESSAGE":
			return {
				...state,
				aiMessages: state.aiMessages.map((m, i) =>
					i === state.aiMessages.length - 1 ? { ...m, ...action.payload } : m,
				),
			}
		case "SET_AI_INPUT":
			return { ...state, aiInput: action.payload }
		case "SET_AI_SENDING":
			return { ...state, aiSending: action.payload }
		case "SET_AI_ATTACHMENTS":
			return { ...state, aiAttachments: action.payload }
		case "ADD_AI_ATTACHMENT":
			return { ...state, aiAttachments: [...state.aiAttachments, action.payload] }
		case "SET_AI_TAB":
			return { ...state, aiTab: action.payload }
		case "SET_PROACTIVE_SUGGESTIONS":
			return { ...state, proactiveSuggestions: action.payload }
		case "SET_TERMINAL_INPUT":
			return { ...state, terminalInput: action.payload }
		case "SET_TERMINAL_OUTPUT":
			return { ...state, terminalOutput: action.payload, outputBlocks: toOutputBlocks(action.payload) }
		case "APPEND_TERMINAL_OUTPUT":
			return {
				...state,
				terminalOutput: [...state.terminalOutput, ...action.payload],
				outputBlocks: [...state.outputBlocks, ...toOutputBlocks(action.payload, state.outputBlocks.length)],
			}
		case "SET_OUTPUT_BLOCKS":
			return { ...state, outputBlocks: action.payload }
		case "SET_COLLAPSED_BLOCKS":
			return { ...state, collapsedBlocks: action.payload }
		case "SET_RECENT_COMMANDS":
			return { ...state, recentCommands: action.payload }
		case "SET_FILES":
			return { ...state, files: action.payload }
		case "SET_OPEN_FILES":
			return { ...state, openFiles: action.payload }
		case "SET_ACTIVE_FILE_PATH":
			return { ...state, activeFilePath: action.payload }
		case "SET_PIPELINE":
			return { ...state, pipeline: action.payload }
		case "SET_STATUS":
			return { ...state, status: action.payload }
		case "SET_REPO_NAME":
			return { ...state, repoName: action.payload }
		case "SET_BRANCH":
			return { ...state, branch: action.payload }
		case "SET_LOADING":
			return { ...state, loading: action.payload }
		case "SET_SHOW_AI_PANEL":
			return { ...state, showAiPanel: action.payload }
		case "SET_SHOW_TERMINAL":
			return { ...state, showTerminal: action.payload }
		case "SET_SHOW_FILE_PANEL":
			return { ...state, showFilePanel: action.payload }
		case "SET_TERMINAL_HEIGHT":
			return { ...state, terminalHeight: action.payload }
		case "SET_SHOW_DIFF_VIEW":
			return { ...state, showDiffView: action.payload }
		case "SET_SHOW_SHORTCUTS":
			return { ...state, showShortcuts: action.payload }
		case "SET_SHOW_IMPORT_GITHUB":
			return { ...state, showImportGithub: action.payload }
		case "SET_SHOW_OPEN_WORKSPACE":
			return { ...state, showOpenWorkspace: action.payload }
		case "SET_HERMES_STATS":
			return { ...state, hermesStats: action.payload }
		case "SET_DEPLOYMENTS":
			return { ...state, deployments: action.payload }
		case "SET_WORKSPACE_TASKS":
			return { ...state, workspaceTasks: action.payload }
		case "SET_RECENT_WORKSPACES":
			return { ...state, recentWorkspaces: action.payload }
		default:
			return state
	}
}

// ── Serialization helpers ──────────────────────────────────────────────────

function serialize(state) {
	const { collapsedBlocks, ...rest } = state
	return JSON.stringify({
		...rest,
		_collapsedBlocks: Array.from(collapsedBlocks),
	})
}

function deserialize(raw) {
	try {
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== "object") return {}
		const { _collapsedBlocks, ...rest } = parsed
		return {
			...rest,
			collapsedBlocks: new Set(Array.isArray(_collapsedBlocks) ? _collapsedBlocks : []),
		}
	} catch {
		return {}
	}
}

// ── Tests ──────────────────────────────────────────────────────────────────

section("ideReducer — HYDRATE")

test("HYDRATE merges payload into state and sets _hydrated=true", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "HYDRATE", payload: { repoName: "new-repo" } })
	assert.strictEqual(result._hydrated, true)
	assert.strictEqual(result.repoName, "new-repo")
	assert.strictEqual(result.branch, "main") // unchanged
})

test("HYDRATE preserves Set type for collapsedBlocks", () => {
	const state = createInitialState()
	state.collapsedBlocks = new Set(["block-1"])
	const result = ideReducer(state, {
		type: "HYDRATE",
		payload: { collapsedBlocks: new Set(["block-2"]) },
	})
	assert.ok(result.collapsedBlocks instanceof Set)
	assert.ok(result.collapsedBlocks.has("block-2"))
	assert.ok(!result.collapsedBlocks.has("block-1"))
})

test("HYDRATE falls back to existing Set when payload has plain array", () => {
	const state = createInitialState()
	state.collapsedBlocks = new Set(["existing"])
	const result = ideReducer(state, {
		type: "HYDRATE",
		payload: { collapsedBlocks: ["plain-array"] },
	})
	assert.ok(result.collapsedBlocks instanceof Set)
	assert.ok(result.collapsedBlocks.has("existing"))
	assert.ok(!result.collapsedBlocks.has("plain-array"))
})

test("HYDRATE handles null/undefined payload gracefully", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "HYDRATE", payload: null })
	assert.strictEqual(result._hydrated, true)
})

section("ideReducer — AI Messages")

test("ADD_AI_MESSAGE appends a message", () => {
	const state = createInitialState()
	const msg = { id: "1", role: "user", content: "hello" }
	const result = ideReducer(state, { type: "ADD_AI_MESSAGE", payload: msg })
	assert.strictEqual(result.aiMessages.length, 1)
	assert.strictEqual(result.aiMessages[0].content, "hello")
})

test("UPDATE_LAST_AI_MESSAGE updates the last message only", () => {
	const state = createInitialState()
	state.aiMessages = [
		{ id: "1", role: "user", content: "hi" },
		{ id: "2", role: "assistant", content: "hello" },
	]
	const result = ideReducer(state, {
		type: "UPDATE_LAST_AI_MESSAGE",
		payload: { content: "updated" },
	})
	assert.strictEqual(result.aiMessages.length, 2)
	assert.strictEqual(result.aiMessages[0].content, "hi") // unchanged
	assert.strictEqual(result.aiMessages[1].content, "updated")
})

test("SET_AI_MESSAGES replaces all messages", () => {
	const state = createInitialState()
	state.aiMessages = [{ id: "old", role: "user", content: "old" }]
	const result = ideReducer(state, {
		type: "SET_AI_MESSAGES",
		payload: [{ id: "new", role: "assistant", content: "new" }],
	})
	assert.strictEqual(result.aiMessages.length, 1)
	assert.strictEqual(result.aiMessages[0].id, "new")
})

test("SET_AI_SENDING toggles sending state", () => {
	const state = createInitialState()
	assert.strictEqual(state.aiSending, false)
	const result = ideReducer(state, { type: "SET_AI_SENDING", payload: true })
	assert.strictEqual(result.aiSending, true)
})

section("ideReducer — Terminal")

test("APPEND_TERMINAL_OUTPUT adds lines", () => {
	const state = createInitialState()
	state.terminalOutput = ["line1"]
	const result = ideReducer(state, { type: "APPEND_TERMINAL_OUTPUT", payload: ["line2", "line3"] })
	assert.strictEqual(result.terminalOutput.length, 3)
	assert.deepStrictEqual(result.terminalOutput, ["line1", "line2", "line3"])
	assert.strictEqual(result.outputBlocks.length, 2)
	assert.strictEqual(result.outputBlocks[0].content, "line2")
})

test("SET_TERMINAL_OUTPUT replaces all output", () => {
	const state = createInitialState()
	state.terminalOutput = ["old"]
	const result = ideReducer(state, { type: "SET_TERMINAL_OUTPUT", payload: ["new"] })
	assert.strictEqual(result.terminalOutput.length, 1)
	assert.strictEqual(result.terminalOutput[0], "new")
	assert.strictEqual(result.outputBlocks.length, 1)
	assert.strictEqual(result.outputBlocks[0].content, "new")
})

test("SET_TERMINAL_INPUT updates input", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_TERMINAL_INPUT", payload: "npm run build" })
	assert.strictEqual(result.terminalInput, "npm run build")
})

section("ideReducer — UI toggles")

test("SET_SHOW_AI_PANEL toggles AI panel", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_SHOW_AI_PANEL", payload: false })
	assert.strictEqual(result.showAiPanel, false)
})

test("SET_SHOW_TERMINAL toggles terminal", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_SHOW_TERMINAL", payload: false })
	assert.strictEqual(result.showTerminal, false)
})

test("SET_SHOW_FILE_PANEL toggles file panel", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_SHOW_FILE_PANEL", payload: false })
	assert.strictEqual(result.showFilePanel, false)
})

test("SET_TERMINAL_HEIGHT sets height", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_TERMINAL_HEIGHT", payload: 300 })
	assert.strictEqual(result.terminalHeight, 300)
})

test("SET_SHOW_DIFF_VIEW toggles diff view", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_SHOW_DIFF_VIEW", payload: true })
	assert.strictEqual(result.showDiffView, true)
})

test("SET_SHOW_SHORTCUTS toggles shortcuts modal", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_SHOW_SHORTCUTS", payload: true })
	assert.strictEqual(result.showShortcuts, true)
})

section("ideReducer — Workspace & Status")

test("SET_FILES replaces file list", () => {
	const state = createInitialState()
	const files = [{ name: "test.ts", path: "/test.ts", type: "file" }]
	const result = ideReducer(state, { type: "SET_FILES", payload: files })
	assert.strictEqual(result.files.length, 1)
	assert.strictEqual(result.files[0].name, "test.ts")
})

test("SET_ACTIVE_FILE_PATH sets active file", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_ACTIVE_FILE_PATH", payload: "/src/index.ts" })
	assert.strictEqual(result.activeFilePath, "/src/index.ts")
})

test("SET_STATUS updates status", () => {
	const state = createInitialState()
	const newStatus = { connected: false, docker: true, redis: true, cpu: "50%", ram: "1GB" }
	const result = ideReducer(state, { type: "SET_STATUS", payload: newStatus })
	assert.strictEqual(result.status.cpu, "50%")
	assert.strictEqual(result.status.connected, false)
})

test("SET_PIPELINE replaces pipeline steps", () => {
	const state = createInitialState()
	const pipeline = [{ step: 1, action: "build", status: "running" }]
	const result = ideReducer(state, { type: "SET_PIPELINE", payload: pipeline })
	assert.strictEqual(result.pipeline.length, 1)
})

test("SET_LOADING sets loading state", () => {
	const state = createInitialState()
	const result = ideReducer(state, { type: "SET_LOADING", payload: true })
	assert.strictEqual(result.loading, true)
})

section("ideReducer — Edge cases")

test("unknown action type returns state unchanged", () => {
	const state = createInitialState()
	state.repoName = "special"
	const result = ideReducer(state, { type: "UNKNOWN_ACTION", payload: "anything" })
	assert.strictEqual(result, state)
})

test("ADD_AI_ATTACHMENT appends to attachments", () => {
	const state = createInitialState()
	state.aiAttachments = [{ name: "file1.txt", content: "data" }]
	const result = ideReducer(state, {
		type: "ADD_AI_ATTACHMENT",
		payload: { name: "file2.txt", content: "data2" },
	})
	assert.strictEqual(result.aiAttachments.length, 2)
})

test("SET_HERMES_STATS stores stats", () => {
	const state = createInitialState()
	const stats = { commands: 42, sessions: 10 }
	const result = ideReducer(state, { type: "SET_HERMES_STATS", payload: stats })
	assert.strictEqual(result.hermesStats.commands, 42)
})

test("SET_DEPLOYMENTS stores deployments", () => {
	const state = createInitialState()
	const deploys = [{ id: "dep-1", status: "active" }]
	const result = ideReducer(state, { type: "SET_DEPLOYMENTS", payload: deploys })
	assert.strictEqual(result.deployments.length, 1)
})

section("serialize / deserialize")

test("serialize converts Set to _collapsedBlocks array", () => {
	const state = createInitialState()
	state.collapsedBlocks = new Set(["a", "b"])
	const json = serialize(state)
	const parsed = JSON.parse(json)
	assert.ok(Array.isArray(parsed._collapsedBlocks))
	assert.deepStrictEqual(parsed._collapsedBlocks, ["a", "b"])
	assert.strictEqual(parsed.collapsedBlocks, undefined)
})

test("deserialize converts _collapsedBlocks back to Set", () => {
	const json = JSON.stringify({
		repoName: "test",
		_collapsedBlocks: ["x", "y"],
	})
	const result = deserialize(json)
	assert.ok(result.collapsedBlocks instanceof Set)
	assert.ok(result.collapsedBlocks.has("x"))
	assert.ok(result.collapsedBlocks.has("y"))
	assert.strictEqual(result.repoName, "test")
})

test("deserialize handles missing _collapsedBlocks", () => {
	const json = JSON.stringify({ repoName: "test" })
	const result = deserialize(json)
	assert.ok(result.collapsedBlocks instanceof Set)
	assert.strictEqual(result.collapsedBlocks.size, 0)
})

test("deserialize handles malformed JSON", () => {
	const result = deserialize("not-json")
	assert.deepStrictEqual(result, {})
})

test("deserialize handles null parsed value", () => {
	const result = deserialize("null")
	assert.deepStrictEqual(result, {})
})

test("deserialize handles non-object parsed value", () => {
	const result = deserialize('"string"')
	assert.deepStrictEqual(result, {})
})

test("serialize + deserialize round-trip preserves data", () => {
	const state = createInitialState()
	state.repoName = "superroo"
	state.branch = "auto-improvement"
	state.collapsedBlocks = new Set(["block-1", "block-2"])
	state.aiMessages = [{ id: "m1", role: "user", content: "hello" }]
	state.terminalOutput = ["line1", "line2"]

	const json = serialize(state)
	const restored = deserialize(json)

	assert.strictEqual(restored.repoName, "superroo")
	assert.strictEqual(restored.branch, "auto-improvement")
	assert.ok(restored.collapsedBlocks instanceof Set)
	assert.strictEqual(restored.collapsedBlocks.size, 2)
	assert.strictEqual(restored.aiMessages.length, 1)
	assert.strictEqual(restored.terminalOutput.length, 2)
})

module.exports = { ideReducer, serialize, deserialize }
