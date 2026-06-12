#!/usr/bin/env node
/**
 * detect-kilo-drift.mjs — Detect Kilo config drift across config roots
 *
 * Scans all three Kilo config roots for:
 * - Model name differences
 * - MCP server path differences
 * - Missing/extra env vars
 * - Workflow rule differences
 *
 * Usage:
 *   node scripts/detect-kilo-drift.mjs              # Full drift detection
 *   node scripts/detect-kilo-drift.mjs --status     # Show drift status
 *   node scripts/detect-kilo-drift.mjs --fix        # Auto-sync to canonical root
 *   node scripts/detect-kilo-drift.mjs --dry-run    # Preview changes
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")

const KILO_ROOT = path.join(ROOT, ".kilo")
const KILO_GLOBAL = path.join(process.env.USERPROFILE || process.env.HOME, ".config", "kilo")
const KILO_CANONICAL = KILO_ROOT

const DRIFT_FILE = path.join(ROOT, "memory", ".kilo-drift-report.json")

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes("--status")
const FIX_MODE = args.includes("--fix")
const DRY_RUN = args.includes("--dry-run")

function loadJson(file) {
	try { return JSON.parse(fsSync.readFileSync(file, "utf8")) } catch { return null }
}

function loadEnv(file) {
	try {
		const content = fsSync.readFileSync(file, "utf8")
		const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#"))
		const env = {}
		for (const line of lines) {
			const [key, ...rest] = line.split("=")
			env[key] = rest.join("=").trim().replace(/^["']|["']$/g, "")
		}
		return env
	} catch { return {} }
}

function detectDrift() {
	const drift = {
		timestamp: new Date().toISOString(),
		configs: {},
		drifts: [],
		recommendedRoot: KILO_ROOT,
	}

	const roots = [
		{ name: "project", path: KILO_ROOT },
		{ name: "global", path: KILO_GLOBAL },
	]

	for (const root of roots) {
		const configFile = path.join(root.path, "kilo.json")
		const envFile = path.join(root.path, ".env")

		drift.configs[root.name] = {
			config: loadJson(configFile),
			env: loadEnv(envFile),
			exists: fsSync.existsSync(configFile),
		}
	}

	// Check model name differences
	const models = roots.map(r => drift.configs[r.name]?.config?.models?.default || "unknown")
	if (new Set(models).size > 1) {
		drift.drifts.push({
			type: "model-mismatch",
			description: "Different default models across roots",
			values: Object.fromEntries(roots.map((r, i) => [r.name, models[i]])),
			severity: "medium",
		})
	}

	// Check MCP server differences
	const mcpPaths = roots.map(r => {
		const config = drift.configs[r.name]?.config
		const servers = config?.mcp?.servers || {}
		const paths = {}
		for (const [name, server] of Object.entries(servers)) {
			if (server.command) paths[name] = server.command
		}
		return paths
	})

	const allMcpNames = [...new Set(mcpPaths.flatMap(p => Object.keys(p)))]
	for (const name of allMcpNames) {
		const paths = mcpPaths.map(p => p[name]).filter(Boolean)
		if (new Set(paths).size > 1) {
			drift.drifts.push({
				type: "mcp-path-mismatch",
				description: `MCP server path differs for ${name}`,
				values: Object.fromEntries(roots.map((r, i) => [r.name, mcpPaths[i][name]])),
				severity: "high",
			})
		}
	}

	// Check workflow rules
	const workflowRules = roots.map(r => {
		const config = drift.configs[r.name]?.config
		return config?.workflow?.rules || {}
	})

	const ruleNames = [...new Set(workflowRules.flatMap(r => Object.keys(r)))]
	for (const name of ruleNames) {
		const rules = workflowRules.map(r => JSON.stringify(r[name]))
		if (new Set(rules).size > 1) {
			drift.drifts.push({
				type: "workflow-rule-mismatch",
				description: `Workflow rule differs for ${name}`,
				severity: "low",
			})
		}
	}

	// Check env vars
	const envs = roots.map(r => Object.keys(drift.configs[r.name]?.env || {}))
	const allEnvVars = [...new Set(envs.flatMap(e => e))]

	drift.missingEnv = {}
	for (const varName of allEnvVars) {
		for (const root of roots) {
			if (!drift.configs[root.name]?.env?.[varName]) {
				drift.missingEnv[root.name] = [...(drift.missingEnv[root.name] || []), varName]
			}
		}
	}

	return drift
}

function saveDrift(drift) {
	fsSync.mkdirSync(path.dirname(DRIFT_FILE), { recursive: true })
	fsSync.writeFileSync(DRIFT_FILE, JSON.stringify(drift, null, 2), "utf8")
}

function applyFix(drift) {
	const canonicalConfig = drift.configs.project.config
	if (!canonicalConfig) return

	console.log("Auto-fixing drifts...")
	for (const d of drift.drifts) {
		console.log(`  ${d.type}: ${d.description}`)
	}

	// Write canonical config to global
	if (FIX_MODE && !DRY_RUN) {
		const globalDir = path.dirname(drift.configs.global?.config ? KILO_GLOBAL : null)
		if (globalDir && fsSync.existsSync(globalDir)) {
			fsSync.writeFileSync(
				path.join(KILO_GLOBAL, "kilo.json"),
				JSON.stringify(canonicalConfig, null, 2),
				"utf8"
			)
			console.log("  ✓ Synced project config to global")
		}
	}
}

function main() {
	const drift = detectDrift()

	if (STATUS_ONLY) {
		console.log("=== Kilo Config Drift Status ===")
		console.log(`Drifts detected: ${drift.drifts.length}`)
		console.log(`Global config exists: ${drift.configs.global?.exists ?? false}`)
		console.log(`Project config exists: ${drift.configs.project?.exists ?? false}`)
		return
	}

	saveDrift(drift)
	console.log(`🔍 Detected ${drift.drifts.length} drifts`)

	for (const d of drift.drifts) {
		console.log(`  ${d.severity === "high" ? "🔴" : d.severity === "medium" ? "🟡" : "🔵"} ${d.type}: ${d.description}`)
	}

	if (FIX_MODE) {
		applyFix(drift)
	}
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })