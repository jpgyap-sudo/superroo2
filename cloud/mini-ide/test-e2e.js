/**
 * SuperRoo Mini IDE — End-to-End Coding Test
 *
 * Tests the full coding workflow:
 * 1. Load workspace
 * 2. List files
 * 3. Open/read a file
 * 4. Edit and save
 * 5. Compute diff
 * 6. Run terminal command
 * 7. Send chat message
 * 8. Update pipeline
 * 9. Verify shared store persistence
 * 10. WebSocket real-time connection
 *
 * Run: node test-e2e.js
 */

const http = require("http")
const { WebSocket } = require("ws")

const TEST_PORT = 18086
const BASE = `http://127.0.0.1:${TEST_PORT}`
let passCount = 0
let failCount = 0

function log(msg) {
	console.log(`[E2E] ${msg}`)
}

function pass(msg) {
	passCount++
	console.log(`[E2E]   ✅ ${msg}`)
}

function fail(msg) {
	failCount++
	console.error(`[E2E]   ❌ ${msg}`)
}

async function httpRequest(method, path, body = null) {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: "127.0.0.1",
			port: TEST_PORT,
			path,
			method,
			headers: {},
		}
		if (body) options.headers["Content-Type"] = "application/json"
		const req = http.request(options, (res) => {
			let data = ""
			res.on("data", (chunk) => (data += chunk))
			res.on("end", () => {
				try {
					resolve({ status: res.statusCode, data: JSON.parse(data) })
				} catch {
					resolve({ status: res.statusCode, data })
				}
			})
		})
		req.on("error", reject)
		if (body) req.write(JSON.stringify(body))
		req.end()
	})
}

async function assertEqual(label, actual, expected) {
	const a = JSON.stringify(actual)
	const e = JSON.stringify(expected)
	if (a === e) {
		pass(`${label}: ${a}`)
	} else {
		fail(`${label}: expected ${e}, got ${a}`)
	}
}

async function assertOk(label, status, data) {
	if (status >= 200 && status < 300) {
		pass(`${label} (status ${status})`)
		return true
	}
	fail(`${label} (status ${status}): ${JSON.stringify(data).slice(0, 200)}`)
	return false
}

