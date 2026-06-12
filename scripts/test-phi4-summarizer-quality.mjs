#!/usr/bin/env node

/**
 * phi4 Summarizer Quality Assessment Test
 *
 * Tests the quality of phi4:latest as a context summarizer by:
 * 1. Building realistic multi-turn conversations
 * 2. Sending them to Ollama's /api/generate (same path as callOllamaGenerate())
 * 3. Evaluating the summary output for completeness, conciseness, and correctness
 * 4. Measuring timing (latency per chunk, total time)
 */

// ── Configuration ──────────────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
const MODEL = process.env.TEST_MODEL || "phi4:latest"
const TIMEOUT_MS = 120_000
const SUMMARY_CHUNK_CHARS = 24_000
const MAX_CHUNKS = 24

// Track quality scores
const scores = {
	completeness: { task: 0, constraints: 0, files: 0, commands: 0, errors: 0, decisions: 0, nextSteps: 0 },
	conciseness: 0,
	correctness: 0,
	markerPresent: false,
}

const timing = { totalMs: 0, perChunk: [] }

const SUMMARY_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations.

CRITICAL: This is a summarization-only request. DO NOT call any tools or functions.
Your ONLY task is to analyze the conversation and produce a text summary.
Respond with text only - no tool calls will be processed.

