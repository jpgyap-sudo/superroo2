/**
 * Chat system barrel export.
 *
 * Provides the SlashCommandHandler for routing slash commands
 * to prompt fragments and agent handlers.
 */

export { SlashCommandHandler } from "./SlashCommandHandler"

export type {
	SlashCommandResult,
	SlashCommandHandlerFn,
} from "./SlashCommandHandler"
