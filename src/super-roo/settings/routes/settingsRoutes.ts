/**
 * Settings API routes.
 *
 * These routes manage the SuperRoo settings profile, approval rules,
 * MCP servers, guardrails, and other VPS-level configuration.
 */

import { Router, Request, Response } from "express"
import { evaluateApproval, getDangerousPatterns } from "../services/approvalEngine"
import type { ApprovalEvaluationRequest, ApprovalEvaluationResult, SuperRooSettings } from "../types"

export function createSettingsRouter(): Router {
	const router = Router()

	// In-memory settings store (will be replaced with DB persistence)
	let currentSettings: SuperRooSettings = {
		activeProfile: "default",
		approval: {
			enabled: true,
			rules: [],
			maxApprovalCount: 10,
			maxCostUsd: 5.0,
			timeWindowMinutes: 60,
		},
		mcp: {
			servers: [],
		},
		routing: {
			routes: [],
		},
		guardrails: {
			maxConcurrentJobs: 3,
			cpuHighPercent: 80,
			ramHighPercent: 85,
			onHighCpu: "throttle",
			onHighRam: "throttle",
		},
	}

	/**
	 * GET / — Get current settings.
	 */
	router.get("/", (_req: Request, res: Response) => {
		res.json(currentSettings)
	})

	/**
	 * PUT / — Replace all settings.
	 */
	router.put("/", (req: Request, res: Response) => {
		const updates = req.body as Partial<SuperRooSettings>
		currentSettings = { ...currentSettings, ...updates }
		res.json({ ok: true, settings: currentSettings })
	})

	/**
	 * POST /approval/evaluate — Evaluate an action against approval rules.
	 */
	router.post("/approval/evaluate", (req: Request, res: Response) => {
		const input = req.body as ApprovalEvaluationRequest

		if (!input.action) {
			res.status(400).json({ error: "action is required" })
			return
		}

		const result: ApprovalEvaluationResult = evaluateApproval({
			action: input.action,
			command: input.command,
			rules: input.rules,
		})

		res.json(result)
	})

	/**
	 * GET /approval/dangerous-patterns — Get the list of built-in dangerous patterns.
	 */
	router.get("/approval/dangerous-patterns", (_req: Request, res: Response) => {
		res.json({ patterns: getDangerousPatterns() })
	})

	return router
}
