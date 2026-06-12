#!/usr/bin/env node
/**
 * ollama-migration-mode.mjs
 *
 * Stores the active SuperRoo local-model mode in ~/.superroo/ollama-mode.json.
 * MCP servers read this at startup, so future migrations can switch the whole
 * ecosystem without hand-editing each extension config.
 *
 * Usage:
 *   node scripts/ollama-migration-mode.mjs --status
 *   node scripts/ollama-migration-mode.mjs --set=hybrid-local
 *   node scripts/ollama-migration-mode.mjs --set=pure-ollama
 *   node scripts/ollama-migration-mode.mjs --env
 */

import fs from "fs"
import os from "os"
import path from "path"

const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const MODE_FILE = process.env.SUPERROO_OLLAMA_MODE_FILE || path.join(SUPERROO_HOME, "ollama-mode.json")
const args = process.argv.slice(2)

const DEFAULT_CONFIG = {
	version: 1,
	activeMode: "hybrid-local",
	modes: {
		"hybrid-local": {
			description: "Local Ollama first, Tailscale VPS fallback.",
			ollamaHost: "http://127.0.0.1:11434",
			ollamaFallbackUrl: "http://100.64.175.88:11434",
			thinkerModel: "hermes3:latest",
			fastCoderModel: "qwen2.5-coder:7b",
			proCoderModel: "qwen3:14b",
			embedModel: "nomic-embed-text",
			cloudCoderAllowed: false,
		},
		"pure-ollama": {
			description: "All thinking, coding, embeddings, and review stay on local Ollama.",
			ollamaHost: "http://127.0.0.1:11434",
			ollamaFallbackUrl: "",
			thinkerModel: "hermes3:latest",
			fastCoderModel: "qwen2.5-coder:7b",
			proCoderModel: "qwen3:14b",
			reviewerModel: "qwen3:14b",
			embedModel: "nomic-embed-text",
			cloudCoderAllowed: false,
		},
	},
}

function loadConfig() {
	try {
		const existing = JSON.parse(fs.readFileSync(MODE_FILE, "utf8"))
		return {
			...DEFAULT_CONFIG,
			...existing,
			modes: { ...DEFAULT_CONFIG.modes, ...(existing.modes || {}) },
		}
	} catch {
		return DEFAULT_CONFIG
	}
}

function saveConfig(config) {
	fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true })
	fs.writeFileSync(MODE_FILE, JSON.stringify(config, null, 2), "utf8")
}

function printEnv(config) {
	const mode = config.modes[config.activeMode]
	console.log(`SUPERROO_AGENT_MODE=${config.activeMode}`)
	console.log(`SUPERROO_OLLAMA_MODE_FILE=${MODE_FILE}`)
	console.log(`OLLAMA_HOST=${mode.ollamaHost}`)
	console.log(`OLLAMA_URL=${mode.ollamaHost}`)
	console.log(`OLLAMA_FALLBACK_URL=${mode.ollamaFallbackUrl || ""}`)
	console.log(`CODEX_BRAIN_HERMES_MODEL=${mode.thinkerModel}`)
	console.log(`CODEX_BRAIN_FAST_CODER_MODEL=${mode.fastCoderModel}`)
	console.log(`CODEX_BRAIN_PRO_CODER_MODEL=${mode.proCoderModel}`)
	console.log(`CODEX_BRAIN_EMBED_MODEL=${mode.embedModel}`)
}

const setArg = args.find(a => a.startsWith("--set="))
const config = loadConfig()

if (setArg) {
	const modeName = setArg.split("=")[1]
	if (!config.modes[modeName]) {
		console.error(`Unknown mode: ${modeName}`)
		console.error(`Known modes: ${Object.keys(config.modes).join(", ")}`)
		process.exit(1)
	}
	config.activeMode = modeName
	config.updatedAt = new Date().toISOString()
	saveConfig(config)
	console.log(`Set SuperRoo Ollama mode to ${modeName}`)
} else {
	saveConfig(config)
}

if (args.includes("--env")) {
	printEnv(config)
} else {
	const mode = config.modes[config.activeMode]
	console.log("=== SuperRoo Ollama Mode ===")
	console.log(`Mode: ${config.activeMode}`)
	console.log(`File: ${MODE_FILE}`)
	console.log(`Thinker: ${mode.thinkerModel}`)
	console.log(`Fast coder: ${mode.fastCoderModel}`)
	console.log(`Pro coder: ${mode.proCoderModel}`)
	console.log(`Embeddings: ${mode.embedModel}`)
	console.log(`Ollama: ${mode.ollamaHost}`)
	console.log(`Fallback: ${mode.ollamaFallbackUrl || "disabled"}`)
}
