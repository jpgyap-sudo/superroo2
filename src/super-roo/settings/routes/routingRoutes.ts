/**
 * Agent routing API routes.
 *
 * These routes manage the mapping of agents to provider/model pairs,
 * with fallback support and availability validation.
 */

import { Router, Request, Response } from "express"
import { DEFAULT_AGENT_ROUTES } from "../config/agentRouting"
import { getRouteForAgent, validateRoutes } from "../services/modelRouter"
import type { AgentRouteConfig, RouteValidationResult } from "../types"
import type { AgentName } from "../services/modelRouter"

export function createRoutingRouter(): Router {
	const router = Router()

	// In-memory route store (will be replaced with DB persistence)
	let currentRoutes: AgentRouteConfig[] = [...DEFAULT_AGENT_ROUTES]

	/**
	 * GET / — Get all current agent routes.
	 */
	router.get("/", (_req: Request, res: Response) => {
		res.json({ routes: currentRoutes })
	})

	/**
	 * PUT / — Replace all agent routes.
	 */
	router.put("/", (req: Request, res: Response) => {
		const { routes } = req.body as { routes: AgentRouteConfig[] }
		if (!Array.isArray(routes)) {
			res.status(400).json({ error: "routes array is required" })
			return
		}
		currentRoutes = routes
		res.json({ ok: true, routes: currentRoutes })
	})

	/**
	 * POST /validate — Validate routes against provider availability.
	 *
	 * Body: { availability: Record<string, boolean> }
	 * Returns which agents have no available provider.
	 */
	router.post("/validate", (req: Request, res: Response) => {
		const { availability } = req.body as { availability: Record<string, boolean> }

		if (!availability || typeof availability !== "object") {
			res.status(400).json({ error: "availability map is required" })
			return
		}

		const routes = currentRoutes.map((r) => ({
			agent: r.agent as AgentName,
			primary: r.primary,
			fallbacks: r.fallbacks,
		}))

		const unreachable = validateRoutes(routes, availability)

		const result: RouteValidationResult = {
			valid: unreachable.length === 0,
			unreachableAgents: unreachable,
		}

		res.json(result)
	})

	return router
}
