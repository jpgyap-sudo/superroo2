import {
	normalizeSuperRooTask,
	type RunAutonomousOptions,
	SuperRooTaskSource,
	superRooTaskToTaskInput,
} from "./SuperRooTask"

/**
 * SuperRoo core autonomous entry point.
 *
 * VS Code, CLI, daemon, Telegram, and GitHub should all arrive here with a
 * SuperRooTask-shaped command. This keeps the orchestration brain headless and
 * gives every surface the same task language.
 */
export async function runAutonomous(options: RunAutonomousOptions = {}) {
	console.log("Starting SuperRoo autonomous mode...")

	const source = options.source ?? SuperRooTaskSource.CLI
	const task =
		typeof options.task === "string"
			? normalizeSuperRooTask({ source, goal: options.task })
			: normalizeSuperRooTask({ source, goal: "Run autonomous coding loop", ...options.task })
	const taskInput = superRooTaskToTaskInput(task)

	if (options.submit) {
		options.submit(taskInput)
		console.log(`Submitted SuperRoo task from ${task.source}: ${task.goal}`)
	} else {
		console.log(`Prepared SuperRoo task from ${task.source}: ${task.goal}`)
	}

	console.log("Autonomous mode finished.")

	return { task, taskInput }
}
