/**
 * SuperRoo Cloud — Debug Job Runner
 *
 * Cloud-native Super Debug Team execution engine.
 * Runs multi-phase debug/fix loops directly on the VPS host.
 *
 * Phases per attempt:
 *   1. triage   — Read git log + recent error logs for context
 *   2. plan     — LLM (HermesClaw via vault key) generates hypothesis + fix commands
 *   3. snapshot — Create a git branch for this attempt
 *   4. execute  — Apply fix commands in project directory
 *   5. test     — Run test command to verify fix
 *   6. commit   — Commit on success; rollback branch and retry on failure
 *
 * Triggered by BullMQ jobs with agentId === "superroo-debugger-agent".
 */

const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto")
const http = require("http")

const execAsync = promisify(exec)

// ── Config ───────────────────────────────────────────────────────────────────

const AUTH_DIR = process.env.AUTH_DIR || "/opt/superroo2/cloud/data/auth"
const PROJECTS_FILE = path.join(AUTH_DIR, "projects.json")
const SECRETS_FILE = path.join(
	process.env.SUPERROO_ROOT || "/opt/superroo2",
	"cloud/data/settings/encrypted-secrets.json",
)
const VAULT_KEY_B64 = process.env.SUPERROO_VAULT_KEY || ""
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8787"
const MAX_ATTEMPTS = 3
const ALGO = "aes-256-gcm"

// ── Vault helpers ─────────────────────────────────────────────────────────────

