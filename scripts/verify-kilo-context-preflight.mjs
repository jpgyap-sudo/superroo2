#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()

const roots = [
	{
		name: "repo",
		root: path.join(repoRoot, ".kilo"),
		required: true,
	},
	{
		name: "user-home",
		root: path.join(process.env.USERPROFILE || process.env.HOME || "", ".kilo"),
		required: false,
	},
	{
		name: "user-config",
		root: path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "kilo"),
		required: false,
	},
]

const requiredSnippets = {
	thinker: [
		"model: kilo-auto/free",
		"fallback_model: qwen3:14b",
		"context-summarizer",
		"COMPACT_BRIEF_READY: true",
		"Do not summarize inside Thinker",
	],
	summarizer: [
		"model: phi4:latest",
		"fallback_model: qwen3:14b",
		"COMPACT_BRIEF_READY: true",
		"Compact Continuation Brief",
	],
	workflow: ["Context Summarizer", "kilo-auto/free", "COMPACT_BRIEF_READY: true"],
	command: ["context-summarizer", "COMPACT_BRIEF_READY: true", "Never pass the raw risky transcript"],
}

function readIfExists(filePath) {
	if (!fs.existsSync(filePath)) {
		return undefined
	}
	return fs.readFileSync(filePath, "utf8")
}

function assertIncludes(errors, label, text, snippets) {
	if (text === undefined) {
		errors.push(`${label} is missing`)
		return
	}
	for (const snippet of snippets) {
		if (!text.includes(snippet)) {
			errors.push(`${label} missing required text: ${snippet}`)
		}
	}
}

function verifyJson(errors, label, filePath) {
	const text = readIfExists(filePath)
	if (text === undefined) {
		errors.push(`${label} is missing`)
		return
	}
	let config
	try {
		config = JSON.parse(text)
	} catch (error) {
		errors.push(`${label} is not valid JSON: ${error.message}`)
		return
	}
	if (config.model !== "kilo-auto/free") {
		errors.push(`${label} model must be kilo-auto/free, found ${JSON.stringify(config.model)}`)
	}
	if (!config.provider?.kilo) {
		errors.push(`${label} must keep Kilo provider configured for Auto Free`)
	}
	if (!config.provider?.ollama) {
		errors.push(`${label} must keep Ollama provider configured for context summarizer fallback`)
	}
}

const errors = []

for (const entry of roots) {
	if (!fs.existsSync(entry.root)) {
		if (entry.required) {
			errors.push(`${entry.name} root missing: ${entry.root}`)
		}
		continue
	}

	verifyJson(errors, `${entry.name}/kilo.json`, path.join(entry.root, "kilo.json"))
	assertIncludes(
		errors,
		`${entry.name}/agent/thinker.md`,
		readIfExists(path.join(entry.root, "agent", "thinker.md")),
		requiredSnippets.thinker,
	)
	assertIncludes(
		errors,
		`${entry.name}/agent/context-summarizer.md`,
		readIfExists(path.join(entry.root, "agent", "context-summarizer.md")),
		requiredSnippets.summarizer,
	)
	assertIncludes(errors, `${entry.name}/workflow.md`, readIfExists(path.join(entry.root, "workflow.md")), requiredSnippets.workflow)

	const commandPath = path.join(entry.root, "command", "think-and-plan.md")
	if (fs.existsSync(commandPath)) {
		assertIncludes(errors, `${entry.name}/command/think-and-plan.md`, readIfExists(commandPath), requiredSnippets.command)
	}
}

if (errors.length > 0) {
	console.error("Kilo context preflight verification failed:")
	for (const error of errors) {
		console.error(`- ${error}`)
	}
	process.exit(1)
}

console.log("Kilo context preflight verification passed")
