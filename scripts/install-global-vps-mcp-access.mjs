#!/usr/bin/env node
/**
 * Install SuperRoo global MCP access with local-first / VPS fallback.
 *
 * This writes one canonical MCP config and optionally mirrors it into the
 * JSON-based MCP consumers used by Kilo Code, Blackbox, SuperRoo VS Code,
 * Roo Cline, and this repo. It keeps the SuperRoo roots canonical and gives
 * every extension the same Tailscale fallback to the SuperRoo VPS.
 *
 * Usage:
 *   node scripts/install-global-vps-mcp-access.mjs --status
 *   node scripts/install-global-vps-mcp-access.mjs --apply
 *   node scripts/install-global-vps-mcp-access.mjs --apply --all-json-clients
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir()
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(HOME, ".superroo")
const SUPERROO_MEMORY = path.join(SUPERROO_HOME, "memory")
const SUPERROO_MCP_DIR = path.join(SUPERROO_HOME, "mcp")
const SUPERROO_BIN_DIR = path.join(SUPERROO_HOME, "bin")

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const STATUS = args.includes("--status") || !APPLY
const ALL_JSON_CLIENTS = args.includes("--all-json-clients")

const VPS_IP = process.env.SUPERROO_VPS_IP || "100.64.175.88"
const TUNNEL_OLLAMA_PORT = process.env.SUPERROO_TUNNEL_OLLAMA_PORT || "11435"
const TUNNEL_MCP_PORT = process.env.SUPERROO_TUNNEL_MCP_PORT || "13419"
const TUNNEL_DB_PORT = process.env.SUPERROO_TUNNEL_DB_PORT || "15432"
const TUNNEL_API_PORT = process.env.SUPERROO_TUNNEL_API_PORT || "18787"
const VPS_OLLAMA_URL = process.env.SUPERROO_VPS_OLLAMA_URL || `http://127.0.0.1:${TUNNEL_OLLAMA_PORT}`
const VPS_MCP_URL = process.env.SUPERROO_VPS_MCP_URL || `http://127.0.0.1:${TUNNEL_MCP_PORT}/mcp`
const VPS_API_URL = process.env.SUPERROO_VPS_API_URL || `http://${VPS_IP}:8787/api`
const PUBLIC_API_URL = process.env.SUPERROO_API_URL || "https://dev.abcx124.xyz/api"
const LOCAL_DATABASE_URL = process.env.SUPERROO_LOCAL_DATABASE_URL || "postgresql://superroo:superroo@localhost:5432/superroo_brain"
const VPS_DATABASE_URL = process.env.SUPERROO_VPS_DATABASE_URL || `postgresql://superroo:superroo@localhost:${TUNNEL_DB_PORT}/superroo_brain`
const LOCAL_OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434"

const CANONICAL_CONFIG = path.join(SUPERROO_MCP_DIR, "codex-brain.json")
const FALLBACK_CONFIG = path.join(SUPERROO_MCP_DIR, "codex-brain-vps-fallback.json")

const jsonClients = [
	{
		id: "repo-superroo2",
		path: path.join(ROOT, ".mcp.json"),
		agentId: "repo-superroo2",
		projectId: "superroo2",
	},
	{
		id: "kilo-code",
		path: path.join(HOME, ".kilo", "mcp.json"),
		agentId: "kilo-code",
		projectId: "kilo-code",
	},
	{
		id: "kilo-legacy",
		path: path.join(HOME, ".config", "kilo", ".mcp.json"),
		agentId: "kilo-code",
		projectId: "kilo-code",
	},
	{
		id: "blackbox",
		path: path.join(HOME, "AppData", "Roaming", "Code", "User", "globalStorage", "blackboxapp.blackboxagent", "settings", "blackbox_mcp_settings.json"),
		agentId: "blackbox",
		projectId: "blackbox",
	},
	{
		id: "superroo-vscode",
		path: path.join(HOME, "AppData", "Roaming", "Code", "User", "globalStorage", "superroo.superroo", "settings", "mcp_settings.json"),
		agentId: "superroo-vscode",
		projectId: "superroo-vscode",
	},
	{
		id: "roo-cline",
		path: path.join(HOME, "AppData", "Roaming", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"),
		agentId: "roo-cline",
		projectId: "roo-cline",
	},
]

function toPosix(filePath) {
	return filePath.replace(/\\/g, "/")
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true })
}

function readJson(file, fallback = {}) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"))
	} catch {
		return fallback
	}
}

function writeJson(file, data) {
	ensureDir(path.dirname(file))
	fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8")
}

function serverConfig({ agentId = "global", projectId = "global-superroo" } = {}) {
	const commonEnv = {
		SUPERROO_HOME: toPosix(SUPERROO_HOME),
		SUPERROO_MEMORY_DIR: toPosix(SUPERROO_MEMORY),
		MEMORY_DIR: toPosix(SUPERROO_MEMORY),
		SUPERROO_PRODUCT_MEMORY_DIR: toPosix(path.join(SUPERROO_HOME, "product-memory")),
		SUPERROO_SKILLS_DIR: toPosix(path.join(SUPERROO_HOME, "skills")),
		SUPERROO_RESOURCES_DIR: toPosix(path.join(SUPERROO_HOME, "resources")),
		SUPERROO_GLOBAL_SKILLS_AGENT: toPosix(path.join(SUPERROO_HOME, "agents", "global-skills-agent.md")),
		SUPERROO_EXTENSION_ECOSYSTEM: toPosix(path.join(SUPERROO_HOME, "resources", "coding-extension-ecosystem.md")),
		SUPERROO_VPS_IP: VPS_IP,
		SUPERROO_VPS_MCP_URL: VPS_MCP_URL,
		SUPERROO_VPS_API_URL: VPS_API_URL,
		SUPERROO_TUNNEL_OLLAMA_PORT: TUNNEL_OLLAMA_PORT,
		SUPERROO_TUNNEL_MCP_PORT: TUNNEL_MCP_PORT,
		SUPERROO_TUNNEL_DB_PORT: TUNNEL_DB_PORT,
		SUPERROO_TUNNEL_API_PORT: TUNNEL_API_PORT,
		SUPERROO_API_URL: PUBLIC_API_URL,
		SUPERROO_MCP_FALLBACK_MODE: "local-first-vps",
	}

	return {
		mcpServers: {
			"codex-brain": {
				command: "node",
				args: [toPosix(path.join(ROOT, "scripts", "codex-brain-mcp.mjs"))],
				env: {
					...commonEnv,
					PROJECT_ROOT: toPosix(ROOT),
					CODEX_BRAIN_SCRIPT: toPosix(path.join(ROOT, "scripts", "codex-brain.mjs")),
					BRAIN_OUTCOMES_PATH: toPosix(path.join(HOME, "brain", "data", "ml-outcomes.json")),
					CODEX_BRAIN_MEMORY_DIR: toPosix(path.join(SUPERROO_MEMORY, "codex-brain")),
					GLOBAL_TASK_REGISTRY: toPosix(path.join(SUPERROO_HOME, "tasks", "global-tasks.json")),
					SUPERROO_RISK_DIR: toPosix(path.join(SUPERROO_MEMORY, "predictive-risk")),
					OLLAMA_HOST: LOCAL_OLLAMA_URL,
					OLLAMA_FALLBACK_URL: VPS_OLLAMA_URL,
					CODEX_BRAIN_HERMES_MODEL: "hermes3:latest",
					CODEX_BRAIN_EMBED_MODEL: "nomic-embed-text",
					CODEX_BRAIN_FAST_CODER_MODEL: "qwen2.5-coder:7b",
					CODEX_BRAIN_PRO_CODER_MODEL: "qwen3:14b",
					OLLAMA_MAX_PARALLEL: "4",
					OLLAMA_NUM_PARALLEL: "4",
					OLLAMA_KEEP_ALIVE: "10m",
					AGENT_ID: agentId,
					PROJECT_ID: projectId,
				},
			},
			"central-brain": {
				command: "node",
				args: [toPosix(path.join(ROOT, "scripts", "central-brain-mcp.mjs"))],
				env: {
					...commonEnv,
					PROJECT_ID: projectId,
					DATABASE_URLS: `${LOCAL_DATABASE_URL},${VPS_DATABASE_URL}`,
					DATABASE_URL: LOCAL_DATABASE_URL,
					DATABASE_FALLBACK_URL: VPS_DATABASE_URL,
					OLLAMA_URL: LOCAL_OLLAMA_URL,
					OLLAMA_FALLBACK_URL: VPS_OLLAMA_URL,
					OLLAMA_MAX_PARALLEL: "4",
					OLLAMA_NUM_PARALLEL: "4",
					OLLAMA_KEEP_ALIVE: "10m",
				},
			},
			"local-brain": {
				command: "node",
				args: [toPosix(path.join(HOME, "brain", "src", "server.js"))],
				env: {
					...commonEnv,
					PROJECT_ROOT: toPosix(ROOT),
					PROJECT_ID: projectId,
					AGENT_ID: agentId,
					OLLAMA_HOST: LOCAL_OLLAMA_URL,
					OLLAMA_FALLBACK_URL: VPS_OLLAMA_URL,
					BRAIN_MEMORY_DIR: toPosix(path.join(SUPERROO_MEMORY, "brain-mcp")),
					BRAIN_OUTCOMES_PATH: toPosix(path.join(HOME, "brain", "data", "ml-outcomes.json")),
					GLOBAL_TASK_REGISTRY: toPosix(path.join(SUPERROO_HOME, "tasks", "global-tasks.json")),
				},
			},
			"ollama": {
				command: "node",
				args: [toPosix(path.join(ROOT, "scripts", "ollama-mcp.mjs"))],
				env: {
					...commonEnv,
					OLLAMA_URL: LOCAL_OLLAMA_URL,
					OLLAMA_FALLBACK_URL: VPS_OLLAMA_URL,
					OLLAMA_MODEL: "hermes3:latest",
					OLLAMA_EMBED_MODEL: "nomic-embed-text",
					OLLAMA_MAX_PARALLEL: "4",
					OLLAMA_NUM_PARALLEL: "4",
					OLLAMA_KEEP_ALIVE: "10m",
				},
			},
		},
	}
}

function mergeMcpServers(file, config) {
	const existing = readJson(file, {})
	const next = {
		...existing,
		mcpServers: {
			...(existing.mcpServers || {}),
			...config.mcpServers,
		},
	}
	writeJson(file, next)
}

function writeCmdWrapper() {
	const cmdPath = path.join(SUPERROO_BIN_DIR, "superroo-install-vps-mcp-access.cmd")
	const shellPath = path.join(SUPERROO_BIN_DIR, "superroo-install-vps-mcp-access")
	const tunnelCmdPath = path.join(SUPERROO_BIN_DIR, "superroo-vps-mcp-access.cmd")
	const tunnelShellPath = path.join(SUPERROO_BIN_DIR, "superroo-vps-mcp-access")
	const scriptPath = toPosix(path.join(ROOT, "scripts", "install-global-vps-mcp-access.mjs"))
	const tunnelScriptPath = path.join(ROOT, "scripts", "start-vps-mcp-access.ps1")
	ensureDir(SUPERROO_BIN_DIR)
	fs.writeFileSync(
		cmdPath,
		`@echo off\r\nnode "${scriptPath}" %*\r\n`,
		"utf8",
	)
	fs.writeFileSync(
		shellPath,
		`#!/usr/bin/env sh\nnode "${scriptPath}" "$@"\n`,
		"utf8",
	)
	fs.writeFileSync(
		tunnelCmdPath,
		`@echo off\r\npowershell -ExecutionPolicy Bypass -File "${tunnelScriptPath}" %*\r\n`,
		"utf8",
	)
	fs.writeFileSync(
		tunnelShellPath,
		`#!/usr/bin/env sh\npwsh -File "${toPosix(tunnelScriptPath)}" "$@"\n`,
		"utf8",
	)
}

function statusRows() {
	const rows = [
		{ id: "canonical", path: CANONICAL_CONFIG },
		{ id: "fallback", path: FALLBACK_CONFIG },
		...jsonClients,
	]
	return rows.map((row) => ({
		id: row.id,
		path: row.path,
		exists: fs.existsSync(row.path),
	}))
}

function main() {
	const canonical = serverConfig()

	if (STATUS) {
		console.log("SuperRoo VPS MCP fallback")
		console.log(`  VPS IP: ${VPS_IP}`)
		console.log(`  VPS Ollama: ${VPS_OLLAMA_URL}`)
		console.log(`  VPS MCP URL: ${VPS_MCP_URL}`)
		console.log(`  DB candidates: ${LOCAL_DATABASE_URL}, ${VPS_DATABASE_URL}`)
		console.log("")
		for (const row of statusRows()) {
			console.log(`${row.exists ? "OK " : "MISS"} ${row.id}: ${row.path}`)
		}
		if (!APPLY) {
			console.log("")
			console.log("Run with --apply to write canonical fallback config.")
			console.log("Add --all-json-clients to mirror into Kilo, Blackbox, SuperRoo VS Code, Roo Cline, and repo .mcp.json.")
		}
	}

	if (!APPLY) return

	writeJson(FALLBACK_CONFIG, canonical)
	writeJson(CANONICAL_CONFIG, canonical)
	writeCmdWrapper()

	const targets = ALL_JSON_CLIENTS ? jsonClients : [jsonClients[0]]
	for (const client of targets) {
		mergeMcpServers(client.path, serverConfig({ agentId: client.agentId, projectId: client.projectId }))
		console.log(`Updated ${client.id}: ${client.path}`)
	}

	console.log("")
	console.log(`Canonical config: ${CANONICAL_CONFIG}`)
	console.log(`Fallback config:  ${FALLBACK_CONFIG}`)
	console.log(`Wrapper:          ${path.join(SUPERROO_BIN_DIR, "superroo-install-vps-mcp-access.cmd")}`)
	console.log(`Tunnel wrapper:   ${path.join(SUPERROO_BIN_DIR, "superroo-vps-mcp-access.cmd")}`)
	console.log("")
	console.log("Start the VPS tunnel before relying on fallback services:")
	console.log("  superroo-vps-mcp-access --Background")
	console.log("Restart MCP clients after installing so they reload the updated server env.")
}

main()
