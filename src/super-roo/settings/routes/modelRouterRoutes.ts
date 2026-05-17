/**
 * AI Model Router — Express API routes.
 *
 * These routes expose the model router service to the frontend dashboard.
 * They follow the same pattern as the existing routingRoutes.ts.
 */

import { Router, type Request, type Response } from "express"
import {
	deleteRoute,
	getFallbackRules,
	getSafetyRules,
	getUsageSummary,
	listProviders,
	listRoutes,
	setFallbackRules,
	setSafetyRules,
	testRoute,
	updateRoute,
	upsertRoute,
} from "../services/modelRouterService"

export function createModelRouterRouter(): Router {
	const router = Router()

	/**
	 * GET /providers — Get all provider metadata with status.
	 */
	router.get("/providers", async (_req: Request, res: Response, next) => {
		try {
			res.json({ providers: await listProviders() })
		} catch (error) {
			next(error)
		}
	})

	/**
	 * GET /routes — Get all task-to-model routes.
	 */
	router.get("/routes", async (_req: Request, res: Response, next) => {
		try {
			res.json({ routes: await listRoutes() })
		} catch (error) {
			next(error)
		}
	})

	/**
	 * POST /routes — Create or update a route.
	 */
	router.post("/routes", async (req: Request, res: Response, next) => {
		try {
			res.json({ route: await upsertRoute(req.body) })
		} catch (error) {
			next(error)
		}
	})

	/**
	 * PATCH /routes/:id — Update a specific route.
	 */
	router.patch("/routes/:id", async (req: Request<{ id: string }>, res: Response, next) => {
		try {
			res.json({ route: await updateRoute(req.params.id, req.body) })
		} catch (error) {
			next(error)
		}
	})

	/**
	 * DELETE /routes/:id — Delete a route.
	 */
	router.delete("/routes/:id", async (req: Request<{ id: string }>, res: Response, next) => {
		try {
			res.json(await deleteRoute(req.params.id))
		} catch (error) {
			next(error)
		}
	})

	/**
	 * POST /test-route — Test a route by task type.
	 */
	router.post("/test-route", async (req: Request, res: Response, next) => {
		try {
			res.json(await testRoute(req.body.taskType))
		} catch (error) {
			next(error)
		}
	})

	/**
	 * POST /sync-api-keys — Sync provider status from API Keys vault.
	 */
	router.post("/sync-api-keys", async (_req: Request, res: Response, next) => {
		try {
			res.json({
				ok: true,
				providers: await listProviders(),
				syncedAt: new Date().toISOString(),
			})
		} catch (error) {
			next(error)
		}
	})

	/**
	 * GET /usage — Get usage summary for all models.
	 */
	router.get("/usage", async (_req: Request, res: Response, next) => {
		try {
			res.json({ usage: await getUsageSummary() })
		} catch (error) {
			next(error)
		}
	})

	/**
	 * GET /fallback-rules — Get current fallback rules.
	 */
	router.get("/fallback-rules", (_req: Request, res: Response) => {
		res.json({ fallbackRules: getFallbackRules() })
	})

	/**
	 * PATCH /fallback-rules — Update fallback rules.
	 */
	router.patch("/fallback-rules", (req: Request, res: Response) => {
		res.json({ fallbackRules: setFallbackRules(req.body) })
	})

	/**
	 * GET /safety-rules — Get current safety rules.
	 */
	router.get("/safety-rules", (_req: Request, res: Response) => {
		res.json({ safetyRules: getSafetyRules() })
	})

	/**
	 * PATCH /safety-rules — Update safety rules.
	 */
	router.patch("/safety-rules", (req: Request, res: Response) => {
		res.json({ safetyRules: setSafetyRules(req.body) })
	})

	return router
}
