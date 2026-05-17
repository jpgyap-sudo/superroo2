/**
 * Tests for the DashboardTab component.
 *
 * The DashboardTab reads from SrContext. We wrap it in a custom provider
 * that injects controlled mock data so we can assert on the rendered output.
 */

import React from "react"
import { render, screen } from "@/utils/test-utils"
import { describe, it, expect, vi } from "vitest"

import { DashboardTab } from "../DashboardTab"
import type { SrDashboardSnapshot } from "../../types"

// ── Mock SrContext ──────────────────────────────────────────────────────────

const mockUseSr = vi.fn()

vi.mock("../../hooks/SrContext", () => ({
	useSr: () => mockUseSr(),
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<SrDashboardSnapshot> = {}): SrDashboardSnapshot {
	return {
		mode: "AUTO",
		selfImprove: false,
		running: true,
		queue: { pending: 2, running: 1, succeeded24h: 10, failed24h: 1, blocked24h: 0 },
		agents: [
			{ name: "coder", description: "Writes code", ready: true },
			{ name: "tester", description: "Runs tests", ready: false },
		],
		recentTasks: [
			{
				id: "t1",
				agent: "coder",
				goal: "Fix login bug",
				priority: "high",
				status: "running",
				createdAt: Date.now() - 60_000,
				updatedAt: Date.now() - 10_000,
				startedAt: Date.now() - 50_000,
				attempts: 1,
			},
			{
				id: "t2",
				agent: "tester",
				goal: "Run unit tests",
				priority: "normal",
				status: "succeeded",
				createdAt: Date.now() - 300_000,
				updatedAt: Date.now() - 240_000,
				startedAt: Date.now() - 240_000,
				finishedAt: Date.now() - 240_000,
				attempts: 1,
				resultSummary: "all tests passed",
			},
		],
		recentEvents: [],
		...overrides,
	}
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("DashboardTab", () => {
	it("should show loading state when snapshot is null", () => {
		mockUseSr.mockReturnValue({ snapshot: null, mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("Loading dashboard…")).toBeDefined()
	})

	it("should render orchestrator status", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot({ running: true }), mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("Running")).toBeDefined()
	})

	it("should show stopped when orchestrator is not running", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot({ running: false }), mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("Stopped")).toBeDefined()
	})

	it("should display safety mode", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot({ mode: "SAFE" }), mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("SAFE")).toBeDefined()
	})

	it("should show self-improvement label when enabled", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot({ selfImprove: true }), mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("Self-improve ON")).toBeDefined()
	})

	it("should display queue stats", () => {
		mockUseSr.mockReturnValue({
			snapshot: makeSnapshot({
				queue: { pending: 3, running: 2, succeeded24h: 15, failed24h: 2, blocked24h: 1 },
			}),
			mockMode: false,
		})
		render(<DashboardTab />)
		expect(screen.getByText("2 running, 3 pending")).toBeDefined()
		expect(screen.getByText("15 ok, 2 failed")).toBeDefined()
	})

	it("should show blocked count when present", () => {
		mockUseSr.mockReturnValue({
			snapshot: makeSnapshot({
				queue: { pending: 0, running: 0, succeeded24h: 5, failed24h: 1, blocked24h: 2 },
			}),
			mockMode: false,
		})
		render(<DashboardTab />)
		expect(screen.getByText("2 blocked")).toBeDefined()
	})

	it("should render agent list with ready status", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot(), mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("coder")).toBeDefined()
		expect(screen.getByText("tester")).toBeDefined()
		expect(screen.getByText("Writes code")).toBeDefined()
		expect(screen.getByText("Runs tests")).toBeDefined()
	})

	it("should show recent tasks", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot(), mockMode: false })
		render(<DashboardTab />)
		expect(screen.getByText("Fix login bug")).toBeDefined()
		expect(screen.getByText("Run unit tests")).toBeDefined()
	})

	it("should show empty state when no tasks", () => {
		mockUseSr.mockReturnValue({
			snapshot: makeSnapshot({ recentTasks: [] }),
			mockMode: false,
		})
		render(<DashboardTab />)
		expect(screen.getByText("No tasks yet.")).toBeDefined()
	})

	it("should show mock mode banner when in mock mode", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot(), mockMode: true })
		render(<DashboardTab />)
		expect(screen.getByText(/Showing mock data/)).toBeDefined()
	})

	it("should not show mock mode banner when not in mock mode", () => {
		mockUseSr.mockReturnValue({ snapshot: makeSnapshot(), mockMode: false })
		render(<DashboardTab />)
		expect(screen.queryByText(/Showing mock data/)).toBeNull()
	})
})
