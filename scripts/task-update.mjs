#!/usr/bin/env node
/**
 * task-update.mjs — Update task status for extensions
 *
 * Extensions can call this to update their task status in the global registry.
 *
 * Usage:
 *   node scripts/task-update.mjs --id=<task-id> --status=<status> --agent=<agent>
 *   node scripts/task-update.mjs --list --agent=codex
 *   node scripts/task-update.mjs --complete --id=<task-id>
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(process.env.USERPROFILE || process.env.HOME, ".superroo")

const GLOBAL_TASKS = path.join(SUPERROO_HOME, "tasks", "global-tasks.json")

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")

function parseArg(key) {
	const arg = args.find(a => a.startsWith(`${key}=`))
	return arg ? arg.split("=")[1] : null
}

function loadTasks() {
	try { return JSON.parse(fsSync.readFileSync(GLOBAL_TASKS, "utf8")) } catch { return { version: 1, projects: {} } }
}

function saveTasks(data) {
	if (DRY_RUN) return console.log("DRY RUN — would write:", JSON.stringify(data, null, 2))
	const dir = path.dirname(GLOBAL_TASKS)
	if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true })
	fsSync.writeFileSync(GLOBAL_TASKS, JSON.stringify(data, null, 2), "utf8")
}

const taskId = parseArg("id")
const status = parseArg("status")
const agent = parseArg("agent")
const listOnly = args.includes("--list")
const completeOnly = args.includes("--complete")

if (listOnly) {
	const tasks = loadTasks()
	const allTasks = []
	for (const [project, proj] of Object.entries(tasks.projects || {})) {
		for (const [ag, t] of Object.entries(proj)) {
			if (ag === "updatedAt") continue
			for (const task of t) {
				allTasks.push({ project, agent: ag, ...task })
			}
		}
	}
	allTasks.filter(t => !agent || t.agent === agent)
		.slice(0, 20)
		.forEach(t => console.log(`${t.agent}: ${t.title} [${t.status}]`))
} else if (taskId && status && agent) {
	const tasks = loadTasks()
	const PROJECT_ID = path.basename(ROOT)

	if (!tasks.projects) tasks.projects = {}
	if (!tasks.projects[PROJECT_ID]) tasks.projects[PROJECT_ID] = {}
	if (!tasks.projects[PROJECT_ID][agent]) tasks.projects[PROJECT_ID][agent] = []

	const taskList = tasks.projects[PROJECT_ID][agent]
	const existing = taskList.find(t => t.id === taskId)

	if (existing) {
		existing.status = status
		existing.updatedAt = new Date().toISOString()
	} else {
		taskList.push({
			id: taskId,
			title: `Task ${taskId}`,
			status,
			agent,
			updatedAt: new Date().toISOString(),
		})
	}
	tasks.updatedAt = new Date().toISOString()
	saveTasks(tasks)
	console.log(`Updated task ${taskId} to ${status}`)
} else if (taskId && completeOnly) {
	// Internal call to mark complete
	const tasks = loadTasks()
	const PROJECT_ID = path.basename(ROOT)

	for (const [project, proj] of Object.entries(tasks.projects || {})) {
		for (const [ag, t] of Object.entries(proj)) {
			if (ag === "updatedAt") continue
			const task = t.find(x => x.id === taskId)
			if (task) {
				task.status = "completed"
				task.updatedAt = new Date().toISOString()
				tasks.updatedAt = new Date().toISOString()
				saveTasks(tasks)
				console.log(`Completed task ${taskId}`)
			}
		}
	}
} else {
	console.log("Usage: node scripts/task-update.mjs --id=<task-id> --status=<status> --agent=<agent>")
	console.log("   or: node scripts/task-update.mjs --list [--agent=<agent>]")
	console.log("   or: node scripts/task-update.mjs --complete --id=<task-id>")
}