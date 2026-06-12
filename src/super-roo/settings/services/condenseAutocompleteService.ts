/**
 * Condense Autocomplete Service — provides inline completions for condensed context.
 *
 * This service integrates with the AI Model Router to select the best model
 * for autocomplete tasks, with a preference for local Ollama (offline-capable)
 * and fallback to cloud providers.
 *
 * Flow:
 * 1. Check model router for `condense_autocomplete` route
 * 2. Call selected model with partial message
 * 3. Return completion
 * 4. Fall back to local Ollama if router fails
 */

import { listRoutes, selectUsableModel } from "./modelRouterService"
import type { ModelRoute } from "./modelRouterTypes"
import { LRUCache } from 'lru-cache'

// Add caching configuration
const COMPLETION_CACHE = new LRUCache<string, string>({
  max: 100,
  maxAge: 1000 * 60 // 1 minute
})

// ── Configuration ─────────────────────────────────────────────────────────────

const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434"
const LOCAL_OLLAMA_MODEL = "qwen2.5-coder:1.5b"
const COMPLETION_TIMEOUT_MS = 3000
const MIN_COMPLETION_LENGTH = 2

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CondenseAutocompleteRequest {
	/** The partial message to complete */
	partialMessage: string
	/** Optional context from the conversation */
	context?: string
	/** Maximum tokens to generate */
	maxTokens?: number
}

export interface CondenseAutocompleteResponse {
	/** The completed text */
	completion: string
	/** Provider that generated the completion */
	provider: string
	/** Model that generated the completion */
	model: string
	/** Whether this was a fallback to local Ollama */
	isLocalFallback: boolean
	/** Latency in milliseconds */
	latencyMs: number
}

