# SuperRoo Repo Indexing Architecture

## Overview

The Repo Indexing system provides **semantic codebase search** for SuperRoo agents. Instead of scanning the entire repository on every task (wasting tokens, time, and context window), agents can query a pre-built vector index to find only the relevant files.

```
┌─────────────────────────────────────────────────────────────────┐
│                     SuperRoo Orchestrator                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Coder    │  │ Debugger │  │ Crawler  │  │ Terminal      │  │
│  │ Agent    │  │ Agent    │  │ Agent    │  │ Agent         │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │              │               │           │
│       └──────────────┴──────────────┴───────────────┘           │
│                              │                                   │
│                     ┌────────▼────────┐                         │
│                     │  Repo Search    │                         │
│                     │  (repo-search)  │                         │
│                     └────────┬────────┘                         │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Qdrant Vector DB  │
                    │  (superroo_code_    │
                    │   chunks collection)│
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Ollama Embeddings  │
                    │  (nomic-embed-text) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Indexer Worker     │
                    │  (file watcher)     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Git Repository     │
                    │  (/superroo2)       │
                    └─────────────────────┘
```

## Components

### 1. Qdrant Vector DB (`server/src/memory/qdrant-client.ts`)

High-performance vector database for storing and searching code chunk embeddings.

- **Collection**: `superroo_code_chunks` (768-dim, Cosine distance, HNSW index)
- **Client**: REST API client with methods for upsert, search, delete, and collection management
- **Payload indexes**: `projectId`, `filePath`, `language`, `symbolType` for filtered search

### 2. Code Chunker (`server/src/memory/chunker.ts`)

Splits source files into semantic chunks for embedding.

- **Language-aware**: Detects 20+ languages from file extensions
- **Boundary detection**: Regex-based splitting at function/class/component boundaries
- **Fallback**: Line-count splitting (80 lines max, 5 min, 3 overlap) for unstructured files
- **Skip patterns**: Binary files, images, `node_modules`, `.git`, build artifacts

### 3. Repo Indexer (`server/src/memory/repo-indexer.ts`)

Full repository indexing engine.

- **Walk**: Recursive directory walker skipping hidden/non-source dirs
- **Embed**: Calls Ollama `/api/embeddings` for each chunk
- **Store**: Batch upsert to Qdrant (50 points per batch)
- **Progress**: Callback-based progress reporting
- **Incremental**: `reindexFile()` for single-file updates

### 4. Repo Search (`server/src/memory/repo-search.ts`)

High-level search API for agents.

- **Query embedding**: Creates query vector via Ollama
- **Vector search**: Cosine similarity search in Qdrant
- **Filters**: Optional projectId, language, symbolType, filePath
- **Context builder**: Formats results as XML for LLM prompt injection

### 5. Indexer Worker (`apps/indexer-worker/src/worker.js`)

Long-lived file watcher for incremental indexing.

- **File watching**: chokidar-based with debounce (2s)
- **Auto-reindex**: On file change → delete old points → re-chunk → re-embed → re-insert
- **Health server**: HTTP endpoint on port 3418 (`/health`, `/reindex`)
- **Queue**: Sequential processing with debounce batching

### 6. Indexer CLI (`apps/indexer-worker/src/cli.js`)

One-shot indexing for initial setup or manual re-index.

- **Full index**: Walks entire repo, indexes all files
- **Single file**: `--reindex path/to/file.ts` for targeted updates
- **Progress**: Real-time progress display

## Data Flow

### Initial Indexing

```
npm run index  (or  node src/cli.js --repo /path/to/repo)
    │
    ▼
Walk directory ──→ Filter indexable files ──→ For each file:
    │                                               │
    │                                               ▼
    │                                    Read file → Chunk → Embed → Upsert to Qdrant
    │                                               │
    └───────────────────────────────────────────────┘
```

### Incremental Updates (File Watcher)

