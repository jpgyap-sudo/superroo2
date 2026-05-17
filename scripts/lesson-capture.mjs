#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const LESSONS_FILE = path.join(ROOT, "memory", "lessons-learned.md")

function git(command) {
	return execSync(command, { cwd: ROOT, encoding: "utf8" }).trim()
}

function inferTags(files, message) {
	const haystack = `${files.join(" ")} ${message}`.toLowerCase()
	const tags = new Set()
	if (haystack.includes("lesson") || haystack.includes("memory")) tags.add("learning-layer")
	if (haystack.includes("api")) tags.add("api")
	if (haystack.includes("telegram")) tags.add("telegram")
	if (haystack.includes("test")) tags.add("testing")
	if (haystack.includes("deploy")) tags.add("deployment")
	if (haystack.includes("fix")) tags.add("bugfix")
	if (haystack.includes("refactor")) tags.add("refactor")
	if (tags.size === 0) tags.add("general")
	return [...tags]
}

async function readPayload() {
	const jsonFileArg = process.argv.find((arg) => arg.startsWith("--json-file="))
	if (jsonFileArg) {
		return JSON.parse(await fs.readFile(jsonFileArg.slice("--json-file=".length), "utf8"))
	}
	const jsonArg = process.argv.find((arg) => arg.startsWith("--json="))
	return jsonArg ? JSON.parse(jsonArg.slice("--json=".length)) : null
}

async function main() {
	const payload = await readPayload()
	const sha = payload?.sha || git("git rev-parse HEAD")
	const message = payload?.taskSummary || git("git log -1 --pretty=%B").split("\n")[0]
	const author = payload?.model || git("git log -1 --pretty=%an")
	const files =
		payload?.files ||
		git("git diff-tree --no-commit-id --name-only -r HEAD")
			.split(/\r?\n/)
			.filter(Boolean)
	const date = payload?.date || new Date().toISOString().slice(0, 10)
	const title = payload?.title || message.replace(/^(fix|feat|docs|refactor|chore)(\([^)]*\))?:\s*/i, "")
	const tags = payload?.tags || inferTags(files, message)

	let existing = ""
	try {
		existing = await fs.readFile(LESSONS_FILE, "utf8")
	} catch {
		existing = "# lessons-learned.md\n\n"
	}

	if (existing.includes(`Git commit ${sha.slice(0, 8)}`)) {
		console.log(`Lesson for commit ${sha.slice(0, 8)} already exists.`)
		return
	}

	const block = `
### Auto-Extracted Lesson: ${title}

Date: ${date}
Source: Git commit ${sha.slice(0, 8)}
Model/API used: ${author}
Confidence: ${payload?.confidence || "medium"}
Related files: ${files.join(", ")}

#### Task Summary
${message}

#### Files Changed
${files.map((file) => `- \`${file}\``).join("\n")}

#### Bug Cause
${payload?.rootCause || "Not recorded."}

#### Fix Applied
${payload?.fixApplied || "See the linked commit."}

#### Test Result
${payload?.testResult || "Not recorded."}

#### Lesson Learned
${payload?.lesson || "Document the durable insight from this change."}

#### Reusable Rule
**${payload?.reusableRule || "Add a specific reusable rule before relying on this lesson."}**

#### Tags
${tags.join(", ")}

---
`
	await fs.appendFile(LESSONS_FILE, block, "utf8")
	console.log(`Captured lesson for commit ${sha.slice(0, 8)}.`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
