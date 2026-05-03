import { describe, it, expect } from "vitest"
import { generateWorkRecordMarkdown } from "../exportWorkRecord"
import type { WorkRecord } from "@superroo/types"

const now = Date.now()

function makeWorkRecord(overrides: Partial<WorkRecord> = {}): WorkRecord {
	return {
		title: "Test Task",
		generatedAt: new Date("2026-05-02T12:00:00.000Z").toISOString(),
		...overrides,
	} as WorkRecord
}

describe("generateWorkRecordMarkdown", () => {
	it("renders basic title and generatedAt", () => {
		const record = makeWorkRecord()
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("# Test Task")
		expect(md).toContain("**Generated:** 2026-05-02T12:00:00.000Z")
	})

	it("uses 'Untitled Task' when title is missing", () => {
		const record = makeWorkRecord({ title: undefined })
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("# Untitled Task")
	})

	it("renders cost section when present", () => {
		const record = makeWorkRecord({
			cost: 0.1234,
			tokensIn: 1500,
			tokensOut: 800,
			cacheWrites: 200,
			cacheReads: 100,
		})
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Cost")
		expect(md).toContain("$0.1234")
		expect(md).toContain("1,500 in / 800 out")
		expect(md).toContain("200 writes / 100 reads")
	})

	it("renders cost without tokens when tokens are missing", () => {
		const record = makeWorkRecord({ cost: 0.5 })
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Cost")
		expect(md).toContain("$0.5000")
		expect(md).not.toContain("Tokens:")
	})

	it("renders outcome when present", () => {
		const record = makeWorkRecord({ outcome: "Task completed successfully." })
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Outcome")
		expect(md).toContain("Task completed successfully.")
	})

	it("renders changed files with correct icons", () => {
		const record = makeWorkRecord({
			changedFiles: [
				{ path: "src/index.ts", operation: "create", ts: now },
				{ path: "src/old.ts", operation: "delete", ts: now },
				{ path: "src/fix.ts", operation: "patch", ts: now },
				{ path: "src/edit.ts", operation: "update", ts: now },
			],
		})
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Changed Files (4)")
		expect(md).toContain("➕ `src/index.ts`")
		expect(md).toContain("🗑️ `src/old.ts`")
		expect(md).toContain("🩹 `src/fix.ts`")
		expect(md).toContain("✏️ `src/edit.ts`")
	})

	it("does not render changed files section when empty", () => {
		const record = makeWorkRecord({ changedFiles: [] })
		const md = generateWorkRecordMarkdown(record)
		expect(md).not.toContain("## Changed Files")
	})

	it("does not render changed files section when undefined", () => {
		const record = makeWorkRecord()
		const md = generateWorkRecordMarkdown(record)
		expect(md).not.toContain("## Changed Files")
	})

	it("renders commands with exit badges", () => {
		const record = makeWorkRecord({
			commandsRun: [
				{ command: "npm test", exitCode: 0, ts: now },
				{ command: "npm run build", exitCode: 1, ts: now },
				{ command: "echo hello", ts: now },
			],
		})
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Commands Run (3)")
		expect(md).toContain("npm test")
		expect(md).toContain("(exit 0)")
		expect(md).toContain("(exit 1)")
		expect(md).toContain("echo hello")
	})

	it("renders checkpoints with hash and timestamp", () => {
		const record = makeWorkRecord({
			checkpoints: [{ hash: "abc123", ts: now }],
		})
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Checkpoints (1)")
		expect(md).toContain("`abc123`")
	})

	it("renders tool usage summary", () => {
		const record = makeWorkRecord({
			toolUsage: [
				{ name: "read_file", attempts: 10, failures: 1 },
				{ name: "write_to_file", attempts: 5, failures: 0 },
			],
		})
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Tool Usage")
		expect(md).toContain("**read_file:** 10 attempts, 1 failures")
		expect(md).toContain("**write_to_file:** 5 attempts, 0 failures")
	})

	it("renders follow-up tasks", () => {
		const record = makeWorkRecord({
			followUpTaskIds: ["task-a", "task-b"],
		})
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("## Follow-up Tasks (2)")
		expect(md).toContain("- task-a")
		expect(md).toContain("- task-b")
	})

	it("renders minimal record with only title", () => {
		const record = makeWorkRecord({ generatedAt: undefined })
		const md = generateWorkRecordMarkdown(record)
		expect(md).toContain("# Test Task")
		expect(md).not.toContain("Generated:")
	})
})
