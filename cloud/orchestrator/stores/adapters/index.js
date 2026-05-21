/**
 * VectorStoreAdapter — Factory and registry for pluggable vector database backends.
 *
 * Usage:
 *   const { createAdapter } = require("./stores/adapters")
 *   const adapter = createAdapter({ type: "pgvector", embeddingService })
 *   await adapter.init()
 *   await adapter.storeLesson({...})
 *   await adapter.searchLessons("query")
 *   await adapter.close()
 *
 * Adapter type is selected via VECTOR_STORE_TYPE env var (default: "pgvector").
 *
 * Supported types:
 *   - "pgvector"  — PostgreSQL + pgvector (production default)
 *   - "memory"    — In-memory (testing/dev, no persistence)
 *   - "qdrant"    — Qdrant vector database
 *   - "pinecone"  — Pinecone managed vector database
 *   - "chroma"    — Chroma open-source embedding database
 */

const { VectorStoreAdapter } = require("./VectorStoreAdapter")
const { PgVectorAdapter } = require("./PgVectorAdapter")
const { MemoryVectorAdapter } = require("./MemoryVectorAdapter")
const { QdrantAdapter } = require("./QdrantAdapter")
const { PineconeAdapter } = require("./PineconeAdapter")
const { ChromaAdapter } = require("./ChromaAdapter")

// Registry of available adapter constructors
const ADAPTER_REGISTRY = {
	pgvector: PgVectorAdapter,
	memory: MemoryVectorAdapter,
	qdrant: QdrantAdapter,
	pinecone: PineconeAdapter,
	chroma: ChromaAdapter,
}

/**
 * Get the configured adapter type from environment.
 * @returns {string}
 */
function getConfiguredAdapterType() {
	return (process.env.VECTOR_STORE_TYPE || "pgvector").toLowerCase()
}

/**
 * Create a vector store adapter instance.
 *
 * @param {object} [options]
 * @param {string} [options.type] - Adapter type (default: VECTOR_STORE_TYPE env or "pgvector")
 * @param {import('../EmbeddingService').EmbeddingService} [options.embeddingService] - Shared embedding service
 * @param {object} [options.config] - Backend-specific configuration overrides
 * @returns {VectorStoreAdapter}
 */
function createAdapter(options = {}) {
	const type = (options.type || getConfiguredAdapterType()).toLowerCase()
	const Constructor = ADAPTER_REGISTRY[type]

	if (!Constructor) {
		const available = Object.keys(ADAPTER_REGISTRY).join(", ")
		throw new Error(
			`Unknown vector store adapter type: "${type}". Available types: ${available}. ` +
				`Set VECTOR_STORE_TYPE env var or pass { type } option.`,
		)
	}

	const adapter = new Constructor({
		embeddingService: options.embeddingService || null,
		config: options.config || {},
		...options.config, // Pass through backend-specific config
	})

	console.log(`[VectorStoreAdapter] Created adapter: ${type} (${adapter._adapterName})`)
	return adapter
}

/**
 * List all available adapter types.
 * @returns {string[]}
 */
function listAdapterTypes() {
	return Object.keys(ADAPTER_REGISTRY)
}

/**
 * Register a custom adapter type.
 * @param {string} name
 * @param {typeof VectorStoreAdapter} constructor
 */
function registerAdapter(name, constructor) {
	if (!(constructor.prototype instanceof VectorStoreAdapter)) {
		throw new Error("Custom adapter must extend VectorStoreAdapter")
	}
	ADAPTER_REGISTRY[name.toLowerCase()] = constructor
}

module.exports = {
	VectorStoreAdapter,
	createAdapter,
	listAdapterTypes,
	registerAdapter,
	getConfiguredAdapterType,
	ADAPTER_REGISTRY,
}
