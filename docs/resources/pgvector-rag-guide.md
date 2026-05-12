# PostgreSQL + pgvector + RAG Resource Guide

> Comprehensive reference for integrating vector search and Retrieval-Augmented Generation into SuperRoo applications.

## Overview

This guide provides the complete architecture, SQL schemas, code patterns, and deployment instructions for adding semantic search and RAG capabilities to SuperRoo using PostgreSQL with the pgvector extension.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Setup](#database-setup)
3. [SQL Schemas](#sql-schemas)
4. [Embedding Models](#embedding-models)
5. [Chunking Strategies](#chunking-strategies)
6. [Search Patterns](#search-patterns)
7. [RAG Pipeline](#rag-pipeline)
8. [Integration Points](#integration-points)
9. [Performance Tuning](#performance-tuning)
10. [Deployment](#deployment)
11. [Monitoring](#monitoring)

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        RAG Architecture                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────────────┐  │
│  │ Document │───▶│ Chunking │───▶│Embedding │───▶│  pgvector   │  │
│  │  Source  │    │ Pipeline │    │  Model   │    │ PostgreSQL  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────┬──────┘  │
│                                                          │         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐           │         │
│  │  User    │───▶│ Embed   │───▶│  Vector  │◀──────────┘         │
│  │  Query   │    │ Query   │    │  Search  │                      │
│  └──────────┘    └──────────┘    └────┬─────┘                     │
│                                       │                           │
│                                       ▼                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                    │
│  │  Final   │◀───│  LLM     │◀───│ Context  │                    │
│  │ Response │    │ Generate │    │ Assembly │                    │
│  └──────────┘    └──────────┘    └──────────┘                    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Database Setup

### PostgreSQL 16 + pgvector Installation

**Ubuntu/Debian (VPS):**

```bash
sudo apt update
sudo apt install -y postgresql-16 postgresql-16-pgvector
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

**Docker:**

```yaml
# docker-compose.yml
services:
    postgres:
        image: pgvector/pgvector:pg16
        environment:
            POSTGRES_DB: superroo_rag
            POSTGRES_USER: superroo
            POSTGRES_PASSWORD: ${DB_PASSWORD}
        volumes:
            - pgdata:/var/lib/postgresql/data
        ports:
            - "5432:5432"
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U superroo -d superroo_rag"]
            interval: 5s
            timeout: 5s
            retries: 5

volumes:
    pgdata:
```

**Verify Installation:**

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
-- Expected: vector | 0.7.0+
```

## SQL Schemas

### Core Tables

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Documents (general knowledge base) ──────────────────────
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Conversation Memory (chat history) ──────────────────────
CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Code Knowledge (source code index) ──────────────────────
CREATE TABLE code_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    summary TEXT,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(file_path, content)
);

-- ── Response Cache (semantic caching) ───────────────────────
CREATE TABLE response_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    embedding vector(1536),
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Hermes Lessons (orchestrator learning) ──────────────────
CREATE TABLE hermes_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    summary TEXT NOT NULL,
    details TEXT,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Indexes

```sql
-- IVFFlat indexes (fast build, good accuracy)
CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_memory_embedding ON conversation_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_code_embedding ON code_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_cache_embedding ON response_cache USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX idx_hermes_embedding ON hermes_lessons USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- B-tree indexes for filtering
CREATE INDEX idx_memory_session ON conversation_memory(session_id);
CREATE INDEX idx_code_path ON code_knowledge(file_path);
CREATE INDEX idx_documents_created ON documents(created_at DESC);
CREATE INDEX idx_cache_created ON response_cache(created_at DESC);

-- Full-text search indexes
CREATE INDEX idx_documents_fts ON documents USING GIN (to_tsvector('english', content));
CREATE INDEX idx_code_fts ON code_knowledge USING GIN (to_tsvector('english', content));
```

### Search Functions

```sql
-- ── Pure Vector Search ──────────────────────────────────────
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 5,
    filter_metadata JSONB DEFAULT NULL
)
RETURNS TABLE(
    id UUID,
    content TEXT,
    metadata JSONB,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.content,
        d.metadata,
        1 - (d.embedding <=> query_embedding) AS similarity
    FROM documents d
    WHERE
        1 - (d.embedding <=> query_embedding) > match_threshold
        AND (filter_metadata IS NULL OR d.metadata @> filter_metadata)
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ── Hybrid Search (vector + full-text) ──────────────────────
CREATE OR REPLACE FUNCTION hybrid_search(
    query_embedding vector(1536),
    query_text text,
    match_count int DEFAULT 5,
    vector_weight float DEFAULT 0.5,
    filter_metadata JSONB DEFAULT NULL
)
RETURNS TABLE(
    id UUID,
    content TEXT,
    metadata JSONB,
    score float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.content,
        d.metadata,
        (vector_weight * (1 - (d.embedding <=> query_embedding)) +
         (1 - vector_weight) * COALESCE(
             ts_rank(to_tsvector('english', d.content), plainto_tsquery('english', query_text)),
             0
         )) AS score
    FROM documents d
    WHERE
        (1 - (d.embedding <=> query_embedding)) > 0.5
        OR to_tsvector('english', d.content) @@ plainto_tsquery('english', query_text)
        AND (filter_metadata IS NULL OR d.metadata @> filter_metadata)
    ORDER BY score DESC
    LIMIT match_count;
END;
$$;

-- ── Conversation Memory Search ──────────────────────────────
CREATE OR REPLACE FUNCTION match_conversation_memory(
    query_embedding vector(1536),
    session_id TEXT DEFAULT NULL,
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 5
)
RETURNS TABLE(
    id UUID,
    role TEXT,
    content TEXT,
    similarity float,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cm.id,
        cm.role,
        cm.content,
        1 - (cm.embedding <=> query_embedding) AS similarity,
        cm.created_at
    FROM conversation_memory cm
    WHERE
        1 - (cm.embedding <=> query_embedding) > match_threshold
        AND (session_id IS NULL OR cm.session_id = session_id)
    ORDER BY cm.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ── Code Knowledge Search ───────────────────────────────────
CREATE OR REPLACE FUNCTION match_code_knowledge(
    query_embedding vector(1536),
    language_filter TEXT DEFAULT NULL,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 5
)
RETURNS TABLE(
    id UUID,
    file_path TEXT,
    language TEXT,
    content TEXT,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ck.id,
        ck.file_path,
        ck.language,
        ck.content,
        1 - (ck.embedding <=> query_embedding) AS similarity
    FROM code_knowledge ck
    WHERE
        1 - (ck.embedding <=> query_embedding) > match_threshold
        AND (language_filter IS NULL OR ck.language = language_filter)
    ORDER BY ck.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

## Embedding Models

### Model Comparison

| Model                    | Provider | Dimensions | Cost/1M tokens | Quality | Use Case                     |
| ------------------------ | -------- | ---------- | -------------- | ------- | ---------------------------- |
| `text-embedding-3-small` | OpenAI   | 1536       | $0.02          | Good    | Default, general purpose     |
| `text-embedding-3-large` | OpenAI   | 3072       | $0.13          | Best    | High-accuracy, legal/medical |
| `text-embedding-ada-002` | OpenAI   | 1536       | $0.10          | Good    | Legacy                       |
| `text-embedding-004`     | Gemini   | 768        | Free tier      | Good    | Google Cloud users           |
| DeepSeek embeddings      | DeepSeek | 1024       | $0.01          | Good    | Cost-sensitive               |
| `BAAI/bge-base-en-v1.5`  | Local    | 768        | Free           | Good    | Offline, privacy             |

### Node.js Embedding Client

```typescript
// src/integrations/embeddings/client.ts

export type EmbeddingProvider = "openai" | "gemini" | "deepseek" | "local"

interface EmbeddingConfig {
	provider: EmbeddingProvider
	apiKey?: string
	model?: string
	dimensions?: number
}

const EMBEDDING_DIMENSIONS: Record<string, number> = {
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
	"text-embedding-ada-002": 1536,
	"text-embedding-004": 768,
	"deepseek-embedding": 1024,
}

export async function generateEmbedding(
	text: string,
	config: EmbeddingConfig = { provider: "openai", model: "text-embedding-3-small" },
): Promise<number[]> {
	switch (config.provider) {
		case "openai":
			return generateOpenAIEmbedding(text, config)
		case "gemini":
			return generateGeminiEmbedding(text, config)
		case "deepseek":
			return generateDeepSeekEmbedding(text, config)
		case "local":
			return generateLocalEmbedding(text)
		default:
			throw new Error(`Unknown embedding provider: ${config.provider}`)
	}
}

async function generateOpenAIEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
	const response = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey || process.env.OPENAI_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: config.model || "text-embedding-3-small",
			input: text,
			dimensions: config.dimensions || 1536,
		}),
	})

	if (!response.ok) {
		throw new Error(`OpenAI embedding failed: ${response.statusText}`)
	}

	const data = await response.json()
	return data.data[0].embedding
}

async function generateGeminiEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${config.model || "text-embedding-004"}:embedContent?key=${config.apiKey || process.env.GEMINI_API_KEY}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: `models/${config.model || "text-embedding-004"}`,
				content: { parts: [{ text }] },
			}),
		},
	)

	if (!response.ok) {
		throw new Error(`Gemini embedding failed: ${response.statusText}`)
	}

	const data = await response.json()
	return data.embedding.values
}