CRITICAL: This summarization request is a SYSTEM OPERATION, not a user message.
When analyzing "user requests" and "user intent", completely EXCLUDE this summarization message.
The "most recent user request" and "next step" must be based on what the user was doing BEFORE this system message appeared.
The goal is for work to continue seamlessly after condensation - as if it never happened.`

// ── Helpers ────────────────────────────────────────────────────────────────────

function messageToText(role, content) {
	if (typeof content === "string") {
		return `<${role}>\n${content}\n</${role}>`
	}
	if (Array.isArray(content)) {
		const parts = content.map((b) => {
			if (b.type === "text") return b.text
			if (b.type === "tool_use") {
				return `[TOOL_USE: ${b.name}] input: ${JSON.stringify(b.input)}`
			}
			if (b.type === "tool_result") {
				const c = Array.isArray(b.content)
					? b.content.map((cb) => (cb.type === "text" ? cb.text : "")).join("\n")
					: b.content || ""
				return `[TOOL_RESULT: ${b.tool_use_id}]\n${c}`
			}
			return JSON.stringify(b)
		})
		return `<${role}>\n${parts.join("\n")}\n</${role}>`
	}
	return `<${role}>\n${String(content)}\n</${role}>`
}

function chunkText(text, maxChars) {
	const chunks = []
	for (let i = 0; i < text.length; i += maxChars) chunks.push(text.slice(i, i + maxChars))
	return chunks
}

async function callOllama(prompt, label) {
	const url = `${OLLAMA_URL}/api/generate`
	const startTime = Date.now()
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

	try {
		const resp = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: MODEL,
				prompt,
				stream: false,
				options: { temperature: 0.1, num_ctx: 32768 },
			}),
			signal: controller.signal,
		})
		if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
		const data = await resp.json()
		const elapsed = Date.now() - startTime
		timing.perChunk.push({ label, elapsedMs: elapsed })
		console.log(`  \u23f1  ${label}: ${elapsed}ms`)
		return (data.response || "").trim()
	} catch (err) {
		const elapsed = Date.now() - startTime
		timing.perChunk.push({ label, elapsedMs: elapsed, error: err.message })
		console.log(`  \u26d4 ${label} FAILED (${elapsed}ms): ${err.message}`)
		throw err
	} finally {
		clearTimeout(timeout)
	}
}

// ── Quality Analyzer ───────────────────────────────────────────────────────────

function analyzeSummary(summary, expected) {
	const findings = { passed: [], failed: [], warnings: [] }

	// 1. COMPACT_BRIEF_READY marker
	if (summary.includes("COMPACT_BRIEF_READY: true")) {
		findings.passed.push("COMPACT_BRIEF_READY marker present")
		scores.markerPresent = true
	} else {
		findings.warnings.push("COMPACT_BRIEF_READY marker missing (will be added by ensureCompactBriefMarker)")
	}

	// 2. Task preservation
	const taskWords = expected.task.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
	const foundTask = taskWords.filter((w) => summary.toLowerCase().includes(w))
	const taskRatio = foundTask.length / taskWords.length
	scores.completeness.task = taskRatio
	if (taskRatio >= 0.6) {
		findings.passed.push(`Task preserved (${Math.round(taskRatio * 100)}% of key terms)`)
	} else if (taskRatio >= 0.3) {
		findings.warnings.push(`Task partially preserved (${Math.round(taskRatio * 100)}% of key terms)`)
	} else {
		findings.failed.push(`Task poorly preserved (${Math.round(taskRatio * 100)}% of key terms)`)
	}

	// 3. File paths preserved
	const fileHits = expected.files.filter((f) => summary.includes(f))
	scores.completeness.files = fileHits.length / expected.files.length
	if (fileHits.length === expected.files.length) {
		findings.passed.push(`All ${expected.files.length} file paths preserved: ${fileHits.join(", ")}`)
	} else if (fileHits.length > 0) {
		findings.warnings.push(`${fileHits.length}/${expected.files.length} file paths preserved: ${fileHits.join(", ")}`)
	} else {
		findings.failed.push("No file paths preserved in summary")
	}

	// 4. Commands preserved
	const cmdHits = expected.commands.filter((c) => summary.includes(c))
	scores.completeness.commands = cmdHits.length / expected.commands.length
	if (cmdHits.length === expected.commands.length) {
		findings.passed.push(`All ${expected.commands.length} commands preserved`)
	} else if (cmdHits.length > expected.commands.length * 0.5) {
		findings.warnings.push(`${cmdHits.length}/${expected.commands.length} commands preserved`)
	} else {
		findings.warnings.push(`${cmdHits.length}/${expected.commands.length} commands preserved (may be fine if high-level)`)
	}

	// 5. Error mentions preserved
	const errHits = expected.errors.filter((e) => summary.toLowerCase().includes(e.toLowerCase()))
	scores.completeness.errors = expected.errors.length > 0 ? errHits.length / expected.errors.length : 1
	if (errHits.length > 0) {
		findings.passed.push(`Errors mentioned: ${errHits.join(", ")}`)
	} else if (expected.errors.length === 0) {
		findings.passed.push("No errors to report")
	} else {
		findings.warnings.push(`Expected errors not found: ${expected.errors.join(", ")}`)
	}

	// 6. Constraint preservation
	const constraintHits = expected.constraints.filter((c) => summary.toLowerCase().includes(c.toLowerCase()))
	scores.completeness.constraints = constraintHits.length / expected.constraints.length
	if (constraintHits.length >= expected.constraints.length * 0.5) {
		findings.passed.push(`${constraintHits.length}/${expected.constraints.length} constraints preserved`)
	} else if (constraintHits.length > 0) {
		findings.warnings.push(`${constraintHits.length}/${expected.constraints.length} constraints preserved`)
	} else {
		findings.warnings.push("No explicit constraints found in summary")
	}

	// 7. Decision preservation
	const decisionHits = expected.decisions.filter((d) => summary.toLowerCase().includes(d.toLowerCase()))
	scores.completeness.decisions = decisionHits.length / expected.decisions.length
	if (decisionHits.length >= expected.decisions.length * 0.5) {
		findings.passed.push(`${decisionHits.length}/${expected.decisions.length} decisions preserved`)
	} else {
		findings.warnings.push(`${decisionHits.length}/${expected.decisions.length} decisions found`)
	}

	// 8. Next steps
	const nextHits = expected.nextSteps.filter((n) => summary.toLowerCase().includes(n.toLowerCase()))
	scores.completeness.nextSteps = nextHits.length / expected.nextSteps.length
	if (nextHits.length >= expected.nextSteps.length * 0.5) {
		findings.passed.push(`${nextHits.length}/${expected.nextSteps.length} next steps preserved`)
	} else {
		findings.warnings.push(`${nextHits.length}/${expected.nextSteps.length} next steps found`)
	}

	// 9. Conciseness
	const wordCount = summary.split(/\s+/).length
	const lineCount = summary.split("\n").length
	const charCount = summary.length
	if (wordCount < 50) {
		findings.warnings.push(`Summary may be too concise (${wordCount} words, ${lineCount} lines)`)
	} else if (wordCount > 1500) {
		findings.warnings.push(`Summary may be too verbose (${wordCount} words, ${lineCount} lines)`)
	} else {
		findings.passed.push(`Summary length reasonable (${wordCount} words, ${lineCount} lines, ${charCount} chars)`)
	}
	scores.conciseness = wordCount

	// 10. Hallucination check
	const hallucinationWords = ["fake", "placeholder", "example.com", "/nonexistent/", "todo:", "TBD"]
	const hallucinationHits = hallucinationWords.filter((h) => summary.toLowerCase().includes(h))
	if (hallucinationHits.length === 0) {
		findings.passed.push("No hallucinated placeholder content detected")
	} else {
		findings.failed.push(`Possible hallucinated content: ${hallucinationHits.join(", ")}`)
	}

	return findings
}

function printScorecard() {
	console.log("\n" + "=".repeat(66))
	console.log("PHI4 SUMMARIZER QUALITY SCORECARD")
	console.log("=".repeat(66))

	const compVals = Object.values(scores.completeness)
	const avgCompleteness = (compVals.reduce((a, b) => a + b, 0) / compVals.length) * 100

	console.log(`\nCompleteness:         ${avgCompleteness.toFixed(1)}%`)
	console.log(`  Task preservation:    ${(scores.completeness.task * 100).toFixed(0)}%`)
	console.log(`  Files preserved:      ${(scores.completeness.files * 100).toFixed(0)}%`)
	console.log(`  Commands preserved:   ${(scores.completeness.commands * 100).toFixed(0)}%`)
	console.log(`  Errors captured:      ${(scores.completeness.errors * 100).toFixed(0)}%`)
	console.log(`  Constraints kept:     ${(scores.completeness.constraints * 100).toFixed(0)}%`)
	console.log(`  Decisions kept:       ${(scores.completeness.decisions * 100).toFixed(0)}%`)
	console.log(`  Next steps kept:      ${(scores.completeness.nextSteps * 100).toFixed(0)}%`)
	console.log(`\nConciseness:          ${scores.conciseness} words`)
	console.log(`COMPACT_BRIEF_READY:   ${scores.markerPresent ? "Present" : "Missing"}`)

	const totalMs = timing.totalMs
	console.log(`\nTiming:`)
	for (const t of timing.perChunk) {
		const status = t.error ? "\u26d4" : "\u23f1"
		console.log(`  ${status} ${t.label}: ${t.elapsedMs}ms${t.error ? ` (${t.error})` : ""}`)
	}
	console.log(`  Total: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`)

	const overallQual = avgCompleteness * 0.5 + (scores.markerPresent ? 15 : 0) + Math.min(scores.conciseness / 10, 15)
	console.log(`\nOVERALL QUALITY: ${Math.min(overallQual, 100).toFixed(0)}/100`)
	console.log("=".repeat(66))
}

// ── Test Cases ─────────────────────────────────────────────────────────────────

function t(text) { return { type: "text", text } }
function tu(id, name, input) { return { type: "tool_use", name, input } }
function tr(id, content) { return { type: "tool_result", tool_use_id: id, content: [{ type: "text", text: content }] } }

const TEST_CASES = [
	{
		name: "Coding Session: API Endpoint Implementation",
		expected: {
			task: "implement a new REST API endpoint for user profile management with validation",
			files: ["src/api/users.ts", "src/validation/schemas.ts", "src/types/user.ts"],
			commands: ["npm run test", "npx eslint src/api/users.ts", "git add ."],
			errors: ["TypeError", "validation failed"],
			constraints: ["TypeScript", "Express", "JWT auth"],
			decisions: ["POST /api/users", "zod validation"],
			nextSteps: ["test coverage", "integration tests"],
		},
		conversation: [
			{ role: "user", content: "Implement a new REST API endpoint for user profile management with validation" },
			{
				role: "assistant",
				content: [
					t("I'll create the user profile API endpoint. Let me start by examining the existing code structure."),
					tu("tu1", "read_file", { path: "src/api/users.ts" }),
				],
			},
			{
				role: "user",
				content: [tr("tu1", "// existing user route stubs\nimport { Router } from 'express';\nconst router = Router();\nexport default router;")],
			},
			{
				role: "assistant",
				content: [
					t("I see the stubs. Let me also check the validation schemas and types."),
					tu("tu2", "read_file", { path: "src/validation/schemas.ts" }),
					tu("tu3", "read_file", { path: "src/types/user.ts" }),
				],
			},
			{
				role: "user",
				content: [
					tr("tu2", "// validation schemas\nexport const userSchema = { name: 'string', email: 'string' };"),
					tr("tu3", "// user types\nexport interface User { id: string; name: string; email: string; }"),
				],
			},
			{
				role: "assistant",
				content: [
					t("Now I'll implement the full endpoint with JWT auth, zod validation, and POST /api/users route."),
					tu("tu4", "write_to_file", { path: "src/api/users.ts", content: "full user API implementation with zod validation and JWT auth middleware" }),
				],
			},
			{
				role: "user",
				content: [tr("tu4", "File written successfully to src/api/users.ts")],
			},
			{
				role: "assistant",
				content: [
					t("Now let me verify the code compiles and passes linting."),
					tu("tu5", "execute_command", { command: "npx eslint src/api/users.ts" }),
				],
			},
			{
				role: "user",
				content: [tr("tu5", "Lint passed with no errors")],
			},
			{
				role: "assistant",
				content: [
					t("Good. Now let me run the tests to check for regressions."),
					tu("tu6", "execute_command", { command: "npm run test" }),
				],
			},
			{
				role: "user",
				content: [tr("tu6", "TypeError: Cannot read properties of undefined (reading 'parse')\n  at src/api/users.ts:12:38\n  FAIL  tests/api/users.test.ts (5.2s)\n  tests: should create a user with valid data (124ms)")],
			},
			{
				role: "assistant",
				content: [
					t("There's a TypeError - the zod schema isn't being imported correctly. Let me fix the import."),
					tu("tu7", "apply_diff", { path: "src/api/users.ts", diff: "Fix zod import and add proper error handling" }),
				],
			},
			{
				role: "user",
				content: "Make sure to use TypeScript strict mode throughout and add proper JWT auth middleware.",
			},
			{
				role: "assistant",
				content: [
					t("Adding JWT auth middleware and ensuring strict TypeScript mode. Let me also write the integration tests."),
					tu("tu8", "execute_command", { command: "git add ." }),
				],
			},
		],
	},
	{
		name: "Debug Session: Database Connection Leak",
		expected: {
			task: "fix database connection leak causing high memory usage in production",
			files: ["src/db/connection.ts", "src/middleware/db.ts", "docker-compose.yml"],
			commands: ["docker-compose logs", "kubectl get pods", "node --inspect"],
			errors: ["ETIMEDOUT", "too many connections", "max_connections"],
			constraints: ["PostgreSQL", "production", "connection pooling"],
			decisions: ["pg-pool", "connection limit"],
			nextSteps: ["monitor", "load test"],
		},
		conversation: [
			{ role: "user", content: "Fix database connection leak causing high memory usage in production. The app keeps hitting max_connections." },
			{
				role: "assistant",
				content: [
					t("Let me investigate the database connection handling code."),
					tu("td1", "read_file", { path: "src/db/connection.ts" }),
					tu("td2", "read_file", { path: "src/middleware/db.ts" }),
				],
			},
			{
				role: "user",
				content: [
					tr("td1", "// connection.ts\nimport { Pool } from 'pg';\nconst pool = new Pool({ max: 10 });\nexport async function query(text, params) {\n  const client = await pool.connect();\n  try { return await client.query(text, params); }\n  finally { client.release(); }\n}"),
					tr("td2", "// middleware/db.ts\nimport { query } from '../db/connection';\nexport async function dbMiddleware(req, res, next) {\n  req.db = { query };\n  next();\n}"),
				],
			},
			{
				role: "assistant",
				content: [
					t("The connection code looks correct at first glance. Let me check docker-compose and see if there's a pool limit issue."),
					tu("td3", "read_file", { path: "docker-compose.yml" }),
				],
			},
			{
				role: "user",
				content: [tr("td3", "services:\n  app:\n    environment:\n      DATABASE_URL: postgresql://user:pass@db:5432/app\n      PGPOOL_MAX: 20\n  db:\n    image: postgres:15\n    environment:\n      POSTGRES_MAX_CONNECTIONS: 25")],
			},
			{
				role: "assistant",
				content: [
					t("Found it! The pool max is 10 in code but PGPOOL_MAX is 20 in env. And the DB max_connections is 25. But let me check if there are other places creating connections."),
					tu("td4", "execute_command", { command: "docker-compose logs app | grep -i 'connect|pool'" }),
				],
			},
			{
				role: "user",
				content: [tr("td4", "Error: ETIMEDOUT connecting to database\nWarning: too many connections - retrying in 1s\nFATAL: sorry, too many clients already")],
			},
			{
				role: "assistant",
				content: [
					t("Confirmed - there's a connection leak. The issue is multiple Node.js instances each creating their own pool. I need to enforce a singleton pool pattern and add proper connection limits."),
					tu("td5", "write_to_file", { path: "src/db/connection.ts", content: "singleton pool with connection timeout 5000ms and idle timeout 30000ms" }),
				],
			},
			{
				role: "user",
				content: [tr("td5", "File written")],
			},
			{
				role: "assistant",
				content: [
					t("Now let me verify the fix and check memory usage."),
					tu("td6", "execute_command", { command: "node --inspect -e \"require('./src/db/connection').query('SELECT 1')\"" }),
				],
			},
			{
				role: "user",
				content: "Make sure this fix handles the production max_connections limit properly. We have 25 max connections on the database.",
			},
		],
	},
	{
		name: "Refactor Session: Monorepo Migration",
		expected: {
			task: "migrate the project to a monorepo structure using Turborepo",
			files: ["turbo.json", "packages/shared/package.json", ".npmrc"],
			commands: ["npx turbo build", "npm run lint", "node scripts/migrate.mjs"],
			errors: ["ERR_PNPM_NO_IMPORTER"],
			constraints: ["Turborepo", "pnpm workspaces", "TypeScript project references"],
			decisions: ["pnpm", "npm workspaces"],
			nextSteps: ["CI pipeline", "publish packages"],
		},
		conversation: [
			{ role: "user", content: "Migrate the project to a monorepo structure using Turborepo. We need shared packages for types and utilities." },
			{
				role: "assistant",
				content: [
					t("I'll start by analyzing the current project structure and then migrate to Turborepo."),
					tu("tm1", "execute_command", { command: "ls -la && cat package.json" }),
				],
			},
			{
				role: "user",
				content: [tr("tm1", 'package.json: {"name": "my-app", "dependencies": {"shared-types": "^1.0.0"}}')],
			},
			{
				role: "assistant",
				content: [
					t("I'll create the Turborepo structure. First, the root config files and shared package."),
					tu("tm2", "write_to_file", { path: "turbo.json", content: "Turborepo pipeline config with build, lint, test" }),
					tu("tm3", "write_to_file", { path: "packages/shared/package.json", content: '{"name":"@myapp/shared","version":"0.0.0","main":"src/index.ts","types":"src/index.ts"}' }),
				],
			},
			{
				role: "user",
				content: [tr("tm2", "File written to turbo.json"), tr("tm3", "File written to packages/shared/package.json")],
			},
			{
				role: "assistant",
				content: [
					t("Now let me configure .npmrc for pnpm workspaces and try building."),
					tu("tm4", "write_to_file", { path: ".npmrc", content: "shamefully-hoist=true\nstrict-peer-dependencies=false" }),
					tu("tm5", "execute_command", { command: "npx turbo build" }),
				],
			},
			{
				role: "user",
				content: [tr("tm5", "ERR_PNPM_NO_IMPORTER: No importer found for @myapp/shared")],
			},
			{
				role: "assistant",
				content: [
					t("The pnpm workspace config is missing. I need to add pnpm-workspace.yaml and update root package.json."),
					tu("tm6", "write_to_file", { path: "pnpm-workspace.yaml", content: "packages:\n  - \"packages/*\"\n  - \"apps/*\"" }),
				],
			},
			{
				role: "user",
				content: "We decided to use npm workspaces instead of pnpm. Update the config accordingly.",
			},
		],
	},
]

// ── Main Test Runner ───────────────────────────────────────────────────────────

async function main() {
	console.log("=".repeat(66))
	console.log("PHI4 SUMMARIZER QUALITY ASSESSMENT")
	console.log("=".repeat(66))
	console.log(`\nModel: ${MODEL}`)
	console.log(`Ollama: ${OLLAMA_URL}`)
	console.log(`Timeout: ${TIMEOUT_MS}ms`)
	console.log(`Chunk size: ${SUMMARY_CHUNK_CHARS} chars, max ${MAX_CHUNKS} chunks\n`)

	// Verify Ollama connectivity
	try {
		const resp = await fetch(`${OLLAMA_URL}/api/tags`)
		const data = await resp.json()
		const models = (data.models || []).map((m) => m.name)
		console.log(`Ollama reachable at ${OLLAMA_URL}`)
		console.log(`Models available: ${models.join(", ")}`)
		if (!models.some((m) => m.startsWith(MODEL.split(":")[0]))) {
			console.error(`Model ${MODEL} not found in Ollama! Available: ${models.join(", ")}`)
			process.exit(1)
		}
	} catch (err) {
		console.error(`Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}`)
		console.error("  Make sure Ollama is running locally.")
		process.exit(1)
	}

	let allPassed = 0
	let allFailed = 0
	let allWarnings = 0

	for (let testIdx = 0; testIdx < TEST_CASES.length; testIdx++) {
		const testCase = TEST_CASES[testIdx]
		console.log("\n" + "-".repeat(66))
		console.log(`TEST ${testIdx + 1}: ${testCase.name}`)
		console.log("-".repeat(66))

		const messages = testCase.conversation
		const transcript = messages.map((m) => messageToText(m.role, m.content)).join("\n\n")
		const chunks = chunkText(transcript, SUMMARY_CHUNK_CHARS).slice(0, MAX_CHUNKS)

		console.log(`  Messages: ${messages.length}`)
		console.log(`  Transcript: ${transcript.length} chars`)
		console.log(`  Chunks: ${chunks.length}`)

		const overallStart = Date.now()

		try {
			const partialSummaries = []
			for (let i = 0; i < chunks.length; i++) {
				const prompt = `${SUMMARY_PROMPT}\n\nUse ${MODEL} as a local pre-thinker rescue summarizer.\nSummarize chunk ${i + 1} of ${chunks.length}. Preserve current task goal, user constraints, files changed, commands run, errors, unresolved decisions, and next action.\n\nCondense instructions:\nN/A\n\nConversation chunk:\n${chunks[i]}`

				const partial = await callOllama(prompt, `Chunk ${i + 1}/${chunks.length}`)
				partialSummaries.push(partial)
			}

			let finalSummary
			if (partialSummaries.length === 1) {
				finalSummary = partialSummaries[0]
			} else {
				const mergePrompt = `${SUMMARY_PROMPT}\n\nMerge these chunk summaries into one compact continuation brief.\nKeep concrete file paths, commands, errors, decisions, and next steps. Omit repetition.\n\n${partialSummaries.map((s, i) => `## Chunk ${i + 1}\n${s}`).join("\n\n")}`
				finalSummary = await callOllama(mergePrompt, `Merge ${partialSummaries.length} chunks`)
			}

			// Add marker if missing
			if (!finalSummary.includes("COMPACT_BRIEF_READY: true")) {
				finalSummary = `COMPACT_BRIEF_READY: true\n\n## Compact Continuation Brief\n\n${finalSummary}`
			}

			timing.totalMs = Date.now() - overallStart

			console.log(`\nSUMMARY OUTPUT:`)
			console.log("-".repeat(40))
			console.log(finalSummary)
			console.log("-".repeat(40))

			// Analyze quality
			const findings = analyzeSummary(finalSummary, testCase.expected)

			console.log(`\nQUALITY ANALYSIS:`)
			for (const p of findings.passed) console.log(`  [PASS] ${p}`)
			for (const w of findings.warnings) {
				console.log(`  [WARN] ${w}`)
				allWarnings++
			}
			for (const f of findings.failed) {
				console.log(`  [FAIL] ${f}`)
				allFailed++
			}
			allPassed += findings.passed.length

			console.log(`\n  Summary: ${findings.passed.length} passed, ${findings.warnings.length} warnings, ${findings.failed.length} failed`)
		} catch (err) {
			console.error(`\nTEST FAILED: ${err.message}`)
			allFailed++
		}
	}

	printScorecard()

	// Final verdict
	console.log(`\nFINAL VERDICT:`)
	console.log(`  Tests: ${TEST_CASES.length}`)
	console.log(`  Checks: ${allPassed} passed, ${allWarnings} warnings, ${allFailed} failed`)
	if (allFailed === 0 && allWarnings <= allPassed * 0.3) {
		console.log(`\nOVERALL: phi4 summarizer quality PASSES`)
	} else if (allFailed === 0) {
		console.log(`\nOVERALL: phi4 summarizer quality ACCEPTABLE (${allWarnings} warnings)`)
	} else {
		console.log(`\nOVERALL: phi4 summarizer quality NEEDS IMPROVEMENT (${allFailed} checks failed)`)
	}
}

main().catch((err) => {
	console.error("Fatal error:", err)
	process.exit(1)
})
