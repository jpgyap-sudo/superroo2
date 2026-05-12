import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../ToolRegistry.js"
import type { ToolCall } from "../types.js"

describe("ToolRegistry", () => {
	it("classifies safe tools", () => {
		const registry = new ToolRegistry()
		const call: ToolCall = { name: "read_file", args: { path: "src/index.ts" } }
		expect(registry.classify(call)).toBe("safe")
	})

	it("classifies blocked tools", () => {
		const registry = new ToolRegistry()
		const call: ToolCall = { name: "run_command", args: { cmd: "rm -rf /" } }
		expect(registry.classify(call)).toBe("blocked")
	})

	it("classifies approval-required tools", () => {
		const registry = new ToolRegistry()
		const call: ToolCall = { name: "run_command", args: { cmd: "sudo apt update" } }
		expect(registry.classify(call)).toBe("approval_required")
	})

	it("registers and executes custom tools", async () => {
		const registry = new ToolRegistry()
		registry.register({
			name: "greet",
			description: "Says hello",
			parameters: {},
			safety: "safe",
			async handler(args) {
				return `Hello ${(args.name as string) ?? "world"}!`
			},
		})

		const result = await registry.execute({ name: "greet", args: { name: "SuperRoo" } })
		expect(result.status).toBe("success")
		expect(result.output).toContain("Hello SuperRoo!")
	})

	it("returns not_implemented for unregistered tools", async () => {
		const registry = new ToolRegistry()
		const result = await registry.execute({ name: "unknown", args: {} })
		expect(result.status).toBe("not_implemented")
	})

	it("blocks execution of unsafe tools", async () => {
		const registry = new ToolRegistry()
		await expect(registry.execute({ name: "run_command", args: { cmd: "rm -rf /" } })).rejects.toThrow(
			"Blocked unsafe tool call",
		)
	})

	it("requires approval for risky tools", async () => {
		const registry = new ToolRegistry()
		await expect(registry.execute({ name: "run_command", args: { cmd: "sudo apt update" } })).rejects.toThrow(
			"Approval required for tool call",
		)
	})
})
