import { describe, expect, it } from "vitest"

import {
	normalizeSuperRooTask,
	parseTaskSubmission,
	SuperRooTaskSource,
	superRooTaskToTaskInput,
} from "../SuperRooTask"

describe("SuperRooTask contract", () => {
	it("normalizes CLI goals into coder tasks", () => {
		const task = normalizeSuperRooTask({ source: SuperRooTaskSource.CLI, goal: "fix failing tests" })
		expect(task).toMatchObject({
			source: "cli",
			agent: "coder",
			goal: "fix failing tests",
			priority: "normal",
			maxIterations: 5,
		})
	})

	it("converts shared tasks to orchestrator queue input with audit payload", () => {
		const input = superRooTaskToTaskInput(
			normalizeSuperRooTask({
				source: SuperRooTaskSource.TELEGRAM,
				goal: "debug production error",
				agent: "debugger",
				workspacePath: "/opt/app",
				replyTo: { telegramChatId: "123" },
			}),
		)

		expect(input).toMatchObject({
			agent: "debugger",
			goal: "debug production error",
			payload: {
				superRooSource: "telegram",
				workspacePathOverride: "/opt/app",
				replyTo: { telegramChatId: "123" },
			},
		})
	})

	it("keeps old daemon task payloads compatible", () => {
		const input = parseTaskSubmission({ agent: "tester", goal: "run tests" })
		expect(input).toMatchObject({
			agent: "tester",
			goal: "run tests",
			payload: { superRooSource: "daemon" },
		})
	})
})
