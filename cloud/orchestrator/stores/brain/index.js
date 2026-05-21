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
 *   wrapper: AgentRunWrapper
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

	return {
		embedding,
		memory,
		scoring,
		approval,
		eventBus,
		contextInjector,
		wrapper,
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
	const schemaPath = path.join(__dirname, "schema.sql")
	const schema = fs.readFileSync(schemaPath, "utf-8")
	await pool.query(schema)
}

module.exports = {
	EmbeddingService,
	MemoryService,
	AgentRunWrapper,
	BrainContextInjector,
	MemoryApprovalService,
	AgentScoringService,
	BrainEventBus,
	createServices,
	applySchema,
}