async function generateDeepSeekEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
	const response = await fetch("https://api.deepseek.com/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey || process.env.DEEPSEEK_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: config.model || "deepseek-embedding",
			input: text,
		}),
	})

	if (!response.ok) {
		throw new Error(`DeepSeek embedding failed: ${response.statusText}`)
	}

	const data = await response.json()
	return data.data[0].embedding
}

async function generateLocalEmbedding(text: string): Promise<number[]> {
	// Uses a local sentence-transformers model via a sidecar service
	const response = await fetch("http://localhost:8080/embed", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
	})

	if (!response.ok) {
		throw new Error(`Local embedding failed: ${response.statusText}`)
	}

	const data = await response.json()
	return data.embedding
}

// ── Batch Embedding ─────────────────────────────────────────
export async function generateEmbeddings(
	texts: string[],
	config: EmbeddingConfig = { provider: "openai", model: "text-embedding-3-small" },
): Promise<number[][]> {
	// OpenAI supports batch embedding natively
	if (config.provider === "openai") {
		const response = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.apiKey || process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: config.model || "text-embedding-3-small",
				input: texts,
				dimensions: config.dimensions || 1536,
			}),
		})

		if (!response.ok) {
			throw new Error(`OpenAI batch embedding failed: ${response.statusText}`)
		}

		const data = await response.json()
		return data.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding)
	}

	// For other providers, generate sequentially
	return Promise.all(texts.map((t) => generateEmbedding(t, config)))
}
```

## Chunking Strategies

### Strategy Selection

| Strategy           | Best For                | Chunk Size          | Overlap       | Example                    |
| ------------------ | ----------------------- | ------------------- | ------------- | -------------------------- |
| **Fixed-size**     | Logs, simple text       | 512-1024 tokens     | 10-20%        | `"The quick brown fox..."` |
| **Recursive**      | Documentation, articles | 500-2000 chars      | 100-200 chars | Markdown docs              |
| **Semantic**       | Natural language        | Variable (sentence) | 1-2 sentences | Chat conversations         |
| **Code-aware**     | Source code             | Function/class      | 0             | `.ts`, `.js`, `.py` files  |
| **Markdown-aware** | `.md` files             | Heading sections    | 0             | README, docs               |

### Implementation

```typescript
// src/integrations/rag/chunking.ts

