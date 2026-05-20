/**
 * SuperRoo Cloud — Sandbox Runner (BullMQ Worker Entry)
 *
 * @deprecated Use the global SandboxManager singleton from
 *   `../orchestrator/sandbox` instead of creating a local instance.
 *
 * This module provides the BullMQ-compatible `runSandboxJob()` function
 * used by worker.js. It delegates to the global SandboxManager singleton
 * to avoid the triple-singleton problem.
 */

const { getGlobalSandboxManager } = require("../orchestrator/sandbox")

/**
 * Run a job inside a sandbox container.
 *
 * @param {object} job - BullMQ job object
 * @param {object} job.data - Job payload
 * @param {string} job.data.id - Job ID
 * @param {string} job.data.task - Task name
 * @param {string[]} job.data.commands - Commands to execute
 * @param {object} [job.data.options] - Sandbox options override
 * @returns {Promise<object>}
 */
async function runSandboxJob(job) {
	const { id, task, commands, options } = job.data || {}

	if (!commands || !Array.isArray(commands) || commands.length === 0) {
		return {
			success: false,
			error: "No commands provided",
			jobId: id,
			taskName: task,
		}
	}

	const manager = await getGlobalSandboxManager()

	const result = await manager.executeJob(
		{ id, task, commands },
		{
			usePool: false,
			...options,
		},
	)

	return {
		success: result.success,
		jobId: result.jobId,
		taskName: result.taskName,
		exitCode: result.exitCode ?? null,
		timedOut: result.timedOut ?? false,
		duration: result.duration ?? 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		logPath: result.logPath ?? null,
		error: result.error ?? null,
	}
}

module.exports = { runSandboxJob }