function decryptSecret(payload) {
	const key = Buffer.from(VAULT_KEY_B64, "base64")
	const [ivB64, tagB64, dataB64] = payload.split(".")
	const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"))
	decipher.setAuthTag(Buffer.from(tagB64, "base64"))
	return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

async function getProviderKey(providerId) {
	try {
		const raw = await fs.readFile(SECRETS_FILE, "utf8")
		const secrets = JSON.parse(raw)
		if (!secrets[providerId]) return null
		return decryptSecret(secrets[providerId])
	} catch {
		return null
	}
}

// ── LLM call (HermesClaw) ─────────────────────────────────────────────────────

async function callLLM(systemPrompt, userPrompt) {
	const providers = [
		{ envKey: process.env.OPENAI_API_KEY, vaultId: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
		{ envKey: null, vaultId: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
	]

	for (const p of providers) {
		const apiKey = p.envKey || (await getProviderKey(p.vaultId))
		if (!apiKey) continue

		try {
			const res = await fetch(`${p.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({
					model: p.model,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt },
					],
					max_tokens: 2000,
					temperature: 0.3,
				}),
				signal: AbortSignal.timeout(60000),
			})
			if (!res.ok) continue
			const data = await res.json()
			return data.choices?.[0]?.message?.content || null
		} catch {
			continue
		}
	}

	return null
}

// ── Project resolver ──────────────────────────────────────────────────────────

async function resolveProjectPath(repoName) {
	try {
		const raw = await fs.readFile(PROJECTS_FILE, "utf8")
		const projects = JSON.parse(raw)
		const project = projects.find(
			(p) =>
				(p.repoName || "").toLowerCase() === repoName.toLowerCase() ||
				(p.name || "").toLowerCase() === repoName.toLowerCase(),
		)
		return project?.localPath || null
	} catch {
		return null
	}
}

// ── Telegram notification ─────────────────────────────────────────────────────

function sendNotification(chatId, title, message) {
	if (!chatId) return
	const payload = JSON.stringify({
		chatId: String(chatId),
		type: "notification",
		taskId: "debug-" + Date.now(),
		result: { title, message },
	})
	const url = new URL("/telegram/notify", API_BASE_URL)
	const req = http.request(url.toString(), {
		method: "POST",
		headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
		timeout: 5000,
	})
	req.on("error", () => {})
	req.write(payload)
	req.end()
}

// ── Git helpers ───────────────────────────────────────────────────────────────

async function gitRun(args, cwd) {
	const { stdout } = await execAsync(`git ${args}`, { cwd, timeout: 30000 })
	return stdout.trim()
}

async function getDefaultBranch(cwd) {
	try {
		return await gitRun("rev-parse --abbrev-ref HEAD", cwd)
	} catch {
		return "main"
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runDebugJob(job) {
	const { goal, repo = "superroo2", telegram = {} } = job.data
	const chatId = telegram.chatId || ""
	const jobId = job.id
	const tag = `[debug:${jobId}]`

	console.log(`${tag} Starting | goal: ${goal} | repo: ${repo}`)
	sendNotification(chatId, "🔍 Super Debug Team Activated", `Goal: ${goal}\nRepo: ${repo}\n\nStarting analysis...`)

	const projectPath = await resolveProjectPath(repo)
	if (!projectPath) {
		const err = `Project "${repo}" not found or has no local path.`
		console.error(`${tag} ${err}`)
		sendNotification(chatId, "❌ Debug Failed", err)
		return { success: false, error: err }
	}

	const defaultBranch = await getDefaultBranch(projectPath)
	let lastError = null

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const branch = `debug/fix-${jobId}-a${attempt}`
		console.log(`${tag} Attempt ${attempt}/${MAX_ATTEMPTS}`)
		sendNotification(chatId, `🔄 Attempt ${attempt}/${MAX_ATTEMPTS}`, "Triaging issue...")

		let onDebugBranch = false

		try {
			// ── Phase 1: Triage ───────────────────────────────────────────────
			let triage = ""
			try {
				const gitLog = await gitRun("log --oneline -10", projectPath)
				const gitStatus = await gitRun("status --short", projectPath)
				triage += `Git log:\n${gitLog}\n\nGit status:\n${gitStatus}`
			} catch (e) {
				triage += `(git triage unavailable: ${e.message})`
			}
			try {
				const { stdout } = await execAsync("tail -50 /opt/superroo2/cloud/logs/api-error.log", { timeout: 10000 })
				triage += `\n\nRecent API errors:\n${stdout}`
			} catch {
				// log file may not exist yet
			}

			// ── Phase 2: Plan ─────────────────────────────────────────────────
			sendNotification(chatId, `💡 Planning Fix (attempt ${attempt})`, "Generating hypothesis...")

			const planRaw = await callLLM(
				"You are a senior software engineer debugging a production issue. " +
					"Given a bug description and context, output a JSON fix plan with these fields:\n" +
					'{ "hypothesis": "string", "fixCommands": ["shell cmd", ...], "testCommand": "string", "confidence": 0.0-1.0 }\n' +
					"fixCommands are shell commands run in the project directory to apply the fix. " +
					"testCommand verifies the fix (e.g. npm test, pnpm test, or a curl health check). " +
					"Output ONLY valid JSON. No markdown.",
				`Goal: ${goal}\n\nAttempt: ${attempt}/${MAX_ATTEMPTS}\nPrevious error: ${lastError || "none"}\n\nContext:\n${triage.slice(0, 3000)}`,
			)

			let fixCommands = []
			let testCommand = "echo 'No test command'"
			let hypothesis = goal

			if (planRaw) {
				try {
					const plan = JSON.parse(planRaw)
					fixCommands = Array.isArray(plan.fixCommands) ? plan.fixCommands : []
					testCommand = plan.testCommand || testCommand
					hypothesis = plan.hypothesis || hypothesis
					console.log(`${tag} Hypothesis: ${hypothesis}`)
					sendNotification(chatId, `💡 Hypothesis (attempt ${attempt})`, hypothesis)
				} catch {
					console.log(`${tag} LLM plan parse failed, skipping auto-fix`)
					sendNotification(chatId, "⚠️ Plan Parse Failed", "LLM returned invalid JSON. Running triage only.")
				}
			} else {
				sendNotification(
					chatId,
					"⚠️ No AI Provider",
					"Add an OpenAI or DeepSeek key via the dashboard to enable auto-fix.",
				)
			}

			// ── Phase 3: Snapshot ─────────────────────────────────────────────
			try {
				await gitRun(`checkout -b ${branch}`, projectPath)
				onDebugBranch = true
				console.log(`${tag} Snapshot: branch ${branch}`)
			} catch (e) {
				try {
					await gitRun(`checkout ${branch}`, projectPath)
					onDebugBranch = true
				} catch {
					console.log(`${tag} Branch creation failed: ${e.message}, continuing on current branch`)
				}
			}

			// ── Phase 4: Execute fix ──────────────────────────────────────────
			if (fixCommands.length > 0) {
				sendNotification(chatId, "🔧 Applying Fix", `Running ${fixCommands.length} fix command(s)...`)
				for (const cmd of fixCommands) {
					console.log(`${tag} Exec: ${cmd}`)
					try {
						const { stdout, stderr } = await execAsync(cmd, { cwd: projectPath, timeout: 60000 })
						if (stdout) console.log(`${tag} stdout: ${stdout.slice(0, 300)}`)
						if (stderr) console.log(`${tag} stderr: ${stderr.slice(0, 200)}`)
					} catch (e) {
						console.log(`${tag} Fix cmd failed: ${e.message}`)
						lastError = e.message
					}
				}
			}

			// ── Phase 5: Test ─────────────────────────────────────────────────
			sendNotification(chatId, "🧪 Running Tests", `\`${testCommand}\``)
			let testPassed = false

			try {
				const { stdout, stderr } = await execAsync(testCommand, { cwd: projectPath, timeout: 120000 })
				testPassed = true
				lastError = null
				console.log(`${tag} Tests passed`)
				const out = (stdout + "\n" + stderr).trim().slice(0, 500)
				if (out) console.log(`${tag} Test output: ${out}`)
			} catch (e) {
				const out = ((e.stdout || "") + "\n" + (e.stderr || "")).trim().slice(0, 800)
				lastError = out || e.message
				console.log(`${tag} Tests failed: ${lastError.slice(0, 200)}`)
			}

			// ── Phase 6: Commit or Rollback ───────────────────────────────────
			if (testPassed) {
				try {
					await gitRun("add -A", projectPath)
					await gitRun(`commit -m "debug(auto): ${goal.slice(0, 60)}" --allow-empty`, projectPath)
					const commitHash = await gitRun("rev-parse --short HEAD", projectPath)
					sendNotification(
						chatId,
						"✅ Debug Complete",
						`Goal: ${goal}\nAttempts: ${attempt}\nCommit: \`${commitHash}\`\nBranch: \`${branch}\`\n\nTests passed. Review and merge when ready.`,
					)
					console.log(`${tag} Success. Commit: ${commitHash} on ${branch}`)
					return { success: true, branch, commit: commitHash, attempts: attempt }
				} catch (e) {
					console.log(`${tag} Commit failed: ${e.message}`)
					lastError = e.message
				}
			} else {
				sendNotification(
					chatId,
					`⏪ Rolling Back (attempt ${attempt})`,
					"Tests failed. Resetting for next attempt...",
				)
				try {
					await gitRun(`checkout ${defaultBranch}`, projectPath)
					await gitRun(`branch -D ${branch}`, projectPath)
					onDebugBranch = false
				} catch (e) {
					console.log(`${tag} Rollback failed: ${e.message}`)
				}
			}
		} catch (e) {
			console.error(`${tag} Attempt ${attempt} error:`, e.message)
			lastError = e.message
			if (onDebugBranch) {
				try {
					await gitRun(`checkout ${defaultBranch}`, projectPath)
					await gitRun(`branch -D ${branch}`, projectPath)
				} catch {}
			}
		}
	}

	sendNotification(
		chatId,
		"❌ Debug Failed",
		`Goal: ${goal}\nAttempts: ${MAX_ATTEMPTS}\nLast error: ${lastError || "Unknown"}\n\nAll attempts exhausted. Check logs for details.`,
	)
	console.log(`${tag} All ${MAX_ATTEMPTS} attempts failed`)
	return { success: false, attempts: MAX_ATTEMPTS, error: lastError }
}

module.exports = { runDebugJob }
