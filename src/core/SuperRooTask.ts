import { z } from "zod"

import type { TaskInputRaw, TaskPriority } from "../super-roo"

export const SuperRooTaskSource = {
	VSCODE: "vscode",
	CLI: "cli",
	DAEMON: "daemon",
	TELEGRAM: "telegram",
	GITHUB: "github",
	CI: "ci",
} as const

export type SuperRooTaskSource = (typeof SuperRooTaskSource)[keyof typeof SuperRooTaskSource]

export const SuperRooTaskSchema = z.object({
	/**
	 * The surface that created the task. This lets the shared engine keep a
	 * clear audit trail when the same command arrives from VS Code, CLI,
	 * Telegram, GitHub, or the VPS daemon.
	 */
	source: z.enum(["vscode", "cli", "daemon", "telegram", "github", "ci"]).default("cli"),
	goal: z.string().min(1),
	agent: z.string().min(1).default("coder"),
	priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
	parentTaskId: z.string().optional(),
	featureId: z.string().optional(),
	bugId: z.string().optional(),
	requiredCapabilities: z.array(z.string()).default([]),
	payload: z.record(z.unknown()).default({}),
	maxIterations: z.number().int().positive().max(50).default(5),
	workspacePath: z.string().optional(),
	repo: z
		.object({
			owner: z.string().optional(),
			name: z.string().optional(),
			branch: z.string().optional(),
		})
		.optional(),
	replyTo: z
		.object({
			telegramChatId: z.string().optional(),
			vscodePanelId: z.string().optional(),
			githubIssueNumber: z.number().int().positive().optional(),
		})
		.optional(),
})

export type SuperRooTaskRaw = z.input<typeof SuperRooTaskSchema>
export type SuperRooTask = z.output<typeof SuperRooTaskSchema>

export interface RunAutonomousOptions {
	task?: string | SuperRooTaskRaw
	source?: SuperRooTaskSource
	submit?: (task: TaskInputRaw) => unknown
}

export function normalizeSuperRooTask(input: string | SuperRooTaskRaw = "Run autonomous coding loop"): SuperRooTask {
	if (typeof input === "string") {
		return SuperRooTaskSchema.parse({ goal: input })
	}

	return SuperRooTaskSchema.parse(input)
}

export function taskInputToSuperRooTask(input: TaskInputRaw, source: SuperRooTaskSource = SuperRooTaskSource.DAEMON): SuperRooTask {
	return normalizeSuperRooTask({ source, ...input })
}

export function superRooTaskToTaskInput(task: SuperRooTask): TaskInputRaw {
	return {
		agent: task.agent,
		goal: task.goal,
		priority: task.priority as TaskPriority,
		parentTaskId: task.parentTaskId,
		featureId: task.featureId,
		bugId: task.bugId,
		requiredCapabilities: task.requiredCapabilities,
		payload: {
			...task.payload,
			superRooSource: task.source,
			workspacePathOverride: task.workspacePath ?? task.payload.workspacePathOverride,
			repo: task.repo ?? task.payload.repo,
			replyTo: task.replyTo ?? task.payload.replyTo,
		},
		maxIterations: task.maxIterations,
	}
}

export function parseTaskSubmission(input: unknown, source = SuperRooTaskSource.DAEMON): TaskInputRaw {
	const raw = input as Record<string, unknown>
	const task =
		typeof raw.source === "string" || typeof raw.workspacePath === "string" || raw.repo || raw.replyTo
			? normalizeSuperRooTask(raw as SuperRooTaskRaw)
			: taskInputToSuperRooTask(raw as unknown as TaskInputRaw, source)

	return superRooTaskToTaskInput(task)
}
