---
name: pgvector-rag
description: 🗄️ PostgreSQL + pgvector + RAG — Integrate vector search, embeddings, and Retrieval-Augmented Generation into SuperRoo apps using PostgreSQL with the pgvector extension
---

# PostgreSQL + pgvector + RAG Skill

## When To Use

Use this skill when the user asks to:

- Add vector search / semantic search to any SuperRoo app
- Implement Retrieval-Augmented Generation (RAG) for AI context injection
- Store and query embeddings in PostgreSQL
- Upgrade existing PostgreSQL databases with vector capabilities
- Build knowledge bases, memory systems, or semantic caches
- Integrate embeddings from OpenAI, Gemini, DeepSeek, or local models
- Create hybrid search (keyword + vector) pipelines
- Set up document ingestion and chunking pipelines

## Core Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    RAG Pipeline                          │
│                                                         │
│  Documents ──▶ Chunking ──▶ Embedding ──▶ pgvector DB   │
│                    │                      │              │
│                    │                      ▼              │
│                    │              Vector Search          │
│                    │                      │              │
│                    ▼                      ▼              │
│              User Query ──▶ Embedding ──▶ Hybrid Search  │
│                                              │          │
│                                              ▼          │
│                                    Context + LLM Prompt │
│                                              │          │
│                                              ▼          │
│                                        LLM Response     │
└─────────────────────────────────────────────────────────┘
```

### Key Components

| Component             | Purpose                     | Technology                                    |
| --------------------- | --------------------------- | --------------------------------------------- |
| **Vector Database**   | Store & query embeddings    | PostgreSQL + pgvector                         |
| **Embedding Model**   | Convert text → vectors      | OpenAI `text-embedding-3-small`, Gemini, etc. |
| **Chunking Strategy** | Split documents into pieces | RecursiveCharacterTextSplitter, Semantic      |
| **Retriever**         | Find relevant context       | pgvector ANN (IVFFlat, HNSW)                  |
| **Reranker**          | Re-rank retrieved results   | Cross-encoder, Cohere Rerank                  |
| **LLM**               | Generate final answer       | Any provider (OpenAI, Anthropic, DeepSeek)    |

## PostgreSQL + pgvector Setup

### 1. Install pgvector Extension

```sql
-- On PostgreSQL 14+
CREATE EXTENSION IF NOT EXISTS vector;
```

**On Ubuntu/Debian (VPS):**

```bash
sudo apt install postgresql-16-pgvector
```

**On Docker:**

```dockerfile
FROM pgvector/pgvector:pg16
```

**Verify installation:**

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

### 2. Create Vector Tables

```sql
-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),  -- dimension depends on model
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for similarity search
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- OR for better accuracy (slower index build):
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);

-- Conversations / memory table
CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_memory_session ON conversation_memory(session_id);
CREATE INDEX idx_memory_embedding ON conversation_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Code knowledge base (for IDE chat)
CREATE TABLE code_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    summary TEXT,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_code_embedding ON code_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 3. Index Types Comparison

| Index        | Build Speed | Query Speed      | Accuracy  | Use Case                           |
| ------------ | ----------- | ---------------- | --------- | ---------------------------------- |
| **IVFFlat**  | Fast        | Fast             | Good      | Large datasets, approximate search |
| **HNSW**     | Slow        | Very Fast        | Excellent | Production, high-accuracy needs    |
| **No index** | N/A         | Slow (full scan) | Exact     | Small datasets (<10K rows)         |

## Embedding Integration

### Node.js / TypeScript

```typescript
import { createClient } from "@supabase/supabase-js"

// ── Embedding Generation ──────────────────────────────────
async function generateEmbedding(text: string): Promise<number[]> {
	const response = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "text-embedding-3-small", // 1536 dimensions
			input: text,
		}),
	})
	const data = await response.json()
	return data.data[0].embedding
}

// ── Store Embedding ───────────────────────────────────────
async function storeDocument(content: string, metadata: Record<string, any> = {}) {
	const embedding = await generateEmbedding(content)
	const { data, error } = await supabase.from("documents").insert({
		content,
		metadata,
		embedding,
	})
	return { data, error }
}

// ── Vector Search ─────────────────────────────────────────
async function searchSimilar(query: string, limit: number = 5, threshold: number = 0.7) {
	const queryEmbedding = await generateEmbedding(query)

	const { data, error } = await supabase.rpc("match_documents", {
		query_embedding: queryEmbedding,
		match_threshold: threshold,
		match_count: limit,
	})

	return data
}
```

### PostgreSQL Function for Vector Search

