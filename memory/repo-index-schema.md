# SuperRoo Repo Index Schema

## Overview

The Repo Index stores code chunks as vector embeddings in Qdrant for semantic codebase search. Each chunk represents a logical unit of code (function, class, component, or line-bounded segment) with metadata for filtering and retrieval.

## Qdrant Collection

| Property | Value |
|----------|-------|
| **Collection Name** | `superroo_code_chunks` |
| **Vector Size** | 768 (nomic-embed-text) |
| **Distance Metric** | Cosine |
| **HNSW Index** | m=16, ef_construct=200 |

## Payload Schema

### Fields

| Field | Type | Indexed | Description |
|-------|------|---------|-------------|
| `projectId` | `keyword` | ✅ | Project identifier (e.g., `superroo2`) |
| `filePath` | `keyword` | ✅ | Relative path from repo root (e.g., `src/core/index.ts`) |
| `language` | `keyword` | ✅ | Detected language (e.g., `typescript`, `python`) |
| `symbolName` | `text` | ❌ | Extracted function/class name |
| `symbolType` | `keyword` | ✅ | Symbol type (`function`, `class`, `interface`, `enum`, etc.) |
| `content` | `text` | ❌ | The actual code chunk content |
| `summary` | `text` | ❌ | Optional JSDoc/docstring summary |
| `startLine` | `integer` | ❌ | 1-based start line in source file |
| `endLine` | `integer` | ❌ | 1-based end line in source file |
| `chunkIndex` | `integer` | ❌ | Index of this chunk within the file (0-based) |
| `totalChunks` | `integer` | ❌ | Total number of chunks for this file |
| `gitSha` | `text` | ❌ | Git commit SHA at time of indexing |
| `lastModified` | `text` | ❌ | ISO 8601 timestamp of last file modification |
| `metadata` | `object` | ❌ | Arbitrary key-value metadata |

### Point ID

Points are identified by SHA-256 hash of `projectId:filePath:startLine`, truncated to 32 hex characters.

```
pointId = sha256(projectId + ":" + filePath + ":" + startLine).slice(0, 32)
```

## Supported Languages

| Extension | Language | Boundary Detection |
|-----------|----------|-------------------|
| `.ts` | typescript | function, class, interface, type, enum, namespace, module |
| `.tsx` | tsx | function, class, interface, React.FC |
| `.js` | javascript | function, class |
| `.jsx` | jsx | function, class |
| `.py` | python | def, class, async def |
| `.go` | go | func, type struct, type interface |
| `.rs` | rust | fn, struct, enum, impl, trait, mod |
| `.java` | java | class, interface, enum, record |
| `.cpp`, `.hpp` | cpp | (line-count fallback) |
| `.c`, `.h` | c | (line-count fallback) |
| `.php` | php | (line-count fallback) |
| `.rb` | ruby | (line-count fallback) |
| `.swift` | swift | (line-count fallback) |
| `.kt` | kotlin | (line-count fallback) |
| `.sh`, `.bash` | shell | (line-count fallback) |
| `.yaml`, `.yml` | yaml | (line-count fallback) |
| `.toml` | toml | (line-count fallback) |
| `.json` | json | (line-count fallback) |
| `.md` | markdown | (line-count fallback) |
| `.sql` | sql | (line-count fallback) |
| `.css`, `.scss` | css/scss | (line-count fallback) |
| `.html` | html | (line-count fallback) |
| `.vue` | typescript | function, class, interface |
| `.svelte` | typescript | function, class, interface |

## Chunking Strategy

### Semantic Boundary Splitting (preferred)

For structured languages, chunks are split at function/class/component boundaries:

1. Scan file for boundary patterns (regex-based)
2. Split at each boundary, keeping chunks under 80 lines
3. Merge adjacent small chunks (under 5 lines) with the previous chunk
4. If a boundary-to-boundary segment exceeds 80 lines, split at the boundary anyway

### Line-Count Fallback

For unstructured files or files without detected boundaries:

1. Split into chunks of 80 lines maximum
2. Overlap of 3 lines between chunks for context continuity
3. Minimum chunk size of 5 lines (skip trailing fragments)

## Search Query Flow

```
User Query
    │
    ▼
Ollama Embedding API ──→ nomic-embed-text ──→ 768-dim vector
    │
    ▼
Qdrant Search ──→ Cosine similarity ──→ Top-K results
    │
    ▼
Filter by: projectId, language, symbolType, filePath (optional)
    │
    ▼
Build XML context ──→ Inject into LLM prompt
```

## RAG Context Format

When search results are injected into an LLM prompt, they are formatted as:

```xml
<repo_context>
<file path="src/core/index.ts" language="typescript" score="0.92">
<symbol name="parseTask" type="function" summary="Parses task input from raw format">
<code>
export function parseTaskSubmission(input: unknown, source = SuperRooTaskSource.DAEMON): TaskInputRaw {
  // ...
}
</code>
</file>
<!-- more results... -->
</repo_context>
```

## Performance Considerations

- **Batch size**: 50 points per upsert batch
- **Embedding truncation**: Text is truncated to 8000 characters before embedding
- **Skip patterns**: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `coverage`, `__pycache__`
- **Binary files**: Images, fonts, archives, executables, and `.d.ts` are skipped
- **HNSW index**: Balanced for accuracy (ef_construct=200) without excessive memory
- **Vector size**: 768 dimensions balances accuracy with storage cost