interface ChunkResult {
	chunks: string[]
	metadata: Array<{
		index: number
		start: number
		end: number
		tokens?: number
	}>
}

// ── Recursive Character Chunking ────────────────────────────
export function recursiveChunk(
	text: string,
	options: {
		chunkSize?: number
		chunkOverlap?: number
		separators?: string[]
	} = {},
): ChunkResult {
	const { chunkSize = 1000, chunkOverlap = 200, separators = ["\n\n", "\n", ". ", " ", ""] } = options

	const chunks: string[] = []
	const metadata: ChunkResult["metadata"] = []
	let start = 0

	while (start < text.length) {
		let end = Math.min(start + chunkSize, text.length)

		// Try to break at a natural boundary
		for (const sep of separators) {
			const breakPoint = text.lastIndexOf(sep, end)
			if (breakPoint > start + chunkSize * 0.5) {
				end = breakPoint + sep.length
				break
			}
		}

		chunks.push(text.slice(start, end))
		metadata.push({
			index: metadata.length,
			start,
			end,
		})

		start = end - chunkOverlap
	}

	return { chunks, metadata }
}

// ── Code-Aware Chunking ─────────────────────────────────────
export function chunkCode(code: string, language: string): ChunkResult {
	const chunks: string[] = []
	const metadata: ChunkResult["metadata"] = []

	// Language-specific patterns
	const patterns: Record<string, RegExp> = {
		typescript:
			/(?:export\s+)?(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function)|class\s+\w+|interface\s+\w+|type\s+\w+)/g,
		javascript:
			/(?:export\s+)?(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function)|class\s+\w+)/g,
		python: /(?:async\s+)?def\s+\w+|class\s+\w+|@(?:app|router)\.(?:get|post|put|delete)/g,
		default: /(?:function|class|def)\s+\w+/g,
	}

	const regex = patterns[language] || patterns.default
	let match: RegExpExecArray | null
	let lastIndex = 0

	while ((match = regex.exec(code)) !== null) {
		if (match.index - lastIndex > 50) {
			const chunk = code.slice(lastIndex, match.index).trim()
			if (chunk.length > 50) {
				chunks.push(chunk)
				metadata.push({ index: metadata.length, start: lastIndex, end: match.index })
			}
		}
		lastIndex = match.index
	}

	if (lastIndex < code.length) {
		const remaining = code.slice(lastIndex).trim()
		if (remaining.length > 50) {
			chunks.push(remaining)
			metadata.push({ index: metadata.length, start: lastIndex, end: code.length })
		}
	}

	return { chunks, metadata }
}