```sql
-- Create the match function
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(1536),
    match_threshold float,
    match_count int
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
        documents.id,
        documents.content,
        documents.metadata,
        1 - (documents.embedding <=> query_embedding) AS similarity
    FROM documents
    WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
    ORDER BY documents.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Hybrid search: vector + full-text
CREATE OR REPLACE FUNCTION hybrid_search(
    query_embedding vector(1536),
    query_text text,
    match_count int,
    vector_weight float DEFAULT 0.5
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
         (1 - vector_weight) * ts_rank(to_tsvector('english', d.content), plainto_tsquery('english', query_text)))
        AS score
    FROM documents d
    WHERE
        (1 - (d.embedding <=> query_embedding)) > 0.5
        OR to_tsvector('english', d.content) @@ plainto_tsquery('english', query_text)
    ORDER BY score DESC
    LIMIT match_count;
END;
$$;
```

## Document Chunking Strategies

### Strategy Comparison

| Strategy       | Best For               | Chunk Size                     | Overlap       |
| -------------- | ---------------------- | ------------------------------ | ------------- |
| **Fixed-size** | Simple text, logs      | 512-1024 tokens                | 10-20%        |
| **Recursive**  | Code, structured text  | 500-2000 chars                 | 100-200 chars |
| **Semantic**   | Natural language, docs | Variable (sentence boundaries) | 1-2 sentences |
| **Code-aware** | Source code            | Function/class boundaries      | 0             |

### Recursive Chunking (Recommended for General Use)

```typescript
function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
	const chunks: string[] = []
	const separators = ["\n\n", "\n", ". ", " ", ""]

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
		start = end - overlap
	}

	return chunks
}
```

### Code-Aware Chunking (for Source Code)

```typescript
function chunkCode(code: string, language: string): string[] {
	// Split by function/class boundaries
	const functionRegex =
		/(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|class\s+\w+|export\s+(?:default\s+)?(?:function|class|const))\s*/g

	const chunks: string[] = []
	let lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = functionRegex.exec(code)) !== null) {
		if (match.index - lastIndex > 50) {
			chunks.push(code.slice(lastIndex, match.index))
		}
		lastIndex = match.index
	}

	if (lastIndex < code.length) {
		chunks.push(code.slice(lastIndex))
	}

	return chunks.filter((c) => c.trim().length > 50)
}
```

## RAG Pipeline Implementation

### Basic RAG (for Telegram Bot / IDE Chat)

```typescript
async function ragQuery(
	userQuery: string,
	options: {
		limit?: number
		threshold?: number
		useHybrid?: boolean
	} = {},
): Promise<string> {
	const { limit = 5, threshold = 0.7, useHybrid = true } = options

	// 1. Generate embedding for query
	const queryEmbedding = await generateEmbedding(userQuery)

	// 2. Retrieve relevant context
	let results
	if (useHybrid) {
		results = await supabase.rpc("hybrid_search", {
			query_embedding: queryEmbedding,
			query_text: userQuery,
			match_count: limit,
		})
	} else {
		results = await supabase.rpc("match_documents", {
			query_embedding: queryEmbedding,
			match_threshold: threshold,
			match_count: limit,
		})
	}

	// 3. Build context from retrieved documents
	const context = results.map((r: any) => r.content).join("\n\n---\n\n")

	// 4. Generate response with context
	const response = await callChatCompletion(apiBaseUrl, apiKey, model, [
		{
			role: "system",
			content: `You are a helpful assistant. Use the following context to answer the user's question. If the context doesn't contain relevant information, say so.\n\nContext:\n${context}`,
		},
		{ role: "user", content: userQuery },
	])

	return response
}
```

### Advanced RAG with Reranking

```typescript
async function advancedRagQuery(
	userQuery: string,
	conversationHistory: Array<{ role: string; content: string }>,
): Promise<string> {
	// 1. Generate embedding
	const queryEmbedding = await generateEmbedding(userQuery)

	// 2. Multi-source retrieval
	const [docResults, memoryResults, codeResults] = await Promise.all([
		supabase.rpc("match_documents", { query_embedding: queryEmbedding, match_threshold: 0.6, match_count: 10 }),
		supabase.rpc("match_conversation_memory", {
			query_embedding: queryEmbedding,
			match_threshold: 0.5,
			match_count: 5,
		}),
		supabase.rpc("match_code_knowledge", { query_embedding: queryEmbedding, match_threshold: 0.7, match_count: 5 }),
	])

	// 3. Merge and deduplicate
	const allResults = [...docResults, ...memoryResults, ...codeResults]
	const seen = new Set<string>()
	const unique = allResults.filter((r) => {
		if (seen.has(r.content)) return false
		seen.add(r.content)
		return true
	})

	// 4. Rerank with cross-encoder (optional, requires Cohere API)
	// const reranked = await rerankWithCohere(userQuery, unique.map(r => r.content));

	// 5. Build compressed context
	const context = unique
		.slice(0, 8)
		.map((r) => r.content)
		.join("\n\n---\n\n")

	// 6. Generate with conversation awareness
	const messages = [
		{
			role: "system",
			content: `You are a coding assistant with access to a knowledge base. Use the context below to answer accurately.\n\nRelevant Context:\n${context}`,
		},
		...conversationHistory.slice(-6),
		{ role: "user", content: userQuery },
	]

	return await callChatCompletion(apiBaseUrl, apiKey, model, messages)
}
```

