/**
 * Super Roo — mock data.
 *
 * Used when the dashboard renders without a live extension host (e.g. `vite
 * dev`, Storybook, screenshot tests). The real extension supplies the same
 * shapes via the messaging client.
 */

import type { SrBug, SrDashboardSnapshot, SrEvent, SrFeature, SrTask } from "../types"

const HOUR = 60 * 60 * 1000

export function mockSnapshot(): SrDashboardSnapshot {
	const now = Date.now()
	return {
		mode: "AUTO",
		selfImprove: false,
		running: true,
		queue: { pending: 3, running: 1, succeeded24h: 14, failed24h: 2, blocked24h: 1 },
		agents: [
			{ name: "product-manager", description: "Plans features", ready: true },
			{ name: "coder", description: "Writes code via Roo", ready: true },
			{ name: "tester", description: "Runs npm test", ready: true },
			{ name: "debugger", description: "Diagnoses bugs", ready: true },
		],
		recentTasks: [
			{
				id: "task_a",
				agent: "coder",
				goal: "Fix login redirect",
				priority: "high",
				status: "running",
				createdAt: now - 2 * 60_000,
				updatedAt: now - 30_000,
				startedAt: now - 90_000,
				attempts: 1,
				bugId: "bug_a",
			},
			{
				id: "task_b",
				agent: "tester",
				goal: "Run unit tests after auth fix",
				priority: "normal",
				status: "succeeded",
				createdAt: now - 6 * 60_000,
				updatedAt: now - 5 * 60_000,
				startedAt: now - 5 * 60_000,
				finishedAt: now - 5 * 60_000,
				attempts: 1,
				resultSummary: "unit tests PASSED in 4321ms",
			},
			{
				id: "task_c",
				agent: "product-manager",
				goal: "Plan password reset flow",
				priority: "normal",
				status: "succeeded",
				createdAt: now - 30 * 60_000,
				updatedAt: now - 28 * 60_000,
				attempts: 1,
				featureId: "feat_a",
			},
		],
		recentEvents: mockEvents(),
	}
}

export function mockFeatures(): SrFeature[] {
	const now = Date.now()
	return [
		{
			id: "feat_a",
			name: "Password Reset",
			description: "Email-based reset flow",
			ownerAgent: "product-manager",
			status: "building",
			health: "unknown",
			priority: "high",
			relatedFiles: ["src/auth/reset.ts", "src/email/templates.ts"],
			bugIds: [],
			testIds: [],
			fixAttempts: 0,
			lastCheckedAt: null,
			createdAt: now - 30 * 60_000,
			updatedAt: now - 28 * 60_000,
		},
		{
			id: "feat_b",
			name: "Login",
			description: "Email + password authentication",
			ownerAgent: "product-manager",
			status: "broken",
			health: "failing",
			priority: "critical",
			relatedFiles: ["src/auth/login.ts"],
			bugIds: ["bug_a"],
			testIds: [],
			fixAttempts: 1,
			lastCheckedAt: now - HOUR,
			createdAt: now - 4 * HOUR,
			updatedAt: now - 30 * 60_000,
		},
		{
			id: "feat_c",
			name: "User Profile",
			description: "View + edit profile",
			ownerAgent: "product-manager",
			status: "working",
			health: "healthy",
			priority: "normal",
			relatedFiles: ["src/profile/index.tsx"],
			bugIds: [],
			testIds: [],
			fixAttempts: 0,
			lastCheckedAt: now - 2 * HOUR,
			createdAt: now - 5 * 24 * HOUR,
			updatedAt: now - HOUR,
		},
	]
}

export function mockBugs(): SrBug[] {
	const now = Date.now()
	return [
		{
			id: "bug_a",
			title: "TypeError: cannot read property 'token' of undefined",
			severity: "high",
			status: "investigating",
			featureId: "feat_b",
			symptoms: ["TypeError: cannot read property 'token' of undefined", "at src/auth/login.ts:42"],
			suspectedRootCause: "Session token reads before it's set during the redirect flow",
			filesLikelyInvolved: ["src/auth/login.ts", "src/auth/session.ts"],
			reproductionSteps: ["Open /login", "Submit valid credentials", "Observe console error"],
			recommendedFix: "Await session.init() before reading token",
			deploymentRisk: "medium",
			createdAt: now - 60_000,
			updatedAt: now - 30_000,
			fixAttempts: 1,
		},
	]
}

export function mockEvents(): SrEvent[] {
	const now = Date.now()
	return [
		{ id: "e1", at: now - 5_000, level: "info", type: "task.dequeued", message: "Dequeued: Fix login redirect", taskId: "task_a", agent: "coder" },
		{ id: "e2", at: now - 30_000, level: "info", type: "agent.invoked", message: "Coder Agent starting: Fix login redirect", taskId: "task_a", agent: "coder" },
		{ id: "e3", at: now - 60_000, level: "warn", type: "bug.recorded", message: "Bug recorded: TypeError: cannot read property 'token' of undefined", bugId: "bug_a", featureId: "feat_b" },
		{ id: "e4", at: now - 5 * 60_000, level: "info", type: "task.succeeded", message: "Task succeeded: Run unit tests after auth fix", taskId: "task_b", agent: "tester" },
		{ id: "e5", at: now - 28 * 60_000, level: "info", type: "agent.completed", message: "PM Agent: plan complete for Password Reset; queued Coder follow-up.", taskId: "task_c", agent: "product-manager", featureId: "feat_a" },
		{ id: "e6", at: now - 30 * 60_000, level: "info", type: "feature.created", message: "PM created feature: Password Reset", featureId: "feat_a" },
	]
}

export function mockTasks(): SrTask[] {
	return mockSnapshot().recentTasks
}