// ── Markdown-Aware Chunking ─────────────────────────────────
export function chunkMarkdown(markdown: string): ChunkResult {
	const chunks: string[] = []
	const metadata: ChunkResult["metadata"] = []

	// Split by headings
	const headingRegex = /^#{1,6}\s+.+$/gm
	let lastIndex = 0
	let lastHeading = ""
	let match: RegExpExecArray | null

	while ((match = headingRegex.exec(markdown)) !== null) {
		if (lastIndex > 0) {
			const chunk = `# ${lastHeading}\n\n${markdown.slice(lastIndex, match.index).trim()}`
			chunks.push(chunk)
			metadata.push({ index: metadata.length, start: lastIndex, end: match.index })
		}
		lastHeading = match[0].replace(/^#+\s*/, "")
		lastIndex = match.index + match[0].length
	}

	// Last section
	if (lastIndex < markdown.length) {
		const chunk = `# ${lastHeading}\n\n${markdown.slice(lastIndex).trim()}`
		chunks.push(chunk)
		metadata.push({ index: metadata.length, start: lastIndex, end: markdown.length })
	}

	return { chunks, metadata }
}

// ── Semantic Chunking (sentence-aware) ──────────────────────
export function semanticChunk(text: string, maxChunkSize: number = 1000): ChunkResult {
	// Split into sentences
	const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text]

	const chunks: string[] = []
	const metadata: ChunkResult["metadata"] = []
	let currentChunk = ""
	let chunkStart = 0

	for (let i = 0; i < sentences.length; i++) {
		const sentence = sentences[i]

		if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
			chunks.push(currentChunk.trim())
			metadata.push({
				index: metadata.length,
				start: chunkStart,
				end: chunkStart + currentChunk.length,
			})
			currentChunk = sentence
			chunkStart += currentChunk.length
		} else {
			currentChunk += sentence
		}
	}

	if (currentChunk.trim().length > 0) {
		chunks.push(currentChunk.trim())
		metadata.push({
			index: metadata.length,
			start: chunkStart,
			end: chunkStart + currentChunk.length,
		})
	}

	return { chunks, metadata }
}
```

## Search Patterns

### Pattern 1: Basic Vector Search

```typescript
async function vectorSearch(
	query: string,
	options: {
		limit?: number
		threshold?: number
		table?: string
		filter?: Record<string, any>
	} = {},
) {
	const { limit = 5, threshold = 0.7, table = "documents", filter } = options

	const embedding = await generateEmbedding(query)

	const { data, error } = await supabase.rpc("match_documents", {
		query_embedding: embedding,
		match_threshold: threshold,
		match_count: limit,
		filter_metadata: filter || null,
	})

	if (error) throw error
	return data
}
```

### Pattern 2: Hybrid Search

```typescript
async function hybridSearch(
	query: string,
	options: {
		limit?: number
		vectorWeight?: number
		filter?: Record<string, any>
	} = {},
) {
	const { limit = 5, vectorWeight = 0.5, filter } = options

	const embedding = await generateEmbedding(query)

	const { data, error } = await supabase.rpc("hybrid_search", {
		query_embedding: embedding,
		query_text: query,
		match_count: limit,
		vector_weight: vectorWeight,
		filter_metadata: filter || null,
	})

	if (error) throw error
	return data
}
```

### Pattern 3: Multi-Table Search

```typescript
async function multiTableSearch(
	query: string,
	options: {
		limit?: number
		includeCode?: boolean
		includeMemory?: boolean
		includeDocs?: boolean
	} = {},
) {
	const { limit = 5, includeCode = true, includeMemory = true, includeDocs = true } = options

	const embedding = await generateEmbedding(query)
	const searches: Promise<any>[] = []

	if (includeDocs) {
		searches.push(
			supabase
				.rpc("match_documents", {
					query_embedding: embedding,
					match_threshold: 0.6,
					match_count: limit,
				})
				.then((r) => (r.data || []).map((d) => ({ ...d, source: "documents" }))),
		)
	}

	if (includeCode) {
		searches.push(
			supabase
				.rpc("match_code_knowledge", {
					query_embedding: embedding,
					match_threshold: 0.7,
					match_count: limit,
				})
				.then((r) => (r.data || []).map((d) => ({ ...d, source: "code" }))),
		)
	}

	if (includeMemory) {
		searches.push(
			supabase
				.rpc("match_conversation_memory", {
					query_embedding: embedding,
					match_threshold: 0.5,
					match_count: limit,
				})
				.then((r) => (r.data || []).map((d) => ({ ...d, source: "memory" }))),
		)
	}

	const results = await Promise.all(searches)
	const all = results.flat().sort((a, b) => b.similarity - a.similarity)

	// Deduplicate by content
	const seen = new Set<string>()
	return all
		.filter((r) => {
			if (seen.has(r.content)) return false
			seen.add(r.content)
			return true
		})
		.slice(0, limit * 2)
}
```

## RAG Pipeline

### Complete RAG Implementation

```typescript
// src/integrations/rag/pipeline.ts

