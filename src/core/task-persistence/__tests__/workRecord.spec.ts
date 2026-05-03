import { describe, it, expect } from "vitest"
import { buildWorkRecord } from "../workRecord"
import type { ClineMessage, ToolUsage } from "@superroo/types"

function makeMessage(overrides: Partial<ClineMessage>): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		...overrides,
	} as ClineMessage
}

describe("buildWorkRecord", () => {
	it("returns undefined fields when no relevant messages exist", () => {
		const record = buildWorkRecord({
			title: "Test task",
			messages: [],
			toolUsage: {},
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})
		expect(record.title).toBe("Test task")
		expect(record.changedFiles).toBeUndefined()
		expect(record.commandsRun).toBeUndefined()
		expect(record.checkpoints).toBeUndefined()
		expect(record.outcome).toBeUndefined()
	})

	it("extracts checkpoints from checkpoint_saved messages", () => {
		const messages: ClineMessage[] = [
			makeMessage({ say: "checkpoint_saved", text: "abc123" }),
			makeMessage({ say: "checkpoint_saved", text: "def456" }),
		]
		const record = buildWorkRecord({
			title: "Task",
			messages,
			toolUsage: {},
			cost: 0.01,
			tokensIn: 10,
			tokensOut: 20,
		})
		expect(record.checkpoints).toHaveLength(2)
		expect(record.checkpoints![0].hash).toBe("abc123")
		expect(record.checkpoints![1].hash).toBe("def456")
	})

	it("extracts outcome from completion_result", () => {
		const messages: ClineMessage[] = [makeMessage({ say: "completion_result", text: "Done!" })]
		const record = buildWorkRecord({
			title: "Task",
			messages,
			toolUsage: {},
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})
		expect(record.outcome).toBe("Done!")
	})

	it("extracts changed files from tool messages", () => {
		const messages: ClineMessage[] = [
			makeMessage({
				say: "tool",
				text: JSON.stringify({ tool: "write_to_file", path: "src/app.ts" }),
			}),
			makeMessage({
				say: "tool",
				text: JSON.stringify({ tool: "apply_diff", path: "src/utils.ts" }),
			}),
		]
		const record = buildWorkRecord({
			title: "Task",
			messages,
			toolUsage: {},
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})
		expect(record.changedFiles).toHaveLength(2)
		expect(record.changedFiles![0].path).toBe("src/app.ts")
		expect(record.changedFiles![0].operation).toBe("create")
		expect(record.changedFiles![1].path).toBe("src/utils.ts")
		expect(record.changedFiles![1].operation).toBe("patch")
	})

	it("extracts commands from tool and command_output messages and deduplicates", () => {
		const messages: ClineMessage[] = [
			makeMessage({
				say: "tool",
				text: JSON.stringify({ tool: "execute_command", command: "npm test" }),
			}),
			makeMessage({
				say: "command_output",
				text: JSON.stringify({ command: "npm test", output: "pass" }),
			}),
		]
		const record = buildWorkRecord({
			title: "Task",
			messages,
			toolUsage: {},
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})
		// deduplicated because same command string
		expect(record.commandsRun).toHaveLength(1)
		expect(record.commandsRun![0].command).toBe("npm test")
	})

	it("deduplicates files and commands by path / command", () => {
		const messages: ClineMessage[] = [
			makeMessage({
				say: "tool",
				text: JSON.stringify({ tool: "write_to_file", path: "a.ts" }),
			}),
			makeMessage({
				say: "tool",
				text: JSON.stringify({ tool: "write_to_file", path: "a.ts" }),
			}),
		]
		const record = buildWorkRecord({
			title: "Task",
			messages,
			toolUsage: {},
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})
		expect(record.changedFiles).toHaveLength(1)
	})

	it("includes tool usage summary", () => {
		const toolUsage: ToolUsage = {
			read_file: { attempts: 5, failures: 1 },
			write_to_file: { attempts: 2, failures: 0 },
		}
		const record = buildWorkRecord({
			title: "Task",
			messages: [],
			toolUsage,
			cost: 0,
			tokensIn: 0,
			tokensOut: 0,
		})
		expect(record.toolUsage).toHaveLength(2)
		expect(record.toolUsage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "read_file", attempts: 5, failures: 1 }),
				expect.objectContaining({ name: "write_to_file", attempts: 2, failures: 0 }),
			]),
		)
	})

	it("includes cost and token fields", () => {
		const record = buildWorkRecord({
			title: "Task",
			messages: [],
			toolUsage: {},
			cost: 0.1234,
			tokensIn: 1000,
			tokensOut: 500,
			cacheWrites: 200,
			cacheReads: 300,
		})
		expect(record.cost).toBe(0.1234)
		expect(record.tokensIn).toBe(1000)
		expect(record.tokensOut).toBe(500)
		expect(record.cacheWrites).toBe(200)
		expect(record.cacheReads).toBe(300)
	})
})
