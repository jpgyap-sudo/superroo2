/**
 * PromptService — resolves prompt fragments, manages variant selection,
 * and provides slash command discovery.
 *
 * Inspired by Eclipse Theia's PromptService which manages BasePromptFragment
 * and CustomizedPromptFragment collections with variant resolution.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/prompt-service.ts
 */

import type {
	BasePromptFragment,
	CustomizedPromptFragment,
	PromptFragment,
	ResolvedPromptFragment,
	ResolvedAIVariable,
} from "./types"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tracks variant selection state for an agent's prompt variant sets.
 */
interface VariantSelection {
	/** The variant set ID. */
	setId: string
	/** The currently selected variant ID. */
	variantId: string
}

/**
 * A registered variant set with its variant fragment IDs.
 */
interface VariantSetEntry {
	defaultVariant: string
	variants: string[]
}

// ──────────────────────────────────────────────────────────────────────────────
// PromptService
// ──────────────────────────────────────────────────────────────────────────────

export class PromptService {
	/** Built-in fragments keyed by fragment ID. */
	private builtInFragments: Map<string, PromptFragment> = new Map()

	/** Custom fragments keyed by the fragment ID they override. */
	private customFragments: Map<string, CustomizedPromptFragment[]> = new Map()

	/** Registered variant sets keyed by set ID. */
	private variantSets: Map<string, VariantSetEntry> = new Map()

	/** Per-agent variant selections. Key = agentId, value = array of selections. */
	private agentSelections: Map<string, VariantSelection[]> = new Map()

	// ──────────────────────────────────────────────────────────────────────────
	// Fragment registration
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Register a built-in prompt fragment.
	 * Overwrites any existing fragment with the same ID.
	 */
	registerFragment(fragment: PromptFragment): void {
		this.builtInFragments.set(fragment.id, fragment)
	}

	/**
	 * Register multiple built-in fragments at once.
	 */
	registerFragments(fragments: PromptFragment[]): void {
		for (const f of fragments) {
			this.registerFragment(f)
		}
	}

	/**
	 * Register a variant set with its default variant and variant fragment IDs.
	 * The variant fragments must already be registered via registerFragment().
	 */
	registerVariantSet(
		setId: string,
		defaultVariant: string,
		variants: string[],
	): void {
		this.variantSets.set(setId, { defaultVariant, variants })
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Customization
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Create a customization for a built-in fragment.
	 * The customization starts as a copy of the built-in fragment.
	 */
	async createCustomization(fragmentId: string): Promise<void> {
		const builtIn = this.builtInFragments.get(fragmentId)
		if (!builtIn) {
			throw new Error(`No built-in fragment found with id "${fragmentId}"`)
		}

		const customizationId = `${fragmentId}-custom-${Date.now()}`
		const customization: CustomizedPromptFragment = {
			...builtIn,
			customizationId,
			priority: 0,
		}

		const existing = this.customFragments.get(fragmentId) ?? []
		existing.push(customization)
		existing.sort((a, b) => b.priority - a.priority) // highest priority first
		this.customFragments.set(fragmentId, existing)
	}

	/**
	 * Edit an existing customization's template.
	 */
	async editCustomization(
		fragmentId: string,
		customizationId: string,
		newTemplate?: string,
		newPriority?: number,
	): Promise<void> {
		const existing = this.customFragments.get(fragmentId)
		if (!existing) {
			throw new Error(
				`No customizations found for fragment "${fragmentId}"`,
			)
		}

		const idx = existing.findIndex(
			(c) => c.customizationId === customizationId,
		)
		if (idx === -1) {
			throw new Error(
				`No customization found with id "${customizationId}" for fragment "${fragmentId}"`,
			)
		}

		if (newTemplate !== undefined) {
			existing[idx] = { ...existing[idx], template: newTemplate }
		}
		if (newPriority !== undefined) {
			existing[idx] = { ...existing[idx], priority: newPriority }
		}

		existing.sort((a, b) => b.priority - a.priority)
		this.customFragments.set(fragmentId, existing)
	}

	/**
	 * Remove a customization.
	 */
	async removeCustomization(
		fragmentId: string,
		customizationId: string,
	): Promise<void> {
		const existing = this.customFragments.get(fragmentId)
		if (!existing) return

		const filtered = existing.filter(
			(c) => c.customizationId !== customizationId,
		)
		if (filtered.length === 0) {
			this.customFragments.delete(fragmentId)
		} else {
			this.customFragments.set(fragmentId, filtered)
		}
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Variant selection
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Update the selected variant for an agent's variant set.
	 */
	async updateSelectedVariant(
		agentId: string,
		variantSetId: string,
		variantId: string,
	): Promise<void> {
		const set = this.variantSets.get(variantSetId)
		if (!set) {
			throw new Error(`No variant set found with id "${variantSetId}"`)
		}
		if (!set.variants.includes(variantId) && set.defaultVariant !== variantId) {
			throw new Error(
				`Variant "${variantId}" is not part of set "${variantSetId}"`,
			)
		}

		const selections = this.agentSelections.get(agentId) ?? []
		const existingIdx = selections.findIndex(
			(s) => s.setId === variantSetId,
		)

		if (existingIdx >= 0) {
			selections[existingIdx] = { setId: variantSetId, variantId }
		} else {
			selections.push({ setId: variantSetId, variantId })
		}

		this.agentSelections.set(agentId, selections)
	}

	/**
	 * Get the selected variant ID for an agent's variant set.
	 * Falls back to the default variant if no selection has been made.
	 */
	getSelectedVariant(agentId: string, variantSetId: string): string {
		const set = this.variantSets.get(variantSetId)
		if (!set) {
			throw new Error(`No variant set found with id "${variantSetId}"`)
		}

		const selections = this.agentSelections.get(agentId)
		if (selections) {
			const sel = selections.find((s) => s.setId === variantSetId)
			if (sel) return sel.variantId
		}

		return set.defaultVariant
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Resolution
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Resolve a prompt fragment by ID, substituting variables.
	 *
	 * Resolution order:
	 * 1. Custom fragments (highest priority first)
	 * 2. Built-in fragment
	 * 3. Returns undefined if not found
	 */
	async getResolvedPromptFragment(
		id: string,
		variables?: Record<string, unknown>,
	): Promise<ResolvedPromptFragment | undefined> {
		// Try custom fragments first (highest priority wins)
		const customs = this.customFragments.get(id)
		const template =
			customs && customs.length > 0
				? customs[0].template
				: this.builtInFragments.get(id)?.template

		if (template === undefined) {
			return undefined
		}

		const resolved = this.resolveTemplate(template, variables)
		return {
			id,
			text: resolved.text,
			variables: resolved.variables,
		}
	}

	/**
	 * Resolve a specific variant of a variant set.
	 */
	async getResolvedVariant(
		variantSetId: string,
		variantId: string,
		variables?: Record<string, unknown>,
	): Promise<ResolvedPromptFragment | undefined> {
		const set = this.variantSets.get(variantSetId)
		if (!set) return undefined

		// The variant ID is the fragment ID for that variant's template
		return this.getResolvedPromptFragment(variantId, variables)
	}

	/**
	 * Resolve the currently selected variant for an agent.
	 */
	async getResolvedAgentVariant(
		agentId: string,
		variantSetId: string,
		variables?: Record<string, unknown>,
	): Promise<ResolvedPromptFragment | undefined> {
		const variantId = this.getSelectedVariant(agentId, variantSetId)
		return this.getResolvedVariant(variantSetId, variantId, variables)
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Slash commands
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Get all slash commands available to an agent.
	 */
	getCommands(agentId?: string): PromptFragment[] {
		const commands: PromptFragment[] = []

		// Collect from built-in fragments
		for (const fragment of this.builtInFragments.values()) {
			if (fragment.isCommand) {
				if (
					!agentId ||
					!fragment.commandAgents ||
					fragment.commandAgents.length === 0 ||
					fragment.commandAgents.includes(agentId)
				) {
					commands.push(fragment)
				}
			}
		}

		// Collect from custom fragments
		for (const customs of this.customFragments.values()) {
			for (const fragment of customs) {
				if (fragment.isCommand) {
					if (
						!agentId ||
						!fragment.commandAgents ||
						fragment.commandAgents.length === 0 ||
						fragment.commandAgents.includes(agentId)
					) {
						commands.push(fragment)
					}
				}
			}
		}

		return commands
	}

	/**
	 * Get all registered fragment IDs.
	 */
	getRegisteredFragmentIds(): string[] {
		return Array.from(this.builtInFragments.keys())
	}

	/**
	 * Get all registered variant set IDs.
	 */
	getRegisteredVariantSetIds(): string[] {
		return Array.from(this.variantSets.keys())
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Internal helpers
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Resolve {{variable}} placeholders in a template string.
	 */
	private resolveTemplate(
		template: string,
		variables?: Record<string, unknown>,
	): { text: string; variables: ResolvedAIVariable[] } {
		if (!variables || Object.keys(variables).length === 0) {
			return { text: template, variables: [] }
		}

		const resolvedVars: ResolvedAIVariable[] = []
		let text = template

		for (const [key, value] of Object.entries(variables)) {
			const placeholder = `{{${key}}}`
			if (text.includes(placeholder)) {
				const strValue = String(value ?? "")
				text = text.replaceAll(placeholder, strValue)
				resolvedVars.push({
					key,
					value: strValue,
				})
			}
		}

		return { text, variables: resolvedVars }
	}
}
