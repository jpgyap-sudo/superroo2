/**
 * ProviderRegistry — Central registry for LanguageModelProvider instances.
 *
 * Manages provider registration, lookup, selection, and reasoning support queries.
 * Integrates with the existing settings system (providerSync, modelRouter) to
 * provide a unified provider abstraction layer.
 *
 * Inspired by Eclipse Theia's LanguageModelRegistry which manages available
 * language models and their capabilities.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/language-model.ts
 */

import type { LanguageModelProvider, ProviderSelector, ReasoningLevel } from "./types"

export class ProviderRegistry {
	private providers: Map<string, LanguageModelProvider> = new Map()

	/**
	 * Register a provider. Overwrites if a provider with the same ID exists.
	 */
	register(provider: LanguageModelProvider): void {
		this.providers.set(provider.id, provider)
	}

	/**
	 * Register multiple providers at once.
	 */
	registerProviders(providers: LanguageModelProvider[]): void {
		for (const p of providers) {
			this.register(p)
		}
	}

	/**
	 * Get a provider by ID.
	 */
	getProvider(id: string): LanguageModelProvider | undefined {
		return this.providers.get(id)
	}

	/**
	 * Get all registered providers.
	 */
	getProviders(): LanguageModelProvider[] {
		return Array.from(this.providers.values())
	}

	/**
	 * Select the best provider for a given request.
	 *
	 * Selection priority:
	 * 1. preferredProvider (if specified and registered)
	 * 2. Provider with matching requiredCapabilities
	 * 3. First available provider
	 */
	selectProvider(request: ProviderSelector): LanguageModelProvider | undefined {
		// If a preferred provider is specified, try it first
		if (request.preferredProvider) {
			const preferred = this.providers.get(request.preferredProvider)
			if (preferred && this.matchesCapabilities(preferred, request.requiredCapabilities)) {
				return preferred
			}
		}

		// Otherwise, find the first provider matching required capabilities
		if (request.requiredCapabilities && request.requiredCapabilities.length > 0) {
			for (const provider of this.providers.values()) {
				if (this.matchesCapabilities(provider, request.requiredCapabilities)) {
					return provider
				}
			}
		}

		// Fall back to first registered provider
		return this.providers.values().next().value
	}

	/**
	 * Get the supported reasoning levels for a provider.
	 * Returns empty array if the provider doesn't support reasoning.
	 */
	getSupportedReasoningLevels(providerId: string): ReadonlyArray<ReasoningLevel> {
		const provider = this.providers.get(providerId)
		return provider?.reasoning?.supportedLevels ?? []
	}

	/**
	 * Check if a provider has a specific capability.
	 */
	hasCapability(providerId: string, capability: string): boolean {
		const provider = this.providers.get(providerId)
		return provider?.capabilities.includes(capability) ?? false
	}

	/**
	 * Remove a provider by ID.
	 */
	unregister(providerId: string): boolean {
		return this.providers.delete(providerId)
	}

	/**
	 * Clear all registered providers.
	 */
	clear(): void {
		this.providers.clear()
	}

	/**
	 * Get the count of registered providers.
	 */
	get size(): number {
		return this.providers.size
	}

	/**
	 * Check if a provider matches all required capabilities.
	 */
	private matchesCapabilities(
		provider: LanguageModelProvider,
		requiredCapabilities?: string[],
	): boolean {
		if (!requiredCapabilities || requiredCapabilities.length === 0) return true
		return requiredCapabilities.every((cap) => provider.capabilities.includes(cap))
	}
}
