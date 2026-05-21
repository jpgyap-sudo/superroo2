/**
 * SuperRoo Task Runner — OpenHands-style CLI task loop.
 *
 * Usage:
 *   node cloud/orchestrator/runTask.js "add unit tests for BrainClient"
 *   SUPERROO_TASK_GOAL="fix the Hermes stats API" node cloud/orchestrator/runTask.js
 *
 * Flow:
 *   queued → loading_context (Brain RAG recall)
 *          → planning (emit plan event)
 *          → running  (sandboxed git status + env check)
 *          → completed (write lesson to Central Brain)
 */

const crypto = require("crypto")
const { transition } = require("./modules/TaskStateMachine")
const { eventBus } = require("./modules/SuperRooEventBus")
const { BrainClient } = require("./modules/BrainClient")

const RUNTIME_URL = process.env.SUPERROO_RUNTIME_URL ?? "http://127.0.0.1:3418"

async function runtimeExec(taskId, command, cwd) {
	const res = await fetch(`${RUNTIME_URL}/runtime/exec`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ taskId, command, cwd }),
		signal: AbortSignal.timeout(125000),
	})
	return res.json()
}

async function main() {
	const goal = process.argv.slice(2).join(" ") || process.env.SUPERROO_TASK_GOAL
	if (!goal) {
		console.error("Usage: node cloud/orchestrator/runTask.js <goal>")
		console.error("Or set: SUPERROO_TASK_GOAL=<goal>")
		process.exit(1)
	}

	const task = {
		id: crypto.randomUUID(),
		source: "cli",
		status: "queued",
		goal,
		repoPath: process.cwd(),
		riskLevel: "medium",
		createdAt: new Date().toISOString(),
		repairCount: 0,
	}

	const brain = new BrainClient()
	eventBus.emit(task.id, "user_message", { goal, source: "cli" })

	// queued → loading_context
	transition(task, "loading_context", eventBus)
	const lessons = await brain.retrieveLessons(goal)
	eventBus.emit(task.id, "brain_context", { count: lessons.length, lessons })

	// loading_context → planning
	transition(task, "planning", eventBus)
	const plan = [
		"inspect repository state (git status)",
		"check runtime environment (node, pnpm versions)",
		"apply changes for: " + goal,
		"run affected tests",
		"write lesson to Central Brain",
	]
	eventBus.emit(task.id, "agent_plan", { plan, lessonCount: lessons.length })

	// planning → running
	transition(task, "running", eventBus)

	let runtimeAvailable = true
	try {
		const statusResult = await runtimeExec(task.id, "git status --short", task.repoPath)
		if (!statusResult.ok) runtimeAvailable = false
		const envResult = await runtimeExec(task.id, "node -v && pnpm -v 2>/dev/null || echo n/a", task.repoPath)
		console.log("[runTask] git status:", statusResult.stdout?.trim() || "(clean)")
		console.log("[runTask] env:", envResult.stdout?.trim())
	} catch {
		runtimeAvailable = false
		console.warn("[runTask] Runtime server not reachable — skipping sandboxed exec")
		console.warn("[runTask] Start it with: pnpm --dir cloud superroo:runtime")
	}

	// running → completed
	transition(task, "completed", eventBus)
	eventBus.emit(task.id, "final_report", {
		status: "completed",
		runtimeAvailable,
		lessons: lessons.length,
		message: `Task loop completed. Replace the running phase with your model-router call for: ${goal}`,
	})

	await brain.writeLesson(task.id, `Completed OpenHands-style task loop for: ${goal}`, [
		"openhands-upgrade",
		"task-loop",
		"superroo",
	])

	console.log(`[runTask] Task ${task.id} completed. Events:`, eventBus.list(task.id).length)
}

main().catch((err) => {
	console.error("[runTask] Fatal:", err.message)
	process.exit(1)
})
