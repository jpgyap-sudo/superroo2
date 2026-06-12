#!/usr/bin/env node
/**
 * project-context-carrier.mjs — Cross-project context carryover
 *
 * When an agent finishes a task, stores project context in memory/.project-context.jsonl.
 * On agent startup in a new project, checks for recent context from the same agent.
 *
 * Usage:
 *   node scripts/project-context-carrier.mjs --store --agent=<agent> --task=<summary> --project=<name>
 *   node scripts/project-context-carrier.mjs --load --agent=<agent> --project=<name>
 *   node scripts/project-context-carrier.mjs --status
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(process.env.USERPROFILE || process.env.HOME, ".superroo")

const CONTEXT_FILE = path.join(SUPERROO_HOME, "project-context.jsonl")

const args = process.argv.slice(2)
const STORE = args.includes("--store")
const LOAD = args.includes("--load")
const STATUS = args.includes("--status")
const DRY_RUN = args.includes("--dry-run")

function parseArg(key) {
	const arg = args.find(a => a.startsWith(`${key}=`))
	return arg ? arg.split("=")[1] : null
}

function loadContext(agent, project) {
	try {
		const lines = fsSync.readFileSync(CONTEXT_FILE, "utf8").split("\n").filter(Boolean)
		const entries = lines.map(l => JSON.parse(l))
		return entries
			.filter(e => (!agent || e.agent === agent) && (!project || e.project !== project))
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
			.slice(0, 10)
	} catch { return [] }
}

function saveContext(entry) {
	if (DRY_RUN) {
		console.log("Would store:", JSON.stringify(entry, null, 2))
		return
	}
	const dir = path.dirname(CONTEXT_FILE)
	if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true })
	fsSync.appendFileSync(CONTEXT_FILE, JSON.stringify(entry) + "\n", "utf8")
}

function showStatus() {
	const context = loadContext()
	console.log("=== Project Context Store ===")
	console.log(`Total entries: ${context.length}`)
	console.log("\nRecent entries:")
	context.slice(0, 5).forEach(e => {
		console.log(`  ${e.agent} in ${e.project}: ${e.taskSummary?.slice(0, 60)}...`)
		console.log(`    Lessons: ${e.relevantLessons?.length || 0} items`)
		console.log(`    Active work: ${e.activeWorkItems?.length || 0} items`)
	})
}

function main() {
	const agent = parseArg("agent") || "unknown"
	const project = parseArg("project") || path.basename(ROOT)
	const task = parseArg("task") || ""

	if (STATUS) {
		showStatus()
	} else if (STORE) {
		const lessons = []
		const lessonsMd = path.join(ROOT, "memory", "lessons-learned.md")
		if (fsSync.existsSync(lessonsMd)) {
			const md = fsSync.readFileSync(lessonsMd, "utf8")
			const matches = [...md.matchAll(/^### Lesson: (.+)$/gm)]
			lessons.push(...matches.slice(-5).map(m => m[1]))
		}

		const activeWork = []
		const activeWorkMd = path.join(ROOT, "ACTIVE_WORK.md")
		if (fsSync.existsSync(activeWorkMd)) {
			const aw = fsSync.readFileSync(activeWorkMd, "utf8")
			const matches = [...aw.matchAll(/^### \[.+\] (.+)$/gm)]
			activeWork.push(...matches.slice(-5).map(m => m[1]))
		}

		saveContext({
			agent,
			project,
			taskSummary: task,
			relevantLessons: lessons,
			activeWorkItems: activeWork,
			timestamp: new Date().toISOString(),
			projectPath: ROOT,
		})
		console.log(`Stored context for ${agent} in ${project}`)
	} else if (LOAD) {
		const context = loadContext(agent)
		if (context.length === 0) {
			console.log(`No prior context for ${agent}`)
			return
		}

		console.log(`=== Recent ${agent} Context ===`)
		context.slice(0, 3).forEach(e => {
			console.log(`\nFrom project: ${e.project}`)
			console.log(`  Last task: ${e.taskSummary}`)
			if (e.relevantLessons?.length) {
				console.log(`  Lessons learned:`)
				e.relevantLessons.forEach(l => console.log(`    • ${l}`))
			}
			if (e.activeWorkItems?.length) {
				console.log(`  Active work items:`)
				e.activeWorkItems.forEach(i => console.log(`    • ${i}`))
			}
		})
	}
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })