#!/usr/bin/env node
/**
 * Copilot chat fallback.
 *
 * Use this when GitHub Copilot Chat/API is unavailable. It preserves the
 * SuperRoo lesson/routing path by trying Codex Brain smart_code first, then
 * falls back to a direct Ollama chat call only if Codex Brain is unavailable.
 *
 * Usage:
 *   node scripts/copilot-ollama-fallback.mjs "implement X"
 *   Get-Content prompt.txt | node scripts/copilot-ollama-fallback.mjs
 */

import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const CODEX_BRAIN = path.join(__dirname, "codex-brain.mjs")

const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434"
const VPS_OLLAMA_URL = "http://100.64.175.88:11434"
const OLLAMA_URLS = [
	process.env.OLLAMA_URL,
	process.env.OLLAMA_HOST,
	LOCAL_OLLAMA_URL,
	process.env.OLLAMA_FALLBACK_URL,
	VPS_OLLAMA_URL,
].filter(Boolean)

const DEFAULT_MODEL = process.env.COPILOT_OLLAMA_MODEL || "qwen2.5-coder:7b"
const PRO_MODEL = process.env.COPILOT_OLLAMA_PRO_MODEL || "qwen3:14b"
const TIMEOUT_MS = Number(process.env.COPILOT_OLLAMA_TIMEOUT_MS || "180000")

function readPrompt() {
	const argPrompt = process.argv.slice(2).join(" ").trim()
	if (argPrompt) return argPrompt

	try {
		if (!process.stdin.isTTY) {
			const stdin = fs.readFileSync(0, "utf8").trim()
			if (stdin) return stdin
		}
	} catch {
		// Ignore stdin read failures and show usage below.
	}

	console.error("Usage: node scripts/copilot-ollama-fallback.mjs \"prompt\"")
	process.exit(2)
}

function runCodexBrainSmart(prompt) {
	const result = spawnSync(process.execPath, [CODEX_BRAIN, "smart", prompt], {
		cwd: ROOT,
		env: {
			...process.env,
			PROJECT_ROOT: ROOT,
			PROJECT_ID: "superroo2",
			CODEX_BRAIN_FAST_CODER_MODEL: process.env.CODEX_BRAIN_FAST_CODER_MODEL || DEFAULT_MODEL,
			CODEX_BRAIN_PRO_CODER_MODEL: process.env.CODEX_BRAIN_PRO_CODER_MODEL || PRO_MODEL,
		},
		encoding: "utf8",
		timeout: TIMEOUT_MS,
		windowsHide: true,
	})

	if (result.status !== 0) {
		const reason = (result.stderr || result.stdout || "unknown error").trim()
		throw new Error(reason)
	}

	return {
		source: "codex-brain-smart",
		text: result.stdout.trim(),
		diagnostics: result.stderr.trim(),
	}
}

function requestJson(url, body, timeoutMs = TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body)
		const request = http.request(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(payload),
			},
			timeout: timeoutMs,
		}, (response) => {
			let raw = ""
			response.setEncoding("utf8")
			response.on("data", (chunk) => { raw += chunk })
			response.on("end", () => {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					reject(new Error(`HTTP ${response.statusCode}: ${raw.slice(0, 500)}`))
					return
				}
				try {
					resolve(JSON.parse(raw))
				} catch (error) {
					reject(new Error(`Invalid JSON from Ollama: ${error.message}`))
				}
			})
		})
		request.on("timeout", () => request.destroy(new Error("request timed out")))
		request.on("error", reject)
		request.write(payload)
		request.end()
	})
}

async function directOllamaChat(prompt) {
	const system = [
		"You are the emergency local fallback for GitHub Copilot Chat in the SuperRoo repo.",
		"Follow existing project patterns, keep changes minimal, and include verification steps.",
		"Prefer patch-style guidance. Mention that this bypassed Codex Brain if asked for provenance.",
	].join(" ")

	const errors = []
	for (const baseUrl of [...new Set(OLLAMA_URLS)]) {
		try {
			const response = await requestJson(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
				model: DEFAULT_MODEL,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: prompt },
				],
				stream: false,
			})
			return {
				source: `direct-ollama:${baseUrl}`,
				text: response.message?.content || "No response",
				diagnostics: "",
			}
		} catch (error) {
			errors.push(`${baseUrl}: ${error.message}`)
		}
	}

	throw new Error(`All Ollama fallback URLs failed:\n${errors.join("\n")}`)
}

async function main() {
	const prompt = readPrompt()

	try {
		const result = runCodexBrainSmart(prompt)
		if (result.diagnostics) process.stderr.write(`${result.diagnostics}\n`)
		process.stderr.write(`[copilot-fallback] used ${result.source}\n`)
		console.log(result.text)
		return
	} catch (error) {
		process.stderr.write(`[copilot-fallback] Codex Brain smart_code failed; trying direct Ollama: ${error.message}\n`)
	}

	const result = await directOllamaChat(prompt)
	process.stderr.write(`[copilot-fallback] used ${result.source}\n`)
	console.log(result.text)
}

main().catch((error) => {
	console.error(`[copilot-fallback] failed: ${error.message}`)
	process.exit(1)
})
