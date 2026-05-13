/**
 * Super Roo — Shared utility: safely parse JSON with a fallback value.
 *
 * Used across BugRegistry, TaskQueue, FeatureRegistry, and other modules
 * that store JSON-serialised arrays/objects in SQLite text columns.
 *
 * Never throws. Returns `fallback` on parse failure.
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json) as T
	} catch {
		return fallback
	}
}