## Integration with SuperRoo Modules

### 1. Telegram Bot Memory

In [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js), add RAG-powered memory:

```javascript
// In askAI(), before building the prompt:
if (global.__orchestrator?.hermesClaw) {
	const relevantMemories = await global.__orchestrator.hermesClaw.recallContext(message, { limit: 5, threshold: 0.6 })
	if (relevantMemories.length > 0) {
		contextParts.push(`Relevant past context:\n${relevantMemories.map((m) => m.content).join("\n")}`)
	}
}
```

### 2. IDE Chat Context Injection

In [`cloud/dashboard/src/components/views/ide-terminal.tsx`](cloud/dashboard/src/components/views/ide-terminal.tsx), add RAG for workspace-aware chat:

```typescript
// Before sending chat message to API:
async function enrichWithRagContext(userMessage: string): Promise<string> {
	const response = await fetch("/api/rag/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			query: userMessage,
			workspace: currentWorkspace,
			limit: 5,
		}),
	})
	const { results } = await response.json()

	if (results.length > 0) {
		return `Relevant workspace context:\n${results.map((r) => r.content).join("\n")}\n\nUser: ${userMessage}`
	}
	return userMessage
}
```

### 3. Orchestrator HermesClaw Upgrade

In [`cloud/orchestrator/modules/HermesClaw.js`](cloud/orchestrator/modules/HermesClaw.js), add pgvector-backed persistent memory:

```javascript
class HermesClaw {
	async recallContext(query, options = {}) {
		const { limit = 5, threshold = 0.6 } = options

		// Try pgvector first (persistent), fall back to in-memory
		if (this.pgvectorEnabled) {
			const embedding = await this.generateEmbedding(query)
			const results = await this.supabase.rpc("match_hermes_memory", {
				query_embedding: embedding,
				match_threshold: threshold,
				match_count: limit,
			})
			return results
		}

		// Fallback to in-memory search
		return this._inMemorySearch(query, limit)
	}

	async storeLesson(lesson) {
		if (this.pgvectorEnabled) {
			const embedding = await this.generateEmbedding(lesson.summary)
			await this.supabase.from("hermes_lessons").insert({
				content: lesson.summary,
				details: lesson.details,
				embedding,
				metadata: lesson.metadata,
			})
		}
		this._inMemoryStore(lesson)
	}
}
```

## Deployment on VPS

### 1. Install PostgreSQL + pgvector

```bash
# SSH into VPS via Tailscale
ssh root@100.64.175.88

# Install PostgreSQL 16
sudo apt update
sudo apt install -y postgresql-16 postgresql-16-pgvector postgresql-client-16

# Start and enable
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 2. Create Database and User

```bash
sudo -u postgres psql

CREATE DATABASE superroo_rag;
CREATE USER superroo WITH PASSWORD 'your-strong-password';
GRANT ALL PRIVILEGES ON DATABASE superroo_rag TO superroo;
\c superroo_rag
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL ON SCHEMA public TO superroo;
```

### 3. Connection String

```
DATABASE_URL=postgresql://superroo:password@localhost:5432/superroo_rag
```

### 4. Docker Compose (if using containers)

```yaml
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

## Performance Optimization

### Index Tuning

```sql
-- For datasets < 100K rows: IVFFlat with 100 lists
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- For datasets > 100K rows: IVFFlat with sqrt(n) lists
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 316);  -- sqrt(100K)

-- For production: HNSW (slower build, faster queries)
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
```

### Query Optimization

```sql
-- Use exact search for small datasets
SELECT * FROM documents ORDER BY embedding <=> '[0.1, 0.2, ...]' LIMIT 5;

-- Use approximate search with IVFFlat (set probes)
SET ivfflat.probes = 10;  -- default is 1, higher = more accurate but slower

-- Use approximate search with HNSW (set ef_search)
SET hnsw.ef_search = 100;  -- default is 40, higher = more accurate but slower
```

