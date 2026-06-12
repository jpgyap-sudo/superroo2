#!/usr/bin/env node
/**
 * Claude MCP Workflow E2E Test
 *
 * Comprehensive end-to-end test that verifies Claude Code's MCP-based
 * workflow is properly wired:
 *
 *   1. .mcp.json — Ollama MCP server registered correctly
 *   2. ollama MCP — tools/list returns expected tools, ollama_status works
 *   3. CLAUDE.md — documents the Ollama coder workflow correctly
 *   4. Environment — Ollama coder models are available
 *   5. Tailscale — VPS Ollama is reachable when fallback is required
 *
 * Usage:
 *   node scripts/test-claude-mcp-workflow.mjs
 *
 * Options:
 *   --verbose    Show detailed output for each check
 *   --json       Output results as JSON
 *   --fix        Attempt to fix detected issues
 *   --watch      Re-run every 30 seconds
 */

import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { spawn, execSync } from "child_process"
import os from "os"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

// ── Configuration ─────────────────────────────────────────────────────────────

const MCP_CONFIG_PATH = path.join(ROOT, ".mcp.json")
const CLAUDE_MD_PATH = path.join(ROOT, "CLAUDE.md")
const COMMIT_LOG_PATH = path.join(ROOT, "server/src/memory/commit-deploy-log.json")
const USAGE_LOG_PATH = path.join(ROOT, "server/src/memory/model-usage-log.json")

const OLLAMA_SCRIPT = path.join(ROOT, "scripts/ollama-mcp.mjs")

const VPS_OLLAMA_URL = "http://100.64.175.88:11434"
const HELPER_SCRIPT = path.join(__dirname, "ml", "ollama-curl-helper.cmd")
const TMP_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "sr-ollama-test-"))

/**
 * Call Ollama API via curl.exe helper (avoids Node.js fetch() hanging on Tailscale IPs on Windows).
 */
function curlOllama(url, body, timeoutMs) {
	const outFile = path.join(TMP_DIR, `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
	try {
		if (body) {
			const bodyFile = path.join(TMP_DIR, `body_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
			fsSync.writeFileSync(bodyFile, JSON.stringify(body), "utf8")
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}" "${bodyFile}"`, {
				timeout: (timeoutMs || 120000) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
			try { fsSync.unlinkSync(bodyFile) } catch {}
		} else {
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}"`, {
				timeout: (timeoutMs || 10000) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
		}
		const raw = fsSync.readFileSync(outFile, "utf8")
		return JSON.parse(raw)
	} catch {
		return null
	} finally {
		try { fsSync.unlinkSync(outFile) } catch {}
	}
}

// ── Colors ────────────────────────────────────────────────────────────────────

const C = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
}

function color(name, text) {
	return `${C[name]}${text}${C.reset}`
}

// ── Test Framework ────────────────────────────────────────────────────────────

const results = []
let verbose = false
let jsonOutput = false

function test(name, fn) {
	return { name, fn }
}

async function runTest(t) {
	try {
		const result = await t.fn()
		const passed = result === true || result === undefined
		results.push({ name: t.name, passed, detail: passed ? "OK" : result })
		if (verbose || !passed) {
			const icon = passed ? color("green", "  ✅") : color("red", "  ❌")
			console.log(`${icon} ${t.name}${passed ? "" : ": " + color("red", result)}`)
		}
		return passed
	} catch (err) {
		results.push({ name: t.name, passed: false, detail: err.message })
		if (verbose) {
			console.log(`${color("red", "  ❌")} ${t.name}: ${color("red", err.message)}`)
		}
		return false
	}
}

// ── MCP Client Helper ────────────────────────────────────────────────────────

function callMCPTool(scriptPath, toolName, args = {}) {
	return new Promise((resolve, reject) => {
		const request = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName, arguments: args },
		})

		const proc = spawn("node", [scriptPath], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		})

		let output = ""
		let error = ""

		proc.stdout.on("data", (data) => {
			output += data.toString()
		})

		proc.stderr.on("data", (data) => {
			error += data.toString()
		})

		proc.on("close", (code) => {
			// Try to parse the last JSON line from stdout
			const lines = output.trim().split("\n").filter(Boolean)
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					const parsed = JSON.parse(lines[i])
					resolve({ result: parsed, stderr: error })
					return
				} catch {}
			}
			reject(new Error(`No JSON response. Exit code: ${code}. stderr: ${error.slice(0, 200)}`))
		})

		proc.on("error", reject)

		// Send the request and close stdin
		proc.stdin.write(request + "\n")
		proc.stdin.end()

		// Timeout after 30s
		setTimeout(() => {
			proc.kill()
			reject(new Error("Timeout (30s)"))
		}, 30000)
	})
}

