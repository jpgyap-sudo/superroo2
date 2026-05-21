/**
 * Mini IDE Integration Test — Unified API Coverage
 *
 * Tests both /api/* (Mini IDE) and /ide-workspace/* (Dashboard) endpoints.
 * Run: node test-integration.js
 */

const http = require("http")
const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { WebSocket } = require("ws")

const TEST_PORT = 18081
let exitCode = 0

function log(msg) {
	console.log(`[TEST] ${msg}`)
}

function fail(msg) {
	console.error(`[FAIL] ${msg}`)
	exitCode = 1
}

async function httpRequest(method, urlPath, body = null) {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: "127.0.0.1",
			port: TEST_PORT,
			path: urlPath,
			method,
			headers: {},
		}
		if (body) {
			options.headers["Content-Type"] = "application/json"
		}
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

async function runTests() {
	log("Starting unified integration tests...")

	// ── 1. Dependency check ──────────────────────────────────────────────────
	log("1. Checking dependencies...")
	const deps = ["express", "cors", "multer", "ws"]
	for (const dep of deps) {
		try {
			require.resolve(dep)
			log(`   ✓ ${dep}`)
		} catch {
			fail(`Missing dependency: ${dep}. Run: pnpm install express cors multer ws`)
			return
		}
	}

	// ── 2. Module load check ─────────────────────────────────────────────────
	log("2. Checking server module loads...")
	process.env.MINI_IDE_PORT = String(TEST_PORT)
	process.env.NODE_ENV = "test"
	process.env.BOT_TOKEN = ""
	delete require.cache[require.resolve("./server.js")]
	try {
		require("./server.js")
		log("   ✓ server.js loads without errors")
	} catch (err) {
		fail(`server.js failed to load: ${err.message}`)
		return
	}

	// ── 3. Static file check ─────────────────────────────────────────────────
	log("3. Checking static files exist...")
	for (const f of ["index.html", "styles.css", "app.js"]) {
		if (fs.existsSync(path.join(__dirname, "public", f))) {
			log(`   ✓ public/${f}`)
		} else {
			fail(`Missing static file: public/${f}`)
		}
	}

	// ── 4. Start test server ─────────────────────────────────────────────────
	log("4. Starting test server on port " + TEST_PORT + "...")
	const child = spawn(process.execPath, ["server.js"], {
		cwd: __dirname,
		env: { ...process.env, MINI_IDE_PORT: String(TEST_PORT), NODE_ENV: "test" },
		stdio: "pipe",
	})

	let stderr = ""
	child.stderr.on("data", (d) => {
		stderr += d.toString()
	})

	await new Promise((r) => setTimeout(r, 1500))

	// ── 5. Test Mini IDE API (/api/*) ────────────────────────────────────────
	log("5. Testing Mini IDE API (/api/*)...")

	const health = await httpRequest("GET", "/api/health")
	if (health.status === 200) log("   ✓ GET /api/health → 200")
	else fail(`GET /api/health → ${health.status}`)

	const session = await httpRequest("GET", "/api/session")
	if (session.status === 200 && session.data.user) log("   ✓ GET /api/session → 200")
	else fail(`GET /api/session → ${session.status}`)

	const workspaces = await httpRequest("GET", "/api/workspaces")
	if (workspaces.status === 200 && Array.isArray(workspaces.data.workspaces)) log("   ✓ GET /api/workspaces → 200")
	else fail(`GET /api/workspaces → ${workspaces.status}`)

	const files = await httpRequest("GET", "/api/workspaces/superroo2/files")
	if (files.status === 200 && Array.isArray(files.data.files)) log("   ✓ GET /api/workspaces/:id/files → 200")
	else fail(`GET /api/workspaces/:id/files → ${files.status}`)

	const writeFile = await httpRequest("POST", "/api/workspaces/superroo2/file", {
		path: "test.txt",
		content: "hello world",
	})
	if (writeFile.status === 200) log("   ✓ POST /api/workspaces/:id/file → 200")
	else fail(`POST /api/workspaces/:id/file → ${writeFile.status}`)

	const readFile = await httpRequest("GET", "/api/workspaces/superroo2/file?path=test.txt")
	if (readFile.status === 200 && readFile.data.content) log("   ✓ GET /api/workspaces/:id/file → 200")
	else fail(`GET /api/workspaces/:id/file → ${readFile.status}`)

	const createFile = await httpRequest("POST", "/api/workspaces/superroo2/file/create", { path: "new-test.txt" })
	if (createFile.status === 200) log("   ✓ POST /api/workspaces/:id/file/create → 200")
	else fail(`POST /api/workspaces/:id/file/create → ${createFile.status}`)

	const createFolder = await httpRequest("POST", "/api/workspaces/superroo2/folder/create", { path: "new-folder" })
	if (createFolder.status === 200) log("   ✓ POST /api/workspaces/:id/folder/create → 200")
	else fail(`POST /api/workspaces/:id/folder/create → ${createFolder.status}`)

	const deleteFile = await httpRequest("DELETE", "/api/workspaces/superroo2/file?path=new-test.txt")
	if (deleteFile.status === 200) log("   ✓ DELETE /api/workspaces/:id/file → 200")
	else fail(`DELETE /api/workspaces/:id/file → ${deleteFile.status}`)

	const logs = await httpRequest("GET", "/api/workspaces/superroo2/logs")
	if (logs.status === 200 && Array.isArray(logs.data.logs)) log("   ✓ GET /api/workspaces/:id/logs → 200")
	else fail(`GET /api/workspaces/:id/logs → ${logs.status}`)

	const taskSync = await httpRequest("POST", "/api/tasks/sync", {
		workspaceId: "superroo2",
		action: "test",
		description: "integration test",
	})
	if (taskSync.status === 200 && taskSync.data.task) log("   ✓ POST /api/tasks/sync → 200")
	else fail(`POST /api/tasks/sync → ${taskSync.status}`)

	const tasks = await httpRequest("GET", "/api/tasks")
	if (tasks.status === 200 && Array.isArray(tasks.data.tasks)) log("   ✓ GET /api/tasks → 200")
	else fail(`GET /api/tasks → ${tasks.status}`)

	// ── 6. Test Dashboard API (/ide-workspace/*) ─────────────────────────────
	log("6. Testing Dashboard API (/ide-workspace/*)...")

	const wsData = await httpRequest("GET", "/ide-workspace/workspace")
	if (wsData.status === 200 && wsData.data.repoName) log("   ✓ GET /ide-workspace/workspace → 200")
	else fail(`GET /ide-workspace/workspace → ${wsData.status}`)

	const wsReset = await httpRequest("POST", "/ide-workspace/workspace/reset")
	if (wsReset.status === 200) log("   ✓ POST /ide-workspace/workspace/reset → 200")
	else fail(`POST /ide-workspace/workspace/reset → ${wsReset.status}`)

	const wsOpen = await httpRequest("POST", "/ide-workspace/workspace/open")
	if (wsOpen.status === 200) log("   ✓ POST /ide-workspace/workspace/open → 200")
	else fail(`POST /ide-workspace/workspace/open → ${wsOpen.status}`)

	const termCreate = await httpRequest("POST", "/ide-workspace/terminal/create", { name: "test-term" })
	if (termCreate.status === 200 && termCreate.data.terminal) log("   ✓ POST /ide-workspace/terminal/create → 200")
	else fail(`POST /ide-workspace/terminal/create → ${termCreate.status}`)

	const termExec = await httpRequest("POST", "/ide-workspace/terminal/execute", {
		command: "echo hello",
		terminalId: "term-1",
	})
	if (termExec.status === 200 && Array.isArray(termExec.data.output))
		log("   ✓ POST /ide-workspace/terminal/execute → 200")
	else fail(`POST /ide-workspace/terminal/execute → ${termExec.status}`)

	const termRaw = await httpRequest("POST", "/ide-workspace/terminal/exec", { command: "echo raw" })
	if (termRaw.status === 200 && termRaw.data.stdout) log("   ✓ POST /ide-workspace/terminal/exec → 200")
	else fail(`POST /ide-workspace/terminal/exec → ${termRaw.status}`)

	const diff = await httpRequest("POST", "/ide-workspace/diff", { original: "a\nb", modified: "a\nc" })
	if (diff.status === 200 && Array.isArray(diff.data.changes)) log("   ✓ POST /ide-workspace/diff → 200")
	else fail(`POST /ide-workspace/diff → ${diff.status}`)

	const pipeline = await httpRequest("PATCH", "/ide-workspace/pipeline", { stepId: "plan", action: "approve" })
	if (pipeline.status === 200 && Array.isArray(pipeline.data.pipeline))
		log("   ✓ PATCH /ide-workspace/pipeline → 200")
	else fail(`PATCH /ide-workspace/pipeline → ${pipeline.status}`)

	const providers = await httpRequest("GET", "/ide-workspace/providers")
	if (providers.status === 200 && Array.isArray(providers.data.providers))
		log("   ✓ GET /ide-workspace/providers → 200")
	else fail(`GET /ide-workspace/providers → ${providers.status}`)

	const chat = await httpRequest("POST", "/ide-workspace/chat", { message: "hello" })
	if (chat.status === 200 && chat.data.reply) log("   ✓ POST /ide-workspace/chat → 200")
	else fail(`POST /ide-workspace/chat → ${chat.status}`)

	const fileRead = await httpRequest("GET", "/ide-workspace/file/read?path=/dashboard-test.txt")
	if (fileRead.status === 200 && fileRead.data.content === "dashboard content")
		log("   ✓ GET /ide-workspace/file/read → 200")
	else fail(`GET /ide-workspace/file/read → ${fileRead.status}`)

	const fileSave = await httpRequest("POST", "/ide-workspace/file/save", {
		path: "/dashboard-test.txt",
		content: "dashboard content",
	})
	if (fileSave.status === 200) log("   ✓ POST /ide-workspace/file/save → 200")
	else fail(`POST /ide-workspace/file/save → ${fileSave.status}`)

	const dashCreateFile = await httpRequest("POST", "/ide-workspace/file/create", { path: "/dash-new.txt" })
	if (dashCreateFile.status === 200) log("   ✓ POST /ide-workspace/file/create → 200")
	else fail(`POST /ide-workspace/file/create → ${dashCreateFile.status}`)

	const dashCreateFolder = await httpRequest("POST", "/ide-workspace/folder/create", { path: "/dash-new-folder" })
	if (dashCreateFolder.status === 200) log("   ✓ POST /ide-workspace/folder/create → 200")
	else fail(`POST /ide-workspace/folder/create → ${dashCreateFolder.status}`)

	const dashDeleteFile = await httpRequest("DELETE", "/ide-workspace/file?path=/dash-new.txt")
	if (dashDeleteFile.status === 200) log("   ✓ DELETE /ide-workspace/file → 200")
	else fail(`DELETE /ide-workspace/file → ${dashDeleteFile.status}`)

	const git = await httpRequest("POST", "/ide-workspace/git", { action: "status" })
	if (git.status === 200 && git.data.output) log("   ✓ POST /ide-workspace/git → 200")
	else fail(`POST /ide-workspace/git → ${git.status}`)

	const search = await httpRequest("GET", "/ide-workspace/search?q=hello")
	if (search.status === 200 && Array.isArray(search.data.results)) log("   ✓ GET /ide-workspace/search → 200")
	else fail(`GET /ide-workspace/search → ${search.status}`)

	const searchContent = await httpRequest("GET", "/ide-workspace/search?q=dashboard%20content")
	if (searchContent.status === 200 && searchContent.data.results.some((r) => r.content?.includes("dashboard")))
		log("   ✓ GET /ide-workspace/search (content) → 200")
	else fail(`GET /ide-workspace/search (content) → ${searchContent.status}`)

	const brain = await httpRequest("POST", "/brain/ask", { message: "hello" })
	if (brain.status === 200 && brain.data.reply) log("   ✓ POST /brain/ask → 200")
	else fail(`POST /brain/ask → ${brain.status}`)

	const orchStatus = await httpRequest("GET", "/ide-workspace/orchestrator/status")
	if (orchStatus.status === 200) log("   ✓ GET /ide-workspace/orchestrator/status → 200")
	else fail(`GET /ide-workspace/orchestrator/status → ${orchStatus.status}`)

	const orchSubmit = await httpRequest("POST", "/ide-workspace/orchestrator/submit", { instruction: "test" })
	if (orchSubmit.status === 200 && orchSubmit.data.taskId) log("   ✓ POST /ide-workspace/orchestrator/submit → 200")
	else fail(`POST /ide-workspace/orchestrator/submit → ${orchSubmit.status}`)

	// ── 7. WebSocket test ────────────────────────────────────────────────────
	log("7. Testing WebSocket connection...")
	await new Promise((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?workspace=test`)
		let resolved = false
		ws.on("open", () => {
			log("   ✓ WebSocket connected")
		})
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data)
				if (msg.type === "event" && msg.event === "connected") {
					log("   ✓ WebSocket received welcome event")
					if (!resolved) {
						resolved = true
						ws.close()
						resolve()
					}
				}
			} catch {}
		})
		ws.on("error", (err) => {
			fail(`WebSocket error: ${err.message}`)
			if (!resolved) {
				resolved = true
				resolve()
			}
		})
		setTimeout(() => {
			if (!resolved) {
				resolved = true
				ws.close()
				resolve()
			}
		}, 3000)
	})

	// ── 8. Static file serving ───────────────────────────────────────────────
	log("8. Testing static file serving...")
	const idx = await httpRequest("GET", "/")
	if (idx.status === 200 && typeof idx.data === "string" && idx.data.includes("ide-shell")) {
		log("   ✓ GET / → 200 (serves index.html)")
	} else {
		fail(`GET / → ${idx.status}`)
	}

	// ── 9. Cleanup ───────────────────────────────────────────────────────────
	log("9. Shutting down test server...")
	child.kill("SIGTERM")
	await new Promise((r) => setTimeout(r, 500))
	if (!child.killed) child.kill("SIGKILL")

	// ── Summary ──────────────────────────────────────────────────────────────
	if (exitCode === 0) {
		log("\n✅ All integration tests passed!")
	} else {
		log("\n❌ Some tests failed. Check output above.")
		if (stderr) log(`Server stderr:\n${stderr.slice(0, 500)}`)
	}
	process.exit(exitCode)
}

runTests().catch((err) => {
	console.error("[TEST] Fatal error:", err)
	process.exit(1)
})
