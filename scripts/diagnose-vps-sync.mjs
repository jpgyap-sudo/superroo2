#!/usr/bin/env node
/**
 * diagnose-vps-sync.mjs — Test each VPS endpoint independently
 *
 * Tests connectivity and health of all VPS sync endpoints with detailed reporting.
 *
 * Usage:
 *   node scripts/diagnose-vps-sync.mjs              # Full diagnostics
 *   node scripts/diagnose-vps-sync.mjs --status     # Quick status check
 *   node scripts/diagnose-vps-sync.mjs --json       # JSON output for automation
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")

const API_URL = process.env.SUPERROO_API_URL || "https://dev.abcx124.xyz/api"
const ENDPOINTS = [
	{ name: "Lessons Sync", url: `${API_URL}/lessons/sync`, method: "POST" },
	{ name: "Memory Store", url: `${API_URL}/memory/store`, method: "POST" },
	{ name: "Health Check", url: `${API_URL}/health`, method: "GET" },
	{ name: "Lessons Query", url: `${API_URL}/lessons/query?q=test`, method: "GET" },
	{ name: "MCP Status", url: `${API_URL}/mcp/status`, method: "GET" },
]

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes("--status")
const JSON_OUTPUT = args.includes("--json")
const TIMEOUT_MS = 5000

async function testEndpoint(endpoint) {
	const result = {
		name: endpoint.name,
		url: endpoint.url,
		method: endpoint.method,
		status: "unknown",
		statusCode: null,
		responseTime: 0,
		error: null,
	}

	try {
		const start = Date.now()
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

		const response = await fetch(endpoint.url, {
			method: endpoint.method,
			headers: { "Content-Type": "application/json" },
			body: endpoint.method === "POST" ? JSON.stringify({ test: true, timestamp: Date.now() }) : undefined,
			signal: controller.signal,
		})

		clearTimeout(timeout)
		result.responseTime = Date.now() - start
		result.statusCode = response.status
		result.status = response.ok ? "ok" : "error"

		if (!response.ok) {
			const text = await response.text().catch(() => "")
			result.error = text.slice(0, 200) || "HTTP error"
		}
	} catch (err) {
		result.status = "failed"
		result.error = err.name === "AbortError" ? `Timeout after ${TIMEOUT_MS}ms` : err.message
	}

	return result
}

async function runDiagnostics() {
	const results = []

	for (const endpoint of ENDPOINTS) {
		const result = await testEndpoint(endpoint)
		results.push(result)

		if (JSON_OUTPUT) continue

		const statusIcon = result.status === "ok" ? "✅" : result.status === "error" ? "⚠️" : "❌"
		console.log(`${statusIcon} ${result.name}`)
		console.log(`   ${result.method} ${result.url}`)
		console.log(`   Status: ${result.statusCode || result.status} (${result.responseTime}ms)`)
		if (result.error) {
			console.log(`   Error: ${result.error}`)
		}
	}

	if (JSON_OUTPUT) {
		console.log(JSON.stringify({
			timestamp: new Date().toISOString(),
			endpoints: results,
			summary: {
				total: results.length,
				ok: results.filter(r => r.status === "ok").length,
				error: results.filter(r => r.status === "error").length,
				failed: results.filter(r => r.status === "failed").length,
			}
		}, null, 2))
	}

	return results
}

function showStatus(results) {
	const ok = results.filter(r => r.status === "ok").length
	const total = results.length
	const stateFile = path.join(ROOT, "memory", ".vps-diagnose.json")

	console.log("=== VPS Sync Health ===")
	console.log(`Endpoints: ${ok}/${total} healthy`)
	console.log(`Last check: ${new Date().toISOString()}`)

	fs.mkdirSync(path.dirname(stateFile), { recursive: true })
	fs.writeFileSync(stateFile, JSON.stringify({
		timestamp: new Date().toISOString(),
		results,
		healthy: ok === total,
	}, null, 2), "utf8")
}

if (STATUS_ONLY) {
	const stateFile = path.join(ROOT, "memory", ".vps-diagnose.json")
	if (fs.existsSync(stateFile)) {
		const state = JSON.parse(fs.readFileSync(stateFile, "utf8"))
		console.log("Last VPS status:", state.timestamp)
		console.log("Healthy:", state.healthy ? "✓ Yes" : "✗ No")
		console.log("Endoints ok:", state.results?.filter(r => r.status === "ok").length || "unknown")
	} else {
		console.log("No previous diagnosis found. Run full diagnostics first.")
	}
} else {
	const results = await runDiagnostics()
	showStatus(results)

	const allOk = results.every(r => r.status === "ok")
	process.exit(allOk ? 0 : 1)
}