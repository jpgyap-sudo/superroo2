/**
 * SuperContinue FIM Pattern Cache
 *
 * Caches fill-in-middle completions to reduce latency and improve performance.
 */

import * as crypto from "node:crypto"

export interface FIMContext {
	prefix: string
	suffix: string
	filePath?: string
	language?: string
}

export interface CachedCompletion {
	completions: string[]
	timestamp: number
	hitCount: number
}

/**
 * FIM (Fill-in-Middle) pattern cache for autocomplete.
 */
export class FIMCache {
	private static instance: FIMCache | null = null
	private cache = new Map<string, CachedCompletion>()
	private maxSize = 1000
	private ttlMs = 5 * 60 * 1000 // 5 minutes

	private constructor() {}

	static getInstance(): FIMCache {
		if (!FIMCache.instance) {
			FIMCache.instance = new FIMCache()
		}
		return FIMCache.instance
	}

	/**
	 * Get completions from cache.
	 */
	get(context: FIMContext): string[] | null {
		const key = this._hashContext(context)
		const cached = this.cache.get(key)

		if (!cached) return null

		// Check TTL
		if (Date.now() - cached.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return null
		}

		cached.hitCount++
		return cached.completions
	}

	/**
	 * Store completions in cache.
	 */
	set(context: FIMContext, completions: string[]): void {
		// Evict oldest entries if at capacity
		if (this.cache.size >= this.maxSize) {
			this._evictOldest()
		}

		const key = this._hashContext(context)
		this.cache.set(key, {
			completions,
			timestamp: Date.now(),
			hitCount: 0,
		})
	}

	/**
	 * Get completions with FIM tokens, using cache if available.
	 */
	async getCompletions(
		context: FIMContext,
		options?: { maxCompletions?: number; timeoutMs?: number }
	): Promise<string[]> {
		const cached = this.get(context)
		if (cached) {
			return cached.slice(0, options?.maxCompletions ?? 5)
		}

		// Query Ollama with FIM
		const completions = await this._queryFIM(context, options)
		this.set(context, completions)
		return completions
	}

	/**
	 * Query Ollama for FIM completions.
	 */
	private async _queryFIM(
		context: FIMContext,
		options?: { maxCompletions?: number; timeoutMs?: number }
	): Promise<string[]> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10000)

		try {
			const res = await fetch("http://localhost:11434/api/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "qwen2.5-coder:7b",
					prompt: context.prefix,
					suffix: context.suffix,
					stream: false,
				}),
				signal: controller.signal,
			})

			if (!res.ok) {
				throw new Error(`Ollama FIM error: ${res.status}`)
			}

			const json = (await res.json()) as { response?: string }
			const response = json.response || ""

			// Split into multiple completion suggestions
			return response
				.split("\n")
				.filter((l: string) => l.trim())
				.slice(0, options?.maxCompletions ?? 5)
		} finally {
			clearTimeout(timeout)
		}
	}

	/**
	 * Hash context for cache key.
	 */
	private _hashContext(context: FIMContext): string {
		const content = `${context.prefix}\n${context.suffix}\n${context.filePath || ""}\n${context.language || ""}`
		return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32)
	}

	/**
	 * Evict oldest entries.
	 */
	private _evictOldest(): void {
		let oldestKey: string | null = null
		let oldestTime = Infinity

		for (const [key, value] of this.cache) {
			if (value.timestamp < oldestTime) {
				oldestTime = value.timestamp
				oldestKey = key
			}
		}

		if (oldestKey) {
			this.cache.delete(oldestKey)
		}
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): { size: number; maxSize: number; totalHits: number } {
		let totalHits = 0
		for (const value of this.cache.values()) {
			totalHits += value.hitCount
		}
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			totalHits,
		}
	}

	/**
	 * Clear the cache.
	 */
	clear(): void {
		this.cache.clear()
	}
}

export const getFIMCache = (): FIMCache => FIMCache.getInstance()