interface RAGOptions {
	limit?: number
	threshold?: number
	useHybrid?: boolean
	includeCode?: boolean
	includeMemory?: boolean
	conversationHistory?: Array<{ role: string; content: string }>
	systemPrompt?: string
	model?: string
	temperature?: number
}

interface RAGResult {
	response: string
	sources: Array<{
		content: string
		similarity: number
		source: string
	}>
	tokensUsed: number
	latency: number
}

export async function ragQuery(userQuery: string, options: RAGOptions = {}): Promise<RAGResult> {
	const startTime = Date.now()
	const {
		limit = 5,
		threshold = 0.6,
		useHybrid = true,
		includeCode = true,
		includeMemory = true,
		conversationHistory = [],
		systemPrompt = "You are a helpful coding assistant. Use the provided context to answer accurately.",
		model = "gpt-4o-mini",
		temperature = 0.3,
	} = options

	// 1. Retrieve relevant context
	const contextResults = await multiTableSearch(userQuery, {
		limit,
		includeCode,
		includeMemory,
		includeDocs: true,
	})

	// 2. Build context string
	const context = contextResults.map((r) => `[${r.source}] ${r.content}`).join("\n\n---\n\n")

	// 3. Build messages array
	const messages = [
		{
			role: "system",
			content: `${systemPrompt}\n\nRelevant Context:\n${context}\n\nIf the context doesn't contain relevant information, say so. Cite sources using [source] notation.`,
		},
		...conversationHistory.slice(-10),
		{ role: "user", content: userQuery },
	]

	// 4. Generate response
	const response = await callChatCompletion(process.env.API_BASE_URL!, process.env.API_KEY!, model, messages, {
		temperature,
	})

	return {
		response,
		sources: contextResults.slice(0, limit).map((r) => ({
			content: r.content.slice(0, 200),
			similarity: r.similarity,
			source: r.source,
		})),
		tokensUsed: 0, // TODO: track token usage
		latency: Date.now() - startTime,
	}
}
```

### Streaming RAG (for IDE Chat)

```typescript
async function* ragQueryStreaming(
	userQuery: string,
	options: RAGOptions = {},
): AsyncGenerator<string, RAGResult, void> {
	const startTime = Date.now()

	// 1. Yield status update
	yield JSON.stringify({ type: "status", message: "Searching knowledge base..." })

	// 2. Retrieve context
	const contextResults = await multiTableSearch(userQuery, {
		limit: options.limit || 5,
		includeCode: true,
		includeMemory: true,
	})

	yield JSON.stringify({ type: "status", message: `Found ${contextResults.length} relevant sources` })

	// 3. Build context
	const context = contextResults.map((r) => `[${r.source}] ${r.content}`).join("\n\n---\n\n")

	// 4. Stream response
	const stream = await fetchStreamingCompletion(
		process.env.API_BASE_URL!,
		process.env.API_KEY!,
		options.model || "gpt-4o-mini",
		[
			{
				role: "system",
				content: `Use this context:\n${context}`,
			},
			...(options.conversationHistory || []).slice(-10),
			{ role: "user", content: userQuery },
		],
		{ temperature: 0.3 },
	)

	for await (const chunk of stream) {
		yield JSON.stringify({ type: "token", content: chunk })
	}

	// 5. Return final result
	return {
		response: "", // accumulated from stream
		sources: contextResults.map((r) => ({
			content: r.content.slice(0, 200),
			similarity: r.similarity,
			source: r.source,
		})),
		tokensUsed: 0,
		latency: Date.now() - startTime,
	}
}
```

## Integration Points

### 1. Telegram Bot (`cloud/api/telegramBot.js`)

Add RAG-powered memory to `askAI()`:

```javascript
// In askAI(), before building the prompt:
async function enrichWithRag(message, chatId) {
	try {
		const orchestrator = global.__orchestrator
		if (!orchestrator?.hermesClaw?.pgvectorEnabled) return null

		const relevantContext = await orchestrator.hermesClaw.recallContext(message, {
			limit: 5,
			threshold: 0.6,
		})

		if (relevantContext.length > 0) {
			return `Relevant past context:\n${relevantContext.map((m) => m.content).join("\n")}`
		}
	} catch (err) {
		logTelegramError("rag:enrich", chatId, null, err)
	}
	return null
}
```

### 2. IDE Chat (`cloud/dashboard/src/components/views/ide-terminal.tsx`)

Add RAG context enrichment before sending messages:

```typescript
// In handleAiSend(), before the WebSocket send:
async function enrichWithWorkspaceContext(message: string): Promise<string> {
	try {
		const response = await fetch("/api/rag/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: message,
				workspace: currentWorkspace,
				limit: 5,
				includeCode: true,
			}),
		})

		if (!response.ok) return message

		const { results } = await response.json()
		if (results.length === 0) return message

		const context = results.map((r: any) => `[${r.source}: ${r.file_path || "knowledge"}] ${r.content}`).join("\n")

		return `Relevant workspace context:\n${context}\n\nUser: ${message}`
	} catch {
		return message // Fall through on error
	}
}
```

### 3. Orchestrator HermesClaw (`cloud/orchestrator/modules/HermesClaw.js`)

Add pgvector-backed persistent memory:

```javascript
class HermesClaw {
  constructor(config) {
    this.pgvectorEnabled = !!config.supabase;
    this.supabase = config.supabase;
    this.inMemoryStore = [];
  }