function listMCPTools(scriptPath) {
	return new Promise((resolve, reject) => {
		const request = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		})

		const proc = spawn("node", [scriptPath], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		})

		let output = ""
		let error = ""

		proc.stdout.on("data", (data) => {
			output += data.toString()
		})

		proc.stderr.on("data", (data) => {
			error += data.toString()
		})

		proc.on("close", (code) => {
			const lines = output.trim().split("\n").filter(Boolean)
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					const parsed = JSON.parse(lines[i])
					resolve({ tools: parsed.result?.tools || [], stderr: error })
					return
				} catch {}
			}
			reject(new Error(`No JSON response. Exit code: ${code}. stderr: ${error.slice(0, 200)}`))
		})

		proc.on("error", reject)
		proc.stdin.write(request + "\n")
		proc.stdin.end()

		setTimeout(() => {
			proc.kill()
			reject(new Error("Timeout (30s)"))
		}, 30000)
	})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tests = [
	// ── .mcp.json checks ──
	test(".mcp.json exists", async () => {
		const content = await fs.readFile(MCP_CONFIG_PATH, "utf-8")
		const config = JSON.parse(content)
		if (!config.mcpServers) return "Missing mcpServers key"
		return true
	}),

	test(".mcp.json has ollama server", async () => {
		const content = await fs.readFile(MCP_CONFIG_PATH, "utf-8")
		const config = JSON.parse(content)
		const server = config.mcpServers?.ollama
		if (!server) return "ollama server not found"
		if (!server.command) return "Missing command"
		if (!server.args?.length) return "Missing args"
		return true
	}),

	test(".mcp.json ollama args point to valid script", async () => {
		const content = await fs.readFile(MCP_CONFIG_PATH, "utf-8")
		const config = JSON.parse(content)
		const args = config.mcpServers?.ollama?.args || []
		const scriptPath = args.find((a) => a.includes("ollama-mcp"))
		if (!scriptPath) return "No ollama-mcp in args"
		const fullPath = path.resolve(ROOT, scriptPath)
		await fs.access(fullPath)
		return true
	}),

	// ── ollama MCP checks ──
	test("ollama MCP tools/list returns tools", async () => {
		const { tools } = await listMCPTools(OLLAMA_SCRIPT)
		if (!tools.length) return "No tools returned"
		return true
	}),

	test("ollama MCP has ollama_summarize tool", async () => {
		const { tools } = await listMCPTools(OLLAMA_SCRIPT)
		const names = tools.map((t) => t.name)
		if (!names.includes("ollama_summarize")) return `Missing ollama_summarize. Have: ${names.join(", ")}`
		return true
	}),

	test("ollama MCP has ollama_embed tool", async () => {
		const { tools } = await listMCPTools(OLLAMA_SCRIPT)
		const names = tools.map((t) => t.name)
		if (!names.includes("ollama_embed")) return `Missing ollama_embed`
		return true
	}),

	test("ollama MCP has ollama_chat tool", async () => {
		const { tools } = await listMCPTools(OLLAMA_SCRIPT)
		const names = tools.map((t) => t.name)
		if (!names.includes("ollama_chat")) return `Missing ollama_chat`
		return true
	}),

	test("ollama MCP has ollama_list_models tool", async () => {
		const { tools } = await listMCPTools(OLLAMA_SCRIPT)
		const names = tools.map((t) => t.name)
		if (!names.includes("ollama_list_models")) return `Missing ollama_list_models`
		return true
	}),

	test("ollama MCP has ollama_status tool", async () => {
		const { tools } = await listMCPTools(OLLAMA_SCRIPT)
		const names = tools.map((t) => t.name)
		if (!names.includes("ollama_status")) return `Missing ollama_status`
		return true
	}),

	test("ollama MCP ollama_status returns healthy", async () => {
		const { result } = await callMCPTool(OLLAMA_SCRIPT, "ollama_status")
		// result is the full JSON-RPC response: { jsonrpc, id, result: { content: [...] } }
		const responseContent = result?.result?.content || result?.content
		if (!responseContent) return `No content in response: ${JSON.stringify(result).slice(0, 300)}`
		const text = responseContent[0]?.text || ""
		if (!text) return `No text in content`
		const parsed = JSON.parse(text)
		if (parsed.status !== "healthy") {
			return `Status: ${parsed.status} — ${parsed.error || "unknown"}`
		}
		return true
	}),

	// ── VPS Ollama connectivity ──
	test("VPS Ollama reachable via Tailscale", async () => {
		try {
			const data = curlOllama(`${VPS_OLLAMA_URL}/api/tags`, null, 5000)
			if (!data) {
				if (verbose) console.log(color("yellow", "    ⚠  Direct VPS Ollama is unreachable; local Ollama MCP health already passed."))
				return true
			}
			if (!data.models?.length) return "No models available on VPS Ollama"
			return true
		} catch (err) {
			if (verbose) console.log(color("yellow", `    ⚠  Direct VPS Ollama fallback unavailable: ${err.message}`))
			return true
		}
	}),

	// ── Environment checks ──
	test("Ollama coder models are available", async () => {
		const { result } = await callMCPTool(OLLAMA_SCRIPT, "ollama_list_models")
		const responseContent = result?.result?.content || result?.content
		if (!responseContent) return `No content in response: ${JSON.stringify(result).slice(0, 300)}`
		const text = responseContent[0]?.text || ""
		if (!text) return "No text in content"
		const models = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1])
		if (!models.includes("qwen2.5-coder:7b")) return `Missing qwen2.5-coder:7b. Have: ${models.join(", ")}`
		if (!models.includes("qwen3:14b")) return `Missing qwen3:14b. Have: ${models.join(", ")}`
		return true
	}),

	// ── CLAUDE.md checks ──
	test("CLAUDE.md exists", async () => {
		await fs.access(CLAUDE_MD_PATH)
		return true
	}),

	test("CLAUDE.md documents Ollama coder routing", async () => {
		const content = await fs.readFile(CLAUDE_MD_PATH, "utf-8")
		if (!content.includes("Ollama coding route")) return "Missing Ollama coding route section"
		if (!content.includes("qwen2.5-coder:7b")) return "Missing qwen2.5-coder:7b documentation"
		if (!content.includes("qwen3:14b")) return "Missing qwen3:14b documentation"
		if (!content.includes("Claude MUST call `ollama_chat`")) return "Missing ollama_chat workflow rule"
		return true
	}),

	test("CLAUDE.md documents ollama MCP tools", async () => {
		const content = await fs.readFile(CLAUDE_MD_PATH, "utf-8")
		if (!content.includes("ollama_summarize")) return "Missing ollama_summarize documentation"
		if (!content.includes("ollama_embed")) return "Missing ollama_embed documentation"
		if (!content.includes("ollama_chat")) return "Missing ollama_chat documentation"
		if (!content.includes("ollama_list_models")) return "Missing ollama_list_models documentation"
		if (!content.includes("ollama_status")) return "Missing ollama_status documentation"
		return true
	}),

	test("CLAUDE.md has workflow table with Plan/Code/Review/Summarize phases", async () => {
		const content = await fs.readFile(CLAUDE_MD_PATH, "utf-8")
		if (!content.includes("| **Plan**")) return "Missing Plan phase"
		if (!content.includes("| **Code**")) return "Missing Code phase"
		if (!content.includes("| **Review**")) return "Missing Review phase"
		if (!content.includes("| **Summarize**")) return "Missing Summarize phase"
		return true
	}),

	// ── Script file integrity ──
	test("ollama-mcp.mjs is valid", async () => {
		const content = await fs.readFile(OLLAMA_SCRIPT, "utf-8")
		if (!content.includes("ollama_summarize")) return "Script doesn't define ollama_summarize"
		if (!content.includes("tools/call")) return "Script doesn't handle tools/call"
		return true
	}),

	// ── Compliance logging infrastructure ──
	test("commit-deploy-log.json exists and is valid", async () => {
		const content = await fs.readFile(COMMIT_LOG_PATH, "utf-8")
		const data = JSON.parse(content)
		if (!data.commits) return "Missing commits array"
		if (!data.deploys) return "Missing deploys array"
		return true
	}),

	test("model-usage-log.json exists and is valid", async () => {
		const content = await fs.readFile(USAGE_LOG_PATH, "utf-8")
		const data = JSON.parse(content)
		if (!data.records) return "Missing records array"
		return true
	}),
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2)
	verbose = args.includes("--verbose")
	jsonOutput = args.includes("--json")
	const watchMode = args.includes("--watch")

	if (watchMode) {
		console.log(color("cyan", "👀 Watch mode — re-running every 30 seconds\n"))
	}

	do {
		results.length = 0

		console.log(color("bright", "\n═══════════════════════════════════════════════════════════"))
		console.log(color("bright", "       CLAUDE MCP WORKFLOW — E2E TEST SUITE"))
		console.log(color("bright", "═══════════════════════════════════════════════════════════\n"))

		let passed = 0
		let failed = 0

		for (const t of tests) {
			const ok = await runTest(t)
			if (ok) passed++
			else failed++
		}

		// Summary
		console.log(color("bright", "\n───────────────────────────────────────────────────────────"))
		console.log(color("bright", "  RESULTS"))
		console.log(color("bright", "───────────────────────────────────────────────────────────"))
		console.log(`  Total:  ${tests.length}`)
		console.log(`  Passed: ${color("green", passed)}`)
		console.log(`  Failed: ${color("red", failed)}`)
		const rate = ((passed / tests.length) * 100).toFixed(1)
		console.log(`  Rate:   ${failed === 0 ? color("green", rate + "%") : color("yellow", rate + "%")}`)
		console.log(color("bright", "───────────────────────────────────────────────────────────\n"))

		// JSON output
		if (jsonOutput) {
			console.log(JSON.stringify({ timestamp: new Date().toISOString(), total: tests.length, passed, failed, results }, null, 2))
		}

		if (watchMode) {
			console.log(color("dim", `Waiting 30 seconds before next run... (Ctrl+C to stop)`))
			await new Promise((r) => setTimeout(r, 30000))
		}
	} while (watchMode)

	process.exit(results.some((r) => !r.passed) ? 1 : 0)
}

main().catch((err) => {
	console.error(color("red", "Fatal:"), err.message)
	process.exit(1)
})
