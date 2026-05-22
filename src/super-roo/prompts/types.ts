/**
 * Prompt fragment types inspired by Eclipse Theia's prompt system.
 *
 * Theia uses BasePromptFragment / CustomizedPromptFragment to model
 * user-customizable prompt pieces that can be composed at runtime.
 * This module adapts that pattern for SuperRoo's agent system.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/prompt-service.ts
 */

// ──────────────────────────────────────────────────────────────────────────────
// Fragment types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A resolved AI variable — a key/value pair produced after template resolution.
 */
export interface ResolvedAIVariable {
	readonly key: string
	readonly value: string
	readonly description?: string
}

/**
 * Base prompt fragment — the smallest unit of prompt content.
 * Mirrors Theia's BasePromptFragment interface.
 */
export interface BasePromptFragment {
	readonly id: string
	/** The prompt template text. May contain {{variable}} placeholders. */
	readonly template: string
	readonly name?: string
	readonly description?: string

	/** If true, this fragment is exposed as a slash command. */
	readonly isCommand?: boolean
	/** The slash command name (e.g. "fix" for "/fix"). */
	readonly commandName?: string
	/** Description shown in slash command autocomplete. */
	readonly commandDescription?: string
	/** Hint for the argument the command expects. */
	readonly commandArgumentHint?: string
	/** Agent IDs this command is available to. Empty = all agents. */
	readonly commandAgents?: string[]
}

/**
 * A customized prompt fragment — a user override of a built-in fragment.
 * Mirrors Theia's CustomizedPromptFragment interface.
 */
export interface CustomizedPromptFragment extends BasePromptFragment {
	/** Unique ID for this customization instance. */
	readonly customizationId: string
	/** Priority for ordering when multiple customizations target the same fragment. */
	readonly priority: number
}

/**
 * Union type for prompt fragments — either built-in or customized.
 */
export type PromptFragment = BasePromptFragment | CustomizedPromptFragment

/**
 * A resolved prompt fragment — after template variables have been substituted.
 */
export interface ResolvedPromptFragment {
	readonly id: string
	/** The fully resolved text with variables substituted. */
	readonly text: string
	/** Variables that were resolved during substitution. */
	readonly variables?: ResolvedAIVariable[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Fragment collections
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A named collection of prompt fragments for a specific purpose.
 */
export interface PromptFragmentCollection {
	readonly id: string
	readonly name: string
	readonly description: string
	readonly fragments: PromptFragment[]
}

// ──────────────────────────────────────────────────────────────────────────────
// Built-in fragment IDs
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Well-known built-in fragment IDs used by the system.
 */
export const BUILT_IN_FRAGMENTS = {
	/** System prompt preamble for the Coder agent. */
	CODER_SYSTEM_PROMPT: "coder-system-prompt",
	/** System prompt preamble for the Debugger agent. */
	DEBUGGER_SYSTEM_PROMPT: "debugger-system-prompt",
	/** System prompt preamble for the PM agent. */
	PM_SYSTEM_PROMPT: "pm-system-prompt",
	/** System prompt preamble for the Tester agent. */
	TESTER_SYSTEM_PROMPT: "tester-system-prompt",
	/** Safety rules injected into all agent prompts. */
	SAFETY_RULES: "safety-rules",
	/** Tool-use instructions injected into all agent prompts. */
	TOOL_USE_INSTRUCTIONS: "tool-use-instructions",
} as const
