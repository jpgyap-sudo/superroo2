import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@superroo/types"
import { buildWorkRecord } from "../workRecord"

describe("buildWorkRecord tool extraction", () => {
	it("extracts file changes from current ClineSayTool names", () => {
		const messages: ClineMessage[] = [
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({ tool: "newFileCreated", path: "src/new.ts" }),
				ts: 1,
			},
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({ tool: "editedExistingFile", path: "src/edit.ts" }),
				ts: 2,
			},
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({ tool: "appliedDiff", path: "src/patch.ts" }),
				ts: 3,
			},
		]

		const record = buildWorkRecord({
			title: "Task",
			messages,
			toolUsage: {},
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})

		expect(record.changedFiles).toEqual([
			{ path: "src/new.ts", operation: "create", ts: 1 },
			{ path: "src/edit.ts", operation: "update", ts: 2 },
			{ path: "src/patch.ts", operation: "patch", ts: 3 },
		])
	})
})
