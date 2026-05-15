import { describe, test, expect } from "vitest"
import { formatTime, formatDuration, formatCompact, formatBytes } from "@/lib/utils"

describe("formatTime", () => {
	test("returns em-dash for null/undefined", () => {
		expect(formatTime(null)).toBe("—")
		expect(formatTime(undefined)).toBe("—")
	})

	test("returns 'just now' for recent timestamps", () => {
		const now = Date.now()
		expect(formatTime(now)).toBe("just now")
		expect(formatTime(now - 30_000)).toBe("just now")
	})

	test("returns minutes ago", () => {
		const past = Date.now() - 120_000
		expect(formatTime(past)).toBe("2m ago")
	})

	test("returns hours ago", () => {
		const past = Date.now() - 7_200_000
		expect(formatTime(past)).toBe("2h ago")
	})
})

describe("formatDuration", () => {
	test("returns em-dash for null start", () => {
		expect(formatDuration(null, null)).toBe("—")
	})

	test("returns seconds for short durations", () => {
		const start = new Date(Date.now() - 5_500).toISOString()
		const result = formatDuration(start, new Date().toISOString())
		expect(result).toMatch(/^\d+\.\d+s$/)
	})

	test("returns minutes and seconds for longer durations", () => {
		const start = new Date(Date.now() - 125_000).toISOString()
		const end = new Date().toISOString()
		expect(formatDuration(start, end)).toBe("2m 5s")
	})
})

describe("formatCompact", () => {
	test("returns plain number for small values", () => {
		expect(formatCompact(42)).toBe("42")
		expect(formatCompact(999)).toBe("999")
	})

	test("formats thousands", () => {
		expect(formatCompact(1_200)).toBe("1.2k")
		expect(formatCompact(3_456_789)).toBe("3.5M")
	})
})

describe("formatBytes", () => {
	test("returns 0 B for zero", () => {
		expect(formatBytes(0)).toBe("0 B")
	})

	test("formats bytes correctly", () => {
		expect(formatBytes(1024)).toBe("1.0 KB")
		expect(formatBytes(1_048_576)).toBe("1.0 MB")
		expect(formatBytes(1_073_741_824)).toBe("1.0 GB")
	})
})