async function runE2E() {
	log("Starting comprehensive E2E coding test...")

	// ── Start server ─────────────────────────────────────────────────────────
	const { spawn } = require("child_process")
	const child = spawn(process.execPath, ["server.js"], {
		cwd: __dirname,
		env: { ...process.env, MINI_IDE_PORT: String(TEST_PORT), NODE_ENV: "development" },
		stdio: "pipe",
	})
	let stderr = ""
	child.stderr.on("data", (d) => {
		stderr += d.toString()
	})

	await new Promise((r) => setTimeout(r, 2000))
	log("Server started on port " + TEST_PORT)

	// ── 1. Health check ──────────────────────────────────────────────────────
	log("1. Health check")
	const health = await httpRequest("GET", "/api/health")
	await assertOk("Health endpoint", health.status, health.data)

	// ── 2. Session / Auth ────────────────────────────────────────────────────
	log("2. Auth (dev fallback)")
	const session = await httpRequest("GET", "/api/session")
	await assertOk("Session endpoint", session.status, session.data)
	await assertEqual("Dev user", session.data.user?.username, "dev")

	// ── 3. Load workspace via Dashboard API ──────────────────────────────────
	log("3. Workspace load")
	const ws = await httpRequest("GET", "/ide-workspace/workspace")
	await assertOk("Dashboard workspace", ws.status, ws.data)
	await assertEqual("Repo name", ws.data.repoName, "superroo2")
	await assertEqual("Branch", ws.data.branch, "main")
	await assertEqual("Has files", ws.data.files?.length > 0, true)
	await assertEqual("Has pipeline", ws.data.pipeline?.length, 6)
	await assertEqual("Has terminal", ws.data.terminalSessions?.length > 0, true)

	// ── 4. File write via Dashboard API ──────────────────────────────────────
	log("4. File write (dashboard API)")
	const write1 = await httpRequest("POST", "/ide-workspace/file/save", {
		path: "/e2e-test.js",
		content: "console.log('hello world')",
	})
	await assertOk("Dashboard file save", write1.status, write1.data)

	// ── 5. File read via Mini API (cross-API sync) ───────────────────────────
	log("5. File read (mini API → should find dashboard file)")
	const read1 = await httpRequest("GET", "/api/workspaces/superroo2/file?path=e2e-test.js")
	await assertOk("Mini API file read", read1.status, read1.data)
	if (read1.data.content === "console.log('hello world')") {
		pass("Cross-API file sync works")
	} else {
		fail(`Cross-API file sync broken: ${JSON.stringify(read1.data.content).slice(0, 100)}`)
	}

	// ── 6. File write via Mini API ───────────────────────────────────────────
	log("6. File write (mini API)")
	const write2 = await httpRequest("POST", "/api/workspaces/superroo2/file", {
		path: "e2e-mini.txt",
		content: "written from mini api",
	})
	await assertOk("Mini API file save", write2.status, write2.data)

	// ── 7. File read via Dashboard API (cross-API sync) ──────────────────────
	log("7. File read (dashboard API → should find mini file)")
	const read2 = await httpRequest("GET", "/ide-workspace/file/read?path=/e2e-mini.txt")
	await assertOk("Dashboard file read", read2.status, read2.data)
	if (read2.data.content === "written from mini api") {
		pass("Cross-API file sync reverse works")
	} else {
		fail(`Cross-API file sync reverse broken: ${JSON.stringify(read2.data.content).slice(0, 100)}`)
	}

	// ── 8. Diff ──────────────────────────────────────────────────────────────
	log("8. Diff computation")
	const diff = await httpRequest("POST", "/ide-workspace/diff", {
		original: "line1\nline2\nline3",
		modified: "line1\nmodified\nline3",
	})
	await assertOk("Diff endpoint", diff.status, diff.data)
	await assertEqual("Diff changes count", diff.data.totalChanges, 1)
	await assertEqual("Diff line", diff.data.changes?.[0]?.line, 2)
	await assertEqual("Diff type", diff.data.changes?.[0]?.type, "modified")

	// ── 9. Terminal execute ──────────────────────────────────────────────────
	log("9. Terminal execute")
	const term = await httpRequest("POST", "/ide-workspace/terminal/execute", {
		command: "echo terminal-works",
		terminalId: "term-1",
	})
	await assertOk("Terminal execute", term.status, term.data)
	await assertEqual("Terminal output", term.data.output?.includes("terminal-works"), true)

	// ── 10. Terminal exec (raw shell) ────────────────────────────────────────
	log("10. Terminal exec (raw)")
	const termRaw = await httpRequest("POST", "/ide-workspace/terminal/exec", {
		command: "echo raw-shell",
	})
	await assertOk("Terminal exec", termRaw.status, termRaw.data)
	await assertEqual("Terminal stdout", termRaw.data.stdout?.trim(), "raw-shell")

	// ── 11. Chat ─────────────────────────────────────────────────────────────
	log("11. Chat")
	const chat = await httpRequest("POST", "/ide-workspace/chat", {
		message: "e2e chat test",
	})
	await assertOk("Chat endpoint", chat.status, chat.data)
	await assertEqual("Chat reply", chat.data.reply?.includes("e2e chat test"), true)

	// ── 12. Pipeline update ──────────────────────────────────────────────────
	log("12. Pipeline update")
	const pipe = await httpRequest("PATCH", "/ide-workspace/pipeline", {
		stepId: "tests",
		action: "approve",
	})
	await assertOk("Pipeline update", pipe.status, pipe.data)
	const testsStep = pipe.data.pipeline?.find((s) => s.id === "tests")
	await assertEqual("Pipeline step status", testsStep?.status, "running")

	// ── 13. Verify persistence ───────────────────────────────────────────────
	log("13. Store persistence")
	const ws2 = await httpRequest("GET", "/ide-workspace/workspace")
	await assertOk("Re-read workspace", ws2.status, ws2.data)
	const chatMsgs = ws2.data.chatMessages || []
	const hasChat = chatMsgs.some((m) => m.content?.includes("e2e chat test"))
	await assertEqual("Chat persisted", hasChat, true)
	const termMsgs = ws2.data.terminalSessions || []
	const hasTerm = termMsgs.some((t) => t.output?.some((l) => l.includes("terminal-works")))
	await assertEqual("Terminal output persisted", hasTerm, true)

	// ── 14. WebSocket ────────────────────────────────────────────────────────
	log("14. WebSocket connection")
	await new Promise((resolve) => {
		const wsClient = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?workspace=e2e`)
		let resolved = false
		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true
				fail("WebSocket timeout")
				wsClient.close()
				resolve()
			}
		}, 3000)
		wsClient.on("open", () => {
			pass("WebSocket connected")
		})
		wsClient.on("message", (data) => {
			try {
				const msg = JSON.parse(data)
				if (msg.type === "event" && msg.event === "connected") {
					pass("WebSocket welcome event received")
					if (!resolved) {
						resolved = true
						clearTimeout(timeout)
						wsClient.close()
						resolve()
					}
				}
			} catch {}
		})
		wsClient.on("error", (err) => {
			if (!resolved) {
				resolved = true
				fail(`WebSocket error: ${err.message}`)
				clearTimeout(timeout)
				resolve()
			}
		})
	})

	// ── 15. Git stub ─────────────────────────────────────────────────────────
	log("15. Git commands")
	const gitStatus = await httpRequest("POST", "/ide-workspace/git", { action: "status" })
	await assertOk("Git status", gitStatus.status, gitStatus.data)
	const hasGitOutput =
		gitStatus.data.output && (gitStatus.data.output.includes("On branch") || gitStatus.data.output.includes("## "))
	await assertEqual("Git output", hasGitOutput, true)

	// ── 16. Search ───────────────────────────────────────────────────────────
	log("16. Search")
	const search = await httpRequest("GET", "/ide-workspace/search?q=README")
	await assertOk("Search endpoint", search.status, search.data)
	await assertEqual("Search has results", search.data.results?.length > 0, true)

	// ── 17. Orchestrator stub ────────────────────────────────────────────────
	log("17. Orchestrator")
	const orch = await httpRequest("GET", "/ide-workspace/orchestrator/status")
	await assertOk("Orchestrator status", orch.status, orch.data)
	await assertEqual("Orchestrator ok", orch.data.ok, true)

	const orchSubmit = await httpRequest("POST", "/ide-workspace/orchestrator/submit", {
		instruction: "e2e test task",
	})
	await assertOk("Orchestrator submit", orchSubmit.status, orchSubmit.data)
	await assertEqual("Has taskId", !!orchSubmit.data.taskId, true)

	// ── Cleanup ──────────────────────────────────────────────────────────────
	log("Shutting down test server...")
	child.kill("SIGTERM")
	await new Promise((r) => setTimeout(r, 500))
	if (!child.killed) child.kill("SIGKILL")

	// ── Summary ──────────────────────────────────────────────────────────────
	log("")
	log(`Results: ${passCount} passed, ${failCount} failed`)
	if (failCount === 0) {
		log("🎉 All E2E coding tests passed!")
		process.exit(0)
	} else {
		log("⚠️ Some E2E tests failed. Check output above.")
		if (stderr) log(`Server stderr:\n${stderr.slice(0, 500)}`)
		process.exit(1)
	}
}

runE2E().catch((err) => {
	console.error("[E2E] Fatal error:", err)
	process.exit(1)
})
