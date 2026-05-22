/**
 * SlashCommandHandler — routes slash commands (e.g. "/fix", "/test", "/deploy")
 * to the appropriate prompt fragments and agent handlers.
 *
 * Inspired by Eclipse Theia's command-based prompt fragment system where
 * BasePromptFragment can declare itself as a command with commandName,
 * commandDescription, commandArgumentHint, and commandAgents.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/prompt-service.ts
 */

import type { PromptFragment } from "../prompts/types"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Result of handling a slash command.
 */
export interface SlashCommandResult {
	/** Whether the command was recognized and handled. */
	handled: boolean
	/** The resolved prompt text to inject. */
	resolvedText?: string
	/** The command name that was matched (without the slash). */
	commandName?: string
	/** The argument string after the command name. */
	argument?: string
	/** Error message if the command failed. */
	error?: string
}

/**
 * A handler function for a specific slash command.
 */
export type SlashCommandHandlerFn = (
	command: string,
	args: string,
	agentId: string,
) => Promise<SlashCommandResult> | SlashCommandResult

// ──────────────────────────────────────────────────────────────────────────────
// SlashCommandHandler
// ──────────────────────────────────────────────────────────────────────────────

export class SlashCommandHandler {
	/** Registered commands keyed by command name (without the "/" prefix). */
	private commands: Map<string, PromptFragment> = new Map()

	/** Custom handler functions for commands that need custom logic. */
	private handlers: Map<string, SlashCommandHandlerFn> = new Map()

	// ──────────────────────────────────────────────────────────────────────────
	// Registration
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Register a slash command from a prompt fragment.
	 * The fragment must have isCommand=true and commandName set.
	 */
	registerCommand(fragment: PromptFragment): void {
		if (!fragment.isCommand || !fragment.commandName) {
			throw new Error(
				`Fragment "${fragment.id}" is not a valid command: isCommand=${fragment.isCommand}, commandName=${fragment.commandName}`,
			)
		}

		const cmdName = fragment.commandName.startsWith("/")
			? fragment.commandName.slice(1)
			: fragment.commandName

		this.commands.set(cmdName, fragment)
	}

	/**
	 * Register a custom handler function for a command.
	 * Overrides the default template-based resolution.
	 */
	registerHandler(
		commandName: string,
		handler: SlashCommandHandlerFn,
	): void {
		const name = commandName.startsWith("/")
			? commandName.slice(1)
			: commandName
		this.handlers.set(name, handler)
	}

	/**
	 * Register multiple commands at once.
	 */
	registerCommands(fragments: PromptFragment[]): void {
		for (const f of fragments) {
			this.registerCommand(f)
		}
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Query
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Get all registered command fragments, optionally filtered by agent.
	 */
	getCommandsForAgent(agentId?: string): PromptFragment[] {
		const result: PromptFragment[] = []

		for (const fragment of this.commands.values()) {
			if (
				!agentId ||
				!fragment.commandAgents ||
				fragment.commandAgents.length === 0 ||
				fragment.commandAgents.includes(agentId)
			) {
				result.push(fragment)
			}
		}

		return result
	}

	/**
	 * Get a command fragment by name.
	 */
	getCommand(commandName: string): PromptFragment | undefined {
		const name = commandName.startsWith("/")
			? commandName.slice(1)
			: commandName
		return this.commands.get(name)
	}

	/**
	 * Check if a command is registered.
	 */
	hasCommand(commandName: string): boolean {
		const name = commandName.startsWith("/")
			? commandName.slice(1)
			: commandName
		return this.commands.has(name) || this.handlers.has(name)
	}

	/**
	 * Get all registered command names (without "/" prefix).
	 */
	getRegisteredCommands(): string[] {
		return Array.from(this.commands.keys())
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Execution
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Parse and handle a slash command from user input.
	 *
	 * Input format: "/commandName arg1 arg2" or just "/commandName"
	 *
	 * Returns a SlashCommandResult indicating whether the command was handled.
	 */
	async handleCommand(
		input: string,
		agentId: string,
	): Promise<SlashCommandResult> {
		const trimmed = input.trim()

		// Must start with "/"
		if (!trimmed.startsWith("/")) {
			return { handled: false }
		}

		// Parse command name and arguments
		const spaceIdx = trimmed.indexOf(" ")
		const cmdName =
			spaceIdx >= 0
				? trimmed.slice(1, spaceIdx).toLowerCase()
				: trimmed.slice(1).toLowerCase()
		const args =
			spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : ""

		// Check custom handler first
		const handler = this.handlers.get(cmdName)
		if (handler) {
			return handler(cmdName, args, agentId)
		}

		// Check registered command fragments
		const fragment = this.commands.get(cmdName)
		if (!fragment) {
			return {
				handled: false,
				error: `Unknown command "/${cmdName}". Type "/help" for available commands.`,
			}
		}

		// Check agent availability
		if (
			fragment.commandAgents &&
			fragment.commandAgents.length > 0 &&
			!fragment.commandAgents.includes(agentId)
		) {
			return {
				handled: false,
				error: `Command "/${cmdName}" is not available for agent "${agentId}".`,
			}
		}

		// Resolve the template with the argument as context
		const resolvedText = fragment.template.replace(
			/\{\{args\}\}/g,
			args,
		)

		return {
			handled: true,
			resolvedText,
			commandName: cmdName,
			argument: args || undefined,
		}
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Built-in commands
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Register the built-in "/help" command.
	 */
	registerHelpCommand(): void {
		const helpFragment: PromptFragment = {
			id: "builtin-help",
			template: `Available commands:\n{{commandList}}`,
			name: "Help",
			description: "Show available slash commands",
			isCommand: true,
			commandName: "help",
			commandDescription: "Show available slash commands",
			commandArgumentHint: "[command-name]",
		}

		this.commands.set("help", helpFragment)

		// Register a custom handler that dynamically builds the help text
		this.handlers.set("help", async (_cmd, args, agentId) => {
			const commands = this.getCommandsForAgent(agentId)

			if (args) {
				// Show help for a specific command
				const specific = commands.find(
					(c) =>
						c.commandName === args ||
						c.commandName === args.toLowerCase(),
				)
				if (specific) {
					const hint = specific.commandArgumentHint
						? ` ${specific.commandArgumentHint}`
						: ""
					return {
						handled: true,
						resolvedText: `**/${specific.commandName}${hint}** — ${specific.commandDescription ?? specific.description ?? "No description"}`,
						commandName: "help",
						argument: args,
					}
				}
				return {
					handled: true,
					resolvedText: `Unknown command "${args}". Type "/help" for available commands.`,
					commandName: "help",
					argument: args,
				}
			}

			// List all available commands
			const commandList = commands
				.map((c) => {
					const hint = c.commandArgumentHint
						? ` ${c.commandArgumentHint}`
						: ""
					const desc = c.commandDescription ?? c.description ?? ""
					return `  **/${c.commandName}${hint}** — ${desc}`
				})
				.join("\n")

			return {
				handled: true,
				resolvedText: `**Available commands:**\n${commandList}\n\nType "/help <command>" for details on a specific command.`,
				commandName: "help",
			}
		})
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Remove a registered command.
	 */
	unregisterCommand(commandName: string): void {
		const name = commandName.startsWith("/")
			? commandName.slice(1)
			: commandName
		this.commands.delete(name)
		this.handlers.delete(name)
	}

	/**
	 * Clear all registered commands.
	 */
	clear(): void {
		this.commands.clear()
		this.handlers.clear()
	}
}
