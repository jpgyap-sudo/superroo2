import { describe, expect, it, beforeEach } from "vitest"

import { SlashCommandHandler } from "../SlashCommandHandler"
import type { PromptFragment } from "../../prompts/types"

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeCommand(overrides: Partial<PromptFragment> & { commandName: string }): PromptFragment {
	return {
		id: `cmd-${overrides.commandName}`,
		template: "Execute: {{args}}",
		name: `/${overrides.commandName}`,
		description: `The /${overrides.commandName} command`,
		isCommand: true,
		commandDescription: `Execute the ${overrides.commandName} action`,
		...overrides,
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("SlashCommandHandler", () => {
	let handler: SlashCommandHandler

	beforeEach(() => {
		handler = new SlashCommandHandler()
	})

	describe("command registration", () => {
		it("registers a single command", () => {
			handler.registerCommand(makeCommand({ commandName: "test" }))
			expect(handler.hasCommand("test")).toBe(true)
			expect(handler.hasCommand("/test")).toBe(true)
		})

		it("registers multiple commands at once", () => {
			handler.registerCommands([
				makeCommand({ commandName: "fix" }),
				makeCommand({ commandName: "test" }),
			])
			expect(handler.hasCommand("fix")).toBe(true)
			expect(handler.hasCommand("test")).toBe(true)
		})

		it("throws when registering a fragment without isCommand", () => {
			expect(() =>
				handler.registerCommand({
					id: "bad",
					template: "noop",
					commandName: "bad",
				} as PromptFragment),
			).toThrow("not a valid command")
		})

		it("throws when registering a fragment without commandName", () => {
			expect(() =>
				handler.registerCommand({
					id: "bad",
					template: "noop",
					isCommand: true,
				} as PromptFragment),
			).toThrow("not a valid command")
		})

		it("normalizes command names with leading slash", () => {
			handler.registerCommand(makeCommand({ commandName: "/fix" }))
			expect(handler.hasCommand("fix")).toBe(true)
		})
	})

	describe("command querying", () => {
		it("returns commands for a specific agent", () => {
			handler.registerCommand(
				makeCommand({ commandName: "fix", commandAgents: ["coder"] }),
			)
			handler.registerCommand(
				makeCommand({ commandName: "deploy", commandAgents: ["pm"] }),
			)

			const coderCommands = handler.getCommandsForAgent("coder")
			expect(coderCommands).toHaveLength(1)
			expect(coderCommands[0].commandName).toBe("fix")

			const pmCommands = handler.getCommandsForAgent("pm")
			expect(pmCommands).toHaveLength(1)
			expect(pmCommands[0].commandName).toBe("deploy")
		})

		it("returns all commands when no agentId specified", () => {
			handler.registerCommand(makeCommand({ commandName: "fix" }))
			handler.registerCommand(makeCommand({ commandName: "deploy" }))

			const all = handler.getCommandsForAgent()
			expect(all).toHaveLength(2)
		})

		it("returns commands available to all agents when commandAgents is empty", () => {
			handler.registerCommand(
				makeCommand({ commandName: "help", commandAgents: [] }),
			)
			expect(handler.getCommandsForAgent("coder")).toHaveLength(1)
			expect(handler.getCommandsForAgent("debugger")).toHaveLength(1)
		})

		it("gets a specific command by name", () => {
			handler.registerCommand(makeCommand({ commandName: "fix" }))
			const cmd = handler.getCommand("fix")
			expect(cmd).toBeDefined()
			expect(cmd!.commandName).toBe("fix")
		})

		it("returns undefined for unknown command", () => {
			expect(handler.getCommand("nonexistent")).toBeUndefined()
		})

		it("lists all registered command names", () => {
			handler.registerCommands([
				makeCommand({ commandName: "fix" }),
				makeCommand({ commandName: "test" }),
			])
			const names = handler.getRegisteredCommands()
			expect(names).toContain("fix")
			expect(names).toContain("test")
		})
	})

	describe("command execution", () => {
		it("handles a simple command without arguments", async () => {
			handler.registerCommand(
				makeCommand({
					commandName: "status",
					template: "Show system status",
				}),
			)
			const result = await handler.handleCommand("/status", "coder")
			expect(result.handled).toBe(true)
			expect(result.commandName).toBe("status")
			expect(result.resolvedText).toBe("Show system status")
		})

		it("passes arguments to the template", async () => {
			handler.registerCommand(
				makeCommand({
					commandName: "fix",
					template: "Fix the following issue: {{args}}",
				}),
			)
			const result = await handler.handleCommand(
				"/fix memory leak in cache",
				"coder",
			)
			expect(result.handled).toBe(true)
			expect(result.commandName).toBe("fix")
			expect(result.argument).toBe("memory leak in cache")
			expect(result.resolvedText).toBe(
				"Fix the following issue: memory leak in cache",
			)
		})

		it("returns handled=false for non-slash input", async () => {
			const result = await handler.handleCommand(
				"just a normal message",
				"coder",
			)
			expect(result.handled).toBe(false)
		})

		it("returns handled=false for unknown command", async () => {
			const result = await handler.handleCommand("/unknown", "coder")
			expect(result.handled).toBe(false)
			expect(result.error).toContain("Unknown command")
		})

		it("rejects command not available for the agent", async () => {
			handler.registerCommand(
				makeCommand({ commandName: "fix", commandAgents: ["coder"] }),
			)
			const result = await handler.handleCommand("/fix", "debugger")
			expect(result.handled).toBe(false)
			expect(result.error).toContain("not available")
		})

		it("handles command with leading whitespace", async () => {
			handler.registerCommand(
				makeCommand({ commandName: "help", template: "Help text" }),
			)
			const result = await handler.handleCommand("  /help", "coder")
			expect(result.handled).toBe(true)
		})
	})

	describe("custom handlers", () => {
		it("calls a custom handler instead of template resolution", async () => {
			handler.registerHandler("custom", async (_cmd, args, _agentId) => ({
				handled: true,
				resolvedText: `Custom handled: ${args}`,
				commandName: "custom",
				argument: args,
			}))

			const result = await handler.handleCommand(
				"/custom hello world",
				"coder",
			)
			expect(result.handled).toBe(true)
			expect(result.resolvedText).toBe("Custom handled: hello world")
		})

		it("custom handler takes precedence over registered fragment", async () => {
			handler.registerCommand(
				makeCommand({ commandName: "test", template: "template version" }),
			)
			handler.registerHandler("test", async () => ({
				handled: true,
				resolvedText: "handler version",
				commandName: "test",
			}))

			const result = await handler.handleCommand("/test", "coder")
			expect(result.resolvedText).toBe("handler version")
		})
	})

	describe("built-in /help command", () => {
		beforeEach(() => {
			handler.registerHelpCommand()
		})

		it("registers the /help command", () => {
			expect(handler.hasCommand("help")).toBe(true)
		})

		it("returns a list of available commands", async () => {
			handler.registerCommand(
				makeCommand({
					commandName: "fix",
					commandDescription: "Fix an issue",
				}),
			)

			const result = await handler.handleCommand("/help", "coder")
			expect(result.handled).toBe(true)
			expect(result.resolvedText).toContain("Available commands")
			expect(result.resolvedText).toContain("/fix")
		})

		it("shows help for a specific command", async () => {
			handler.registerCommand(
				makeCommand({
					commandName: "fix",
					commandDescription: "Fix an issue",
					commandArgumentHint: "<description>",
				}),
			)

			const result = await handler.handleCommand("/help fix", "coder")
			expect(result.handled).toBe(true)
			expect(result.resolvedText).toContain("/fix")
			expect(result.resolvedText).toContain("<description>")
			expect(result.resolvedText).toContain("Fix an issue")
		})

		it("shows error for unknown help topic", async () => {
			const result = await handler.handleCommand(
				"/help nonexistent",
				"coder",
			)
			expect(result.handled).toBe(true)
			expect(result.resolvedText).toContain("Unknown command")
		})
	})

	describe("lifecycle", () => {
		it("unregisters a command", () => {
			handler.registerCommand(makeCommand({ commandName: "fix" }))
			expect(handler.hasCommand("fix")).toBe(true)
			handler.unregisterCommand("fix")
			expect(handler.hasCommand("fix")).toBe(false)
		})

		it("unregisters a command with leading slash", () => {
			handler.registerCommand(makeCommand({ commandName: "fix" }))
			handler.unregisterCommand("/fix")
			expect(handler.hasCommand("fix")).toBe(false)
		})

		it("clears all commands", () => {
			handler.registerCommands([
				makeCommand({ commandName: "fix" }),
				makeCommand({ commandName: "test" }),
			])
			handler.clear()
			expect(handler.getRegisteredCommands()).toHaveLength(0)
		})
	})
})