## Embedding Model Selection

| Model                         | Dimensions | Cost            | Quality | Use Case                     |
| ----------------------------- | ---------- | --------------- | ------- | ---------------------------- |
| `text-embedding-3-small`      | 1536       | $0.02/1M tokens | Good    | Default, general purpose     |
| `text-embedding-3-large`      | 3072       | $0.13/1M tokens | Best    | High-accuracy, legal/medical |
| `text-embedding-ada-002`      | 1536       | $0.10/1M tokens | Good    | Legacy, deprecated           |
| Gemini `text-embedding-004`   | 768        | Free tier       | Good    | Google Cloud users           |
| DeepSeek embeddings           | 1024       | $0.01/1M tokens | Good    | Cost-sensitive               |
| Local (sentence-transformers) | 384-1024   | Free            | Fair    | Offline, privacy             |

## Common Patterns

### Pattern 1: Semantic Cache

Cache LLM responses to avoid redundant API calls:

```typescript
const semanticCache = new Map<string, { response: string; embedding: number[] }>()

async function getCachedOrGenerate(query: string): Promise<string> {
	const queryEmbedding = await generateEmbedding(query)

	// Check cache
	for (const [cachedQuery, cached] of semanticCache) {
		const similarity = cosineSimilarity(queryEmbedding, cached.embedding)
		if (similarity > 0.95) {
			return cached.response // Cache hit
		}
	}

	// Cache miss — generate and store
	const response = await callLLM(query)
	semanticCache.set(query, { response, embedding: queryEmbedding })

	// Also store in pgvector for persistence
	await supabase.from("response_cache").insert({
		query,
		response,
		embedding: queryEmbedding,
	})

	return response
}
```

### Pattern 2: Conversation Memory with Decay

```typescript
async function storeConversationMemory(
	sessionId: string,
	role: string,
	content: string,
	importance: number = 0.5, // 0-1, higher = more important
) {
	const embedding = await generateEmbedding(content)

	await supabase.from("conversation_memory").insert({
		session_id: sessionId,
		role,
		content,
		embedding,
		metadata: { importance, timestamp: Date.now() },
	})

	// Prune old low-importance memories
	await supabase
		.from("conversation_memory")
		.delete()
		.eq("session_id", sessionId)
		.filter("metadata->>importance", "lt", "0.3")
		.lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
}
```

### Pattern 3: Code Knowledge Base Auto-Indexing

```typescript
async function indexWorkspaceFiles(files: Array<{ path: string; content: string }>) {
	for (const file of files) {
		const chunks = chunkCode(file.content, detectLanguage(file.path))

		for (const chunk of chunks) {
			const embedding = await generateEmbedding(chunk)
			await supabase.from("code_knowledge").upsert(
				{
					file_path: file.path,
					language: detectLanguage(file.path),
					content: chunk,
					embedding,
				},
				{ onConflict: "file_path, content" },
			)
		}
	}
}
```

## Testing

```typescript
import { describe, it, expect } from "vitest"

describe("pgvector RAG", () => {
	it("should store and retrieve embeddings", async () => {
		const text = "SuperRoo is a cloud dashboard for AI agents"
		const embedding = await generateEmbedding(text)
		expect(embedding).toHaveLength(1536)

		const { data } = await supabase
			.from("documents")
			.insert({
				content: text,
				embedding,
			})
			.select()
		expect(data).toHaveLength(1)
	})

	it("should find similar documents", async () => {
		const results = await searchSimilar("AI agent dashboard", 3, 0.5)
		expect(results.length).toBeGreaterThan(0)
		expect(results[0].similarity).toBeGreaterThan(0.5)
	})

	it("should perform hybrid search", async () => {
		const results = await supabase.rpc("hybrid_search", {
			query_embedding: await generateEmbedding("deploy commands"),
			query_text: "how to deploy",
			match_count: 5,
		})
		expect(results.length).toBeGreaterThan(0)
	})
})
```

## Related Skills

- [`supabase`](.roo/skills/supabase/SKILL.md) — Supabase integration (uses PostgreSQL under the hood)
- [`google-cloud-api`](.roo/skills/google-cloud-api/SKILL.md) — Google Cloud AI embeddings
- [`telegram-integration`](.roo/skills/telegram-integration/SKILL.md) — Telegram bot with RAG memory
- [`digitalocean-vps`](.roo/skills/digitalocean-vps/SKILL.md) — VPS deployment for PostgreSQL
