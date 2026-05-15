import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function formatDate(ts: string | number | Date) {
	const d = new Date(ts)
	return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

/**
 * Format a timestamp to a human-readable relative or absolute time string.
 * Used across multiple dashboard views (jobs, auto-deploy, etc.).
 */
export function formatTime(ts: string | number | null | undefined): string {
	if (!ts) return "—"
	const d = new Date(ts)
	const now = Date.now()
	const diff = now - d.getTime()

	if (diff < 60_000) return "just now"
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/**
 * Format a duration between two ISO timestamps.
 */
export function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
	if (!start) return "—"
	const s = new Date(start).getTime()
	const e = end ? new Date(end).getTime() : Date.now()
	const ms = e - s
	if (ms < 1_000) return `${ms}ms`
	if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
	const m = Math.floor(ms / 60_000)
	const sec = Math.floor((ms % 60_000) / 1_000)
	return `${m}m ${sec}s`
}

/**
 * Format a number with compact notation (e.g., 1.2k, 3.4M).
 */
export function formatCompact(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
	return String(n)
}

/**
 * Format bytes to a human-readable string.
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const units = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(1024))
	return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i]
}
