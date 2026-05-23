/**
 * Central Brain v2 — Service Registry
 *
 * Single entry point for all brain services.
 * Provides factory functions and a convenience BrainServices container.
 *
 * Usage:
 *   const brain = require('./stores/brain');
 *   const services = await brain.createServices(pool, redisClient);
 *   await services.memory.searchMemory({ projectId: 'default', query: '...' });
 */

const { EmbeddingService } = require("./EmbeddingService")
const { MemoryService } = require("./MemoryService")
const { AgentRunWrapper } = require("./AgentRunWrapper")
const { BrainContextInjector } = require("./BrainContextInjector")
const { MemoryApprovalService } = require("./MemoryApprovalService")
const { AgentScoringService } = require("./AgentScoringService")
const { BrainEventBus } = require("./BrainEventBus")
const { ConsensusService } = require("./ConsensusService")
const { ModelRouter } = require("./ModelRouter")
const { PredictiveFailureEngine } = require("./PredictiveFailureEngine")
const { SwarmDebugger } = require("./SwarmDebugger")
const { DeployGate } = require("./DeployGate")

/**
 * Create all brain services with a shared Postgres pool and optional Redis client.
 *
 * @param {import('pg').Pool} pool - Postgres connection pool
 * @param {object} [redisClient] - Optional ioredis client
 * @param {object} [options] - Configuration overrides
 * @returns {Promise<{
 *   embedding: EmbeddingService,
 *   memory: MemoryService,
 *   scoring: AgentScoringService,
 *   approval: MemoryApprovalService,
 *   eventBus: BrainEventBus,
 *   contextInjector: BrainContextInjector,
 *   wrapper: AgentRunWrapper,
 *   consensus: ConsensusService,
 *   modelRouter: ModelRouter,
 *   riskEngine: PredictiveFailureEngine,
 *   swarmDebugger: SwarmDebugger,
 *   deployGate: DeployGate
 * }>}
 */
async function createServices(pool, redisClient = null, options = {}) {
	// 1. Embedding service (Ollama default, OpenAI fallback)
	const embedding = new EmbeddingService(options.embedding || {})

	// 2. Memory service (pgvector CRUD)
	const memory = new MemoryService(pool, embedding, options.memory || {})

	// 3. Agent scoring
	const scoring = new AgentScoringService(memory, options.scoring || {})

	// 4. Memory approval (secret redaction + approval queue)
	const approval = new MemoryApprovalService(options.approval || {})

	// 5. Brain event bus (Redis Pub/Sub + Postgres)
	const eventBus = new BrainEventBus(memory, redisClient, options.eventBus || {})

	// 6. Brain context injector (prompt enhancement)
	const contextInjector = new BrainContextInjector(memory, options.context || {})

	// 7. Agent run wrapper (mandatory enforcement)
	const wrapper = new AgentRunWrapper(memory, embedding, scoring, eventBus, approval, options.wrapper || {})

	// 8. Consensus service (multi-agent weighted voting) — v4
	const consensus = new ConsensusService(pool, options.consensus || {})

	// 9. Model router (performance-tracking model selection) — v4
	const modelRouter = new ModelRouter(pool, options.modelRouter || {})

	// 10. Predictive failure engine (risk scoring) — v5
	const riskEngine = new PredictiveFailureEngine(pool, options.riskEngine || {})

	// 11. Swarm debugger (parallel multi-agent debug) — v5
	const swarmDebugger = new SwarmDebugger(pool, {
		memoryService: memory,
		...(options.swarmDebugger || {}),
	})

	// 12. Deploy gate (3-stage: risk → swarm → consensus) — v5
	const deployGate = new DeployGate({ riskEngine, swarmDebugger, consensus }, options.deployGate || {})

	// 13. Wire v4 services into the wrapper
	wrapper.setModelRouter(modelRouter)
	wrapper.setConsensus(consensus)

	return {
		embedding,
		memory,
		scoring,
		approval,
		eventBus,
		contextInjector,
		wrapper,
		consensus,
		modelRouter,
		riskEngine,
		swarmDebugger,
		deployGate,
	}
}

/**
 * Apply the pgvector schema to the database.
 * Safe to call multiple times (uses IF NOT EXISTS).
 *
 * @param {import('pg').Pool} pool
 */
async function applySchema(pool) {
	const fs = require("fs")
	const path = require("path")

	// 1. Base schema (v3/v4)
	const schemaPath = path.join(__dirname, "schema.sql")
	const schema = fs.readFileSync(schemaPath, "utf-8")
	await pool.query(schema)

	// 2. Run idempotent migrations in order (v5 predictive swarm, etc.)
	const migrationsDir = path.join(__dirname, "migrations")
	if (fs.existsSync(migrationsDir)) {
		const files = fs
			.readdirSync(migrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()
		for (const file of files) {
			const migration = fs.readFileSync(path.join(migrationsDir, file), "utf-8")
			await pool.query(migration)
		}
	}
}

module.exports = {
	EmbeddingService,
	MemoryService,
	AgentRunWrapper,
	BrainContextInjector,
	MemoryApprovalService,
	AgentScoringService,
	BrainEventBus,
	ConsensusService,
	ModelRouter,
	PredictiveFailureEngine,
	SwarmDebugger,
	DeployGate,
	createServices,
	applySchema,
}
