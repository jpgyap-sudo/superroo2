/**
 * ML Engine API Routes
 *
 * Consolidated endpoints for the ML Engine integration with the agent system.
 * Provides dashboard visibility into ML model status, training progress,
 * observations, and sync status.
 *
 * Endpoints:
 *   GET  /api/ml/status          — Aggregated ML status (sync + loop + observations)
 *   GET  /api/ml/observations    — Recent observations with filtering
 *   GET  /api/ml/models          — All uploaded models
 *   GET  /api/ml/sync-log        — Sync history
 *   POST /api/ml/trigger-train   — Manually trigger improvement loop training
 */

const fs = require("fs")
const path = require("path")

const DATA_DIR = path.join(__dirname, "..", "..", "data")

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

function parseQuery(url) {
	const idx = url.indexOf("?")
	if (idx === -1) return {}
	const params = new URLSearchParams(url.slice(idx))
	const obj = {}
	for (const [k, v] of params) obj[k] = v
	return obj
}

function safeRequire(modulePath) {
	try {
		return require(modulePath)
	} catch {
		return null
	}
}

// ── Route Handler ────────────────────────────────────────────────────────────

async function handleMlRoute(method, url, req, res) {
	const query = parseQuery(url)
	const normalizedUrl = url.split("?")[0]

	// GET /api/ml/status — Aggregated ML status
	if (method === "GET" && normalizedUrl === "/api/ml/status") {
		try {
			const orchestrator = global.__orchestrator || null
			const status = {
				improvementLoop: null,
				syncStatus: null,
				observations: null,
				models: null,
				orchestratorReady: !!orchestrator,
			}

			// 1. Improvement loop stats
			if (orchestrator && orchestrator.improvementLoop) {
				const loopStats = orchestrator.improvementLoop.stats || {}
				status.improvementLoop = {
					iteration: loopStats.iteration || 0,
					totalSamples: loopStats.totalSamples || 0,
					lastTrainLoss: loopStats.lastTrainLoss || 0,
					predictionsMade: loopStats.predictionsMade || 0,
					actionsTaken: loopStats.actionsTaken || 0,
					actionHelpRate: loopStats.actionHelpRate || 0,
					lastMetrics: loopStats.lastMetrics || {},
					running: orchestrator.improvementLoop.running || false,
				}
				// Sync status from MLSyncClient
				if (typeof orchestrator.improvementLoop.getSyncStatus === "function") {
					status.syncStatus = orchestrator.improvementLoop.getSyncStatus()
				}
			}

			// 2. Observation counts from DB
			if (orchestrator && orchestrator.memory) {
				try {
					const db = orchestrator.memory.getDb()
					const totalObs = db.prepare("SELECT COUNT(*) as count FROM ml_observations_v2").get()
					const byType = db
						.prepare(
							"SELECT task_type, COUNT(*) as count FROM ml_observations_v2 GROUP BY task_type ORDER BY count DESC",
						)
						.all()
					const totalModels = db.prepare("SELECT COUNT(*) as count FROM ml_models").get()
					const mergedModels = db.prepare("SELECT COUNT(*) as count FROM ml_models WHERE is_merged = 1").get()
					const latestModel = db
						.prepare("SELECT * FROM ml_models ORDER BY training_samples DESC, created_at DESC LIMIT 1")
						.get()
					const totalSyncs = db.prepare("SELECT COUNT(*) as count FROM ml_sync_log").get()
					const failedSyncs = db
						.prepare("SELECT COUNT(*) as count FROM ml_sync_log WHERE status = 'failed'")
						.get()

					status.observations = {
						total: totalObs ? totalObs.count : 0,
						byType: byType || [],
					}
					status.models = {
						total: totalModels ? totalModels.count : 0,
						merged: mergedModels ? mergedModels.count : 0,
						latest: latestModel
							? {
									id: latestModel.id,
									modelType: latestModel.model_type,
									source: latestModel.source,
									trainingSamples: latestModel.training_samples,
									featureDimensions: latestModel.feature_dimensions,
									isMerged: !!latestModel.is_merged,
									createdAt: latestModel.created_at,
								}
							: null,
					}
					status.syncStats = {
						total: totalSyncs ? totalSyncs.count : 0,
						failed: failedSyncs ? failedSyncs.count : 0,
					}
				} catch (dbErr) {
					// DB may not have ML tables yet
					status.dbError = dbErr.message
				}
			}

			sendJson(res, 200, { success: true, status })
		} catch (err) {
			sendJson(res, 500, { success: false, error: err.message })
		}
		return
	}

	// GET /api/ml/observations — Recent observations
	if (method === "GET" && normalizedUrl === "/api/ml/observations") {
		try {
			const orchestrator = global.__orchestrator || null
			if (!orchestrator || !orchestrator.memory) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const limit = Math.min(parseInt(query.limit) || 50, 500)
			const taskType = query.type || null
			const db = orchestrator.memory.getDb()

			let rows
			if (taskType) {
				rows = db
					.prepare("SELECT * FROM ml_observations_v2 WHERE task_type = ? ORDER BY created_at DESC LIMIT ?")
					.all(taskType, limit)
			} else {
				rows = db.prepare("SELECT * FROM ml_observations_v2 ORDER BY created_at DESC LIMIT ?").all(limit)
			}

			const observations = rows.map((r) => ({
				id: r.id,
				taskType: r.task_type,
				inputSummary: r.input_summary,
				outputSummary: r.output_summary,
				success: !!r.success,
				durationMs: r.duration_ms,
				source: r.source,
				sessionId: r.session_id,
				createdAt: r.created_at,
			}))

			sendJson(res, 200, { success: true, observations, total: observations.length })
		} catch (err) {
			sendJson(res, 500, { success: false, error: err.message })
		}
		return
	}

	// GET /api/ml/models — All uploaded models
	if (method === "GET" && normalizedUrl === "/api/ml/models") {
		try {
			const orchestrator = global.__orchestrator || null
			if (!orchestrator || !orchestrator.memory) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const limit = Math.min(parseInt(query.limit) || 20, 100)
			const db = orchestrator.memory.getDb()
			const rows = db.prepare("SELECT * FROM ml_models ORDER BY created_at DESC LIMIT ?").all(limit)

			const models = rows.map((r) => ({
				id: r.id,
				modelType: r.model_type,
				source: r.source,
				schemaVersion: r.schema_version,
				featureDimensions: r.feature_dimensions,
				trainingSamples: r.training_samples,
				isMerged: !!r.is_merged,
				mergedFrom: r.merged_from ? JSON.parse(r.merged_from) : null,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			}))

			sendJson(res, 200, { success: true, models, total: models.length })
		} catch (err) {
			sendJson(res, 500, { success: false, error: err.message })
		}
		return
	}

	// GET /api/ml/sync-log — Sync history
	if (method === "GET" && normalizedUrl === "/api/ml/sync-log") {
		try {
			const orchestrator = global.__orchestrator || null
			if (!orchestrator || !orchestrator.memory) {
				sendJson(res, 503, { success: false, error: "Orchestrator not initialized" })
				return
			}
			const limit = Math.min(parseInt(query.limit) || 20, 100)
			const db = orchestrator.memory.getDb()
			const rows = db.prepare("SELECT * FROM ml_sync_log ORDER BY created_at DESC LIMIT ?").all(limit)

			const logs = rows.map((r) => ({
				id: r.id,
				direction: r.direction,
				status: r.status,
				modelId: r.model_id,
				modelType: r.model_type,
				featureDimensions: r.feature_dimensions,
				trainingSamples: r.training_samples,
				source: r.source,
				target: r.target,
				payloadSizeBytes: r.payload_size_bytes,
				createdAt: r.created_at,
			}))

			sendJson(res, 200, { success: true, logs, total: logs.length })
		} catch (err) {
			sendJson(res, 500, { success: false, error: err.message })
		}
		return
	}

	// POST /api/ml/trigger-train — Manually trigger improvement loop training
	if (method === "POST" && normalizedUrl === "/api/ml/trigger-train") {
		try {
			const orchestrator = global.__orchestrator || null
			if (!orchestrator || !orchestrator.improvementLoop) {
				sendJson(res, 503, { success: false, error: "ImprovementLoop not initialized" })
				return
			}
			if (typeof orchestrator.improvementLoop.triggerCycle === "function") {
				orchestrator.improvementLoop.triggerCycle()
				sendJson(res, 200, { success: true, message: "Training cycle triggered" })
			} else {
				sendJson(res, 200, {
					success: true,
					message: "Trigger not available (loop may not support manual trigger)",
				})
			}
		} catch (err) {
			sendJson(res, 500, { success: false, error: err.message })
		}
		return
	}

	// 404 for unmatched ML routes
	sendJson(res, 404, { success: false, error: "ML route not found" })
}

module.exports = { handleMlRoute }