```
Git change / file save
    │
    ▼
chokidar detects change ──→ Debounce (2s) ──→ Queue file
    │
    ▼
Process queue ──→ Read file ──→ Delete old Qdrant points
    │                           │
    │                           ▼
    │                  Chunk → Embed → Upsert to Qdrant
    │
    ▼
Health endpoint updated (indexedFiles++, indexedChunks++)
```

### Runtime Search

```
Agent needs code context
    │
    ▼
repo-search.searchCodebase(query, { projectId, language?, topK? })
    │
    ▼
Ollama embedding ──→ Qdrant search ──→ Filter results
    │
    ▼
repo-search.buildSearchContext(results) ──→ XML context string
    │
    ▼
Inject into agent prompt ──→ LLM sees only relevant code
```

## Deployment

### Docker Compose

Add to existing SuperRoo stack:

```bash
docker-compose -f docker-compose.yml -f docker-compose.indexing.yml up -d
```

This starts:
- `superroo-qdrant` — Vector DB on port 6333
- `superroo-ollama` — Embeddings on port 11434
- `superroo-indexer` — File watcher on port 3418

### Standalone

```bash
# Start Qdrant
docker run -d -p 6333:6333 -v qdrant_data:/qdrant/storage qdrant/qdrant

# Start Ollama
docker run -d -p 11434:11434 -v ollama_data:/root/.ollama ollama/ollama

# Pull embedding model
docker exec superroo-ollama ollama pull nomic-embed-text

# Run indexer
cd apps/indexer-worker
npm run index -- --repo /path/to/superroo2 --project superroo2
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST API URL |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model name |
| `REPO_PATH` | `process.cwd()` | Repository path to watch |
| `PROJECT_ID` | `superroo2` | Project identifier for namespacing |
| `WATCHER_PORT` | `3418` | Health check HTTP port |
| `DEBOUNCE_MS` | `2000` | File change debounce in ms |

### Recommended Models

| Model | Vector Size | Quality | Speed | RAM |
|-------|-------------|---------|-------|-----|
| `nomic-embed-text` | 768 | Good | Fast | ~500MB |
| `mxbai-embed-large` | 1024 | Better | Moderate | ~700MB |
| `bge-m3` | 1024 | Best | Slow | ~2GB |

## Integration Points

### With Central Brain

The Repo Search integrates with the Central Brain pipeline:

```
SharedContextPacket → RAG Memory → Repo Search → BrainRouter → Permission Gate → Agent Execute
                              │
                              ▼
                    Qdrant vector search
                    (relevant code chunks)
```

### With Agent Prompts

Agents receive repo context automatically via the `RagContextBuilder`:

```typescript
const context = await repoSearch.searchAndBuildContext(
    "how does the task queue work",
    { projectId: "superroo2", topK: 5 }
)
// context.contextText contains XML-formatted relevant code
```

### With VS Code Extension

The VS Code extension can query the indexer worker health endpoint:

```typescript
const health = await fetch("http://localhost:3418/health")
// { ok: true, indexedFiles: 1243, indexedChunks: 8921, ... }
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Indexing speed | ~50 files/second (with Ollama) |
| Search latency | <100ms (Qdrant HNSW) |
| Memory (Qdrant) | ~100MB for 100K chunks |
| Memory (Ollama) | ~500MB (nomic-embed-text) |
| Disk (Qdrant) | ~1GB per 100K chunks |
| Context savings | 80-95% fewer tokens vs full repo scan |

## Future Improvements

1. **Multi-repo support**: Index multiple repositories with projectId isolation
2. **Cross-reference index**: Track symbol references across files
3. **Git-aware incremental**: Only re-index files changed since last commit
4. **Priority indexing**: Index critical files first (config, core logic)
5. **Cache warming**: Pre-compute embeddings for common queries
6. **Hybrid search**: Combine vector search with keyword (BM25) for better recall
7. **Re-ranking**: Cross-encoder re-ranking for improved result quality
8. **Dashboard integration**: Show indexing status in SuperRoo Cloud Dashboard
