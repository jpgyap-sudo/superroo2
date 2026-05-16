/**
 * Provider key testing service.
 *
 * Tests API key validity against each provider's verification endpoint.
 * Uses real HTTP calls in production; returns structured results.
 */

export type ProviderTestResult = {
	ok: boolean
	latencyMs: number
	message: string
	models?: string[]
}

type ProviderTestFn = (apiKey: string) => Promise<ProviderTestResult>

const PROVIDER_TESTERS: Record<string, ProviderTestFn> = {
	openai: testOpenAI,
	anthropic: testAnthropic,
	deepseek: testDeepSeek,
	kimi: testKimi,
	openrouter: testOpenRouter,
	groq: testGroq,
}

/**
 * Test a provider API key against its verification endpoint.
 */
export async function testProviderKey(providerId: string, apiKey: string): Promise<ProviderTestResult> {
	const tester = PROVIDER_TESTERS[providerId]
	if (!tester) {
		return {
			ok: false,
			latencyMs: 0,
			message: `Unknown provider: ${providerId}. No tester registered.`,
		}
	}
	return tester(apiKey)
}

/**
 * List all registered provider IDs that have testers.
 */
export function getTestableProviders(): string[] {
	return Object.keys(PROVIDER_TESTERS)
}

// ── Individual provider testers ──────────────────────────────────────────────

async function testOpenAI(apiKey: string): Promise<ProviderTestResult> {
	const start = Date.now()
	try {
		const res = await fetch("https://api.openai.com/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = (await res.json()) as { data?: { id: string }[] }
			const models = (body.data ?? []).map((m) => m.id).slice(0, 10)
			return { ok: true, latencyMs, message: "Connected", models }
		}
		const err = (await res.json()) as { error?: { message?: string } }
		return { ok: false, latencyMs, message: err.error?.message ?? `HTTP ${res.status}` }
	} catch (err: unknown) {
		const latencyMs = Date.now() - start
		return { ok: false, latencyMs, message: (err as Error).message }
	}
}

async function testAnthropic(apiKey: string): Promise<ProviderTestResult> {
	const start = Date.now()
	try {
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "claude-3-haiku-20240307",
				max_tokens: 1,
				messages: [{ role: "user", content: "ping" }],
			}),
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			return { ok: true, latencyMs, message: "Connected" }
		}
		const err = (await res.json()) as { error?: { message?: string } }
		return { ok: false, latencyMs, message: err.error?.message ?? `HTTP ${res.status}` }
	} catch (err: unknown) {
		const latencyMs = Date.now() - start
		return { ok: false, latencyMs, message: (err as Error).message }
	}
}

async function testDeepSeek(apiKey: string): Promise<ProviderTestResult> {
	const start = Date.now()
	try {
		const res = await fetch("https://api.deepseek.com/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = (await res.json()) as { data?: { id: string }[] }
			const models = (body.data ?? []).map((m) => m.id).slice(0, 10)
			return { ok: true, latencyMs, message: "Connected", models }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err: unknown) {
		const latencyMs = Date.now() - start
		return { ok: false, latencyMs, message: (err as Error).message }
	}
}

async function testKimi(apiKey: string): Promise<ProviderTestResult> {
	const start = Date.now()
	try {
		const res = await fetch("https://api.moonshot.cn/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			return { ok: true, latencyMs, message: "Connected" }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err: unknown) {
		const latencyMs = Date.now() - start
		return { ok: false, latencyMs, message: (err as Error).message }
	}
}

async function testOpenRouter(apiKey: string): Promise<ProviderTestResult> {
	const start = Date.now()
	try {
		const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = (await res.json()) as { data?: { label?: string } }
			return { ok: true, latencyMs, message: body.data?.label ?? "Connected" }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err: unknown) {
		const latencyMs = Date.now() - start
		return { ok: false, latencyMs, message: (err as Error).message }
	}
}

async function testGroq(apiKey: string): Promise<ProviderTestResult> {
	const start = Date.now()
	try {
		const res = await fetch("https://api.groq.com/openai/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000),
		})
		const latencyMs = Date.now() - start
		if (res.ok) {
			const body = (await res.json()) as { data?: { id: string }[] }
			const models = (body.data ?? []).map((m) => m.id).slice(0, 10)
			return { ok: true, latencyMs, message: "Connected", models }
		}
		return { ok: false, latencyMs, message: `HTTP ${res.status}` }
	} catch (err: unknown) {
		const latencyMs = Date.now() - start
		return { ok: false, latencyMs, message: (err as Error).message }
	}
}
