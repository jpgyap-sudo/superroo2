#!/usr/bin/env node

import { runAutonomous } from "../core/runAutonomous"
import { normalizeSuperRooTask, SuperRooTaskSource } from "../core/SuperRooTask"

const command = process.argv[2]
const args = process.argv.slice(3)

async function postTaskToDaemon(task: unknown): Promise<unknown> {
	const daemonUrl = process.env.SUPERROO_DAEMON_URL
	if (!daemonUrl) return undefined

	const headers: Record<string, string> = { "content-type": "application/json" }
	if (process.env.SUPERROO_DAEMON_TOKEN) {
		headers.authorization = `Bearer ${process.env.SUPERROO_DAEMON_TOKEN}`
	}

	const res = await fetch(new URL("/tasks", daemonUrl), {
		method: "POST",
		headers,
		body: JSON.stringify(task),
	})
	const body = (await res.json()) as unknown
	if (!res.ok) {
		throw new Error(`Daemon task submission failed (${res.status}): ${JSON.stringify(body)}`)
	}
	return body
}

async function main() {
	if (!command) {
		console.log(`
SuperRoo CLI

Commands:
  autonomous [goal]   Run autonomous coding loop
  task <goal>         Submit one shared SuperRooTask
  deploy              Deploy project
  check-vps           Check VPS deployment
  debug-api           Debug API setup
`)
		return
	}

	if (command === "autonomous") {
		const goal = args.join(" ").trim() || "Run autonomous coding loop"
		const result = await runAutonomous({ task: goal, source: SuperRooTaskSource.CLI })
		await postTaskToDaemon(result.task)
		return
	}

	if (command === "task") {
		const goal = args.join(" ").trim()
		if (!goal) {
			console.error("Usage: superroo task <goal>")
			process.exit(1)
			return
		}

		const task = normalizeSuperRooTask({ source: SuperRooTaskSource.CLI, goal })
		const submitted = await postTaskToDaemon(task)
		console.log(submitted ? JSON.stringify(submitted, null, 2) : JSON.stringify(task, null, 2))
		return
	}

	if (command === "deploy") {
		console.log("Deploy command running...")
		return
	}

	if (command === "check-vps") {
		console.log("Checking VPS...")
		return
	}

	if (command === "debug-api") {
		console.log("Debugging API...")
		return
	}

	console.error(`Unknown command: ${command}`)
	process.exit(1)
}

main().catch((error) => {
	console.error("SuperRoo CLI failed:", error)
	process.exit(1)
})