  async recallContext(query, options = {}) {
    const { limit = 5, threshold = 0.6 } = options;

    if (this.pgvectorEnabled) {
      try {
        const embedding = await this.generateEmbedding(query);
        const { data } = await this.supabase.rpc('match_hermes_memory', {
          query_embedding: embedding,
          match_threshold: threshold,
          match_count: limit,
        });
        return data || [];
      } catch (err) {
        console.warn('[HermesClaw] pgvector recall failed, falling back to in-memory:', err.message);
      }
    }

    return this._inMemorySearch(query, limit);
  }

  async storeLesson(lesson) {
    if (this.pgvectorEnabled) {
      try {
        const embedding = await this.generateEmbedding(lesson.summary);
        await this.supabase.from('hermes_lessons').insert({
          summary: lesson.summary,
          details: lesson.details,
          embedding,
          metadata: lesson.metadata || {},
        });
      } catch (err) {
        console.warn('[HermesClaw] pgvector store failed:', err.message);
      }
    }

    this.inMemoryStore.push({
      ...lesson,
      timestamp: Date.now(),
    });

    // Keep in-memory store bounded
    if (this.inMemoryStore.length > 1000) {
      this.inMemoryStore = this.inMemoryStore.slice(-500);
    }
  }

  async generateEmbedding(text) {
    // Reuse the embedding client
    const { generateEmbedding } = require('../../integrations/embeddings/client');
    return generateEmbedding(text, {
      provider: process.env.EMBEDDING_PROVIDER || 'openai',
    });
  }

  _
```