export interface CondenseAutocompleteError {
	error: string
	code: "no_route" | "no_model" | "generation_failed" | "timeout" | "invalid_input"
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate an autocomplete completion for a partial condensed message.
 */
export async function generateAutocomplete(
  request: CondenseAutocompleteRequest,
): Promise<CondenseAutocompleteResponse> {
  // Validate input
  if (!request.partialMessage || request.partialMessage.trim().length < MIN_COMPLETION_LENGTH) {
    throw {
      error: `Partial message must be at least ${MIN_COMPLETION_LENGTH} characters`,
      code: "invalid_input" as const,
    } satisfies CondenseAutocompleteError
  }

  const startTime = Date.now()

  // Check cache first
  const cacheKey = `${request.partialMessage}|${request.context || ''}`
  const cached = COMPLETION_CACHE.get(cacheKey)
  if (cached) {
    return {
      completion: cached,
      provider: 'cache',
      model: 'local-cache',
      isLocalFallback: true,
      latencyMs: 0,
    }
  }

  // Try model router first
  try {
    const route = await getCondenseAutocompleteRoute()
    if (route) {
      const result = await generateViaRoute(route, request)
      if (result) {
        const response = {
          ...result,
          latencyMs: Date.now() - startTime,
          provider: 'router',
        }
        // Cache successful results
        COMPLETION_CACHE.set(cacheKey, result.completion)
        return response
      }
    }
  } catch (error) {
    console.warn("[condense-autocomplete] Router failed, falling back to local Ollama:", error)
    if (error && typeof error === "object" && "code" in error) {
      throw error
    }
  }

  // Fallback to local Ollama
  try {
    const result = await generateViaLocalOllama(request)
    const response = {
      ...result,
      latencyMs: Date.now() - startTime,
      provider: 'ollama',
    }
    // Cache successful results
    COMPLETION_CACHE.set(cacheKey, result.completion)
    return response
  } catch (error) {
    console.error("[condense-autocomplete] Local Ollama fallback failed:", error)
    throw {
      error: `Autocomplete generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      code: "generation_failed" as const,
    } satisfies CondenseAutocompleteError
  }
}

export function clearAutocompleteCache(): void {
  COMPLETION_CACHE.clear()
}

/**
 * Check if condense autocomplete is available.
 */
export async function isAutocompleteAvailable(): Promise<boolean> {
	// Check local Ollama first (fastest, no network)
	if (await isLocalOllamaAvailable()) {
		return true
	}

	// Check model router
	try {
		const route = await getCondenseAutocompleteRoute()
		return route !== null
	} catch {
		return false
	}
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function getCondenseAutocompleteRoute(): Promise<ModelRoute | null> {
	const routes = await listRoutes()
	const route = routes.find((r) => r.taskType === "condense_autocomplete" && r.enabled)
	if (!route) return null

	// Verify at least one provider/model is usable
	const selected = await selectUsableModel(route)
	if (!selected.ok) return null

	return route
}

async function generateViaRoute(
	route: ModelRoute,
	request: CondenseAutocompleteRequest,
): Promise<Omit<CondenseAutocompleteResponse, "latencyMs"> | null> {
	const candidates = [
		[route.primaryProvider, route.primaryModel],
		[route.fallbackProvider1, route.fallbackModel1],
		[route.fallbackProvider2, route.fallbackModel2],
	].filter(([p, m]) => p && m) as [string, string][]

	for (const [providerId, modelId] of candidates) {
		try {
			const completion = await generateWithProvider(providerId, modelId, request)
			if (completion) {
				return {
					completion,
					provider: providerId,
					model: modelId,
					isLocalFallback: false,
				}
			}
		} catch (error) {
			console.warn(`[condense-autocomplete] Provider ${providerId}/${modelId} failed:`, error)
			continue
		}
	}

	return null
}

async function generateWithProvider(
	providerId: string,
	modelId: string,
	request: CondenseAutocompleteRequest,
): Promise<string | null> {
	// This is a placeholder for actual provider API calls.
	// In production, this would use the existing provider client infrastructure.
	// For now, we only support local Ollama directly.
	if (providerId === "ollama") {
		return generateViaLocalOllama(request).then((r) => r.completion)
	}

	// Cloud providers would be implemented here using the existing API client
	console.warn(`[condense-autocomplete] Provider ${providerId} not yet implemented for autocomplete`)
	return null
}

async function generateViaLocalOllama(
	request: CondenseAutocompleteRequest,
): Promise<Omit<CondenseAutocompleteResponse, "latencyMs">> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS)

	try {
		const response = await fetch(`${LOCAL_OLLAMA_URL}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: LOCAL_OLLAMA_MODEL,
				prompt: buildPrompt(request.partialMessage, request.context),
				stream: false,
				options: {
					num_predict: Math.min(request.maxTokens ?? 64, 64),
					temperature: 0.3,
					top_p: 0.9,
					stop: ["\n\n", "```", "---"],
				},
			}),
			signal: controller.signal,
		})

		if (!response.ok) {
			throw new Error(`Ollama API returned ${response.status}: ${response.statusText}`)
		}

		const data = (await response.json()) as { response?: string; error?: string }
		if (data.error) {
			throw new Error(data.error)
		}

		const completion = (data.response ?? "").trim()
		if (!completion || completion.length < MIN_COMPLETION_LENGTH) {
			throw new Error("Completion too short or empty")
		}

		return {
			completion,
			provider: "ollama",
			model: LOCAL_OLLAMA_MODEL,
			isLocalFallback: true,
		}
	} finally {
		clearTimeout(timeoutId)
	}
}

async function isLocalOllamaAvailable(): Promise<boolean> {
	try {
		const response = await fetch(`${LOCAL_OLLAMA_URL}/api/tags`, {
			method: "GET",
			signal: AbortSignal.timeout(1000),
		})
		if (!response.ok) return false

		const data = (await response.json()) as { models?: Array<{ name: string }> }
		return data.models?.some((m) => m.name === LOCAL_OLLAMA_MODEL) ?? false
	} catch {
		return false
	}
}

function buildPrompt(partialMessage: string, context?: string): string {
	const trimmed = partialMessage.trim()
	// Split into prefix (what user has typed) and suffix (what comes after cursor)
	// For autocomplete, we treat the entire partial message as prefix
	// and use empty suffix since we don't know what comes next
	const prefix = trimmed
	const suffix = ""

	// Use FIM template for QwenCoder 2.5 1.5B
	// This format is specifically designed for code completion models
	const fimPrompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`

	// Add minimal context hint if available
	const contextBlock = context ? `\n// Context: ${context.slice(-500)}\n` : ""

	return `${contextBlock}${fimPrompt}`
}
