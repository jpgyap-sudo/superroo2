"use client"

import { useState, useEffect, useCallback, useRef } from "react"

/**
 * Generic fetch hook with loading/error states and auto-refresh.
 *
 * Eliminates the repeated `useEffect` + `fetch` + `setState` pattern
 * found in every dashboard view.
 *
 * @example
 * ```tsx
 * const { data, loading, error, refresh } = useApiFetch<Agent[]>("/api/agents")
 * if (loading) return <LoadingState />
 * if (error) return <ErrorState message={error} onRetry={refresh} />
 * return <DataTable columns={...} data={data ?? []} />
 * ```
 */
export function useApiFetch<T>(
	url: string,
	options?: {
		interval?: number // auto-refresh interval in ms
		transform?: (raw: unknown) => T
	},
) {
	const [data, setData] = useState<T | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

	const fetchData = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)
			const res = await fetch(url)
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`)
			}
			const json = await res.json()
			const result = options?.transform ? options.transform(json) : (json as T)
			setData(result)
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Unknown error")
		} finally {
			setLoading(false)
		}
	}, [url, options?.transform])

	useEffect(() => {
		fetchData()

		if (options?.interval && options.interval > 0) {
			intervalRef.current = setInterval(fetchData, options.interval)
		}

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current)
				intervalRef.current = null
			}
		}
	}, [fetchData, options?.interval])

	return { data, loading, error, refresh: fetchData }
}
