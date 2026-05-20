# HermesClaw Guide

> **Purpose**: Reference for the memory & context agent — its 10 operations, pgvector-backed RAG memory, API endpoints, and integration patterns.
> **Source**: [`cloud/orchestrator/modules/HermesClaw.js`](../../cloud/orchestrator/modules/HermesClaw.js)
> **API Routes**: [`cloud/api/api.js`](../../cloud/api/api.js) (lines ~8309–8428, ~8625–8876)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      HermesClaw                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   execute(request)                    │   │
│  │   Routes to operation handler based on action field   │   │
│  └──────────┬───────────────────────────────────────────┘   │
│             │                                                │
│     ┌───────┼──────────┬──────────┬──────────┐              │
│     ▼       ▼          ▼          ▼          ▼              │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐          │
│ │Ollama│ │OpenAI│ │Deep‑ │ │Kimi  │ │BugKnow‑  │          │
│ │(def) │ │(fb1) │ │Seek  │ │(fb3) │ │ledgeStore│          │
│ │      │ │      │ │(fb2) │ │      │ │(pgvector)│          │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘          │
│              │              │              │                │
│              ▼              ▼              ▼                │
│         ┌─────────────────────────────────────┐             │
│         │       Disk Persistence (JSON)        │             │
│         │  memory/hermes-memory.json           │             │
│         └─────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐    ┌──────────────────────┐
│  LearningGateway    │    │  FeatureAnswerer     │
│  (lesson curation)  │◄──►│  (context retrieval) │
└─────────────────────┘    └──────────────────────┘
```

The [`HermesClaw`](../../cloud/orchestrator/modules/HermesClaw.js:169) is the memory and context agent for SuperRoo. It provides 10 operations for skill creation, memory management, context recall, pattern analysis, and lesson extraction. It uses Ollama as the primary LLM with OpenAI, DeepSeek, and Kimi as fallbacks, and stores knowledge in a pgvector-backed [`BugKnowledgeStore`](../../cloud/orchestrator/modules/BugKnowledgeStore.js) for RAG.

---

## 10 Operations

| # | Operation | Method | Purpose |
|---|-----------|--------|---------|
| 1 | `create_skill` | [`createSkill()`](../../cloud/orchestrator/modules/HermesClaw.js:572) | Generate a new skill from patterns |
| 2 | `memory_summary` | [`generateMemorySummary()`](../../cloud/orchestrator/modules/HermesClaw.js:591) | Summarize stored memories |
| 3 | `context_recall` | [`recallContext()`](../../cloud/orchestrator/modules/HermesClaw.js:608) | Retrieve relevant context |
| 4 | `improvement_suggestion` | [`suggestImprovements()`](../../cloud/orchestrator/modules/HermesClaw.js:705) | Suggest improvements from patterns |
| 5 | `pattern_analysis` | [`analyzePatterns()`](../../cloud/orchestrator/modules/HermesClaw.js:720) | Analyze code/debug patterns |
| 6 | `knowledge_query` | [`queryKnowledge()`](../../cloud/orchestrator/modules/HermesClaw.js:734) | Query stored knowledge |
| 7 | `best_practices` | (via `execute`) | Extract best practices |
| 8 | `lesson_extraction` | [`extractLessons()`](../../cloud/orchestrator/modules/HermesClaw.js:752) | Extract lessons from conversations |
| 9 | `store_bug_fix` | [`storeBugFix()`](../../cloud/orchestrator/modules/HermesClaw.js:641) | Store a bug fix in knowledge base |
| 10 | `store_lesson` | [`storeLesson()`](../../cloud/orchestrator/modules/HermesClaw.js:654) | Store a lesson in knowledge base |

### Operation Details

**create_skill**: Generates a complete skill (SKILL.md) from a description and optional patterns. Uses the `create_skill` system prompt with structured JSON output.

**memory_summary**: Summarizes all stored memories, grouped by operation type, with counts and recent entries.

**context_recall**: Searches memory and the BugKnowledgeStore (pgvector RAG) for context matching a query. Returns ranked results with relevance scores.

**improvement_suggestion**: Analyzes stored patterns and suggests improvements with priority levels and expected impact.

**pattern_analysis**: Analyzes code patterns, debug patterns, or both. Returns categorized patterns with frequency and severity.

**knowledge_query**: Queries the BugKnowledgeStore for knowledge matching a query. Returns structured results with source attribution.

**best_practices**: Extracts best practices from stored lessons and patterns. Returns categorized practices with confidence scores.

**lesson_extraction**: Extracts lessons from conversation phases. Each phase produces a structured lesson with title, summary, and tags.

**store_bug_fix**: Stores a bug fix in the BugKnowledgeStore with details, root cause, and fix description.

**store_lesson**: Stores a lesson in the BugKnowledgeStore with content, tags, and source attribution.

---

## LLM Routing

The [`_callOpenAI()`](../../cloud/orchestrator/modules/HermesClaw.js:805) method implements a fallback chain:

```
Ollama (default)
  → OpenAI (fallback 1)
    → DeepSeek (fallback 2)
      → Kimi (fallback 3)
```

Each operation can specify a preferred model via [`operationModels`](../../cloud/orchestrator/modules/HermesClaw.js:97):

```javascript
operationModels: {
  create_skill: "ollama",
  memory_summary: "ollama",
  context_recall: "ollama",
  improvement_suggestion: "ollama",
  pattern_analysis: "ollama",
  knowledge_query: "ollama",
  best_practices: "ollama",
  lesson_extraction: "ollama",
  store_bug_fix: "ollama",
  store_lesson: "ollama"
}
```

When Ollama fails, the system records an `ollama_failed` growth event and tries the next provider.

---

## pgvector RAG Memory

The [`BugKnowledgeStore`](../../cloud/orchestrator/modules/BugKnowledgeStore.js) provides vector-based retrieval:

- **Embeddings**: Generated via Ollama (`nomic-embed-text` model)
- **Storage**: PostgreSQL with pgvector extension
- **Retrieval**: Cosine similarity search with configurable limit
- **Fallback**: In-memory store when pgvector is unavailable

The [`buildRagContext()`](../../cloud/orchestrator/modules/HermesClaw.js:671) method combines memory search with pgvector RAG:

```javascript
async buildRagContext(query, options = {}) {
  const memoryResults = this._searchMemory(query, options.limit || 5);
  const vectorResults = await this.bugKnowledgeStore?.search(query, options.limit || 5) || [];
  return this._mergeResults(memoryResults, vectorResults);
}
```

---

## API Reference

All endpoints are served from [`cloud/api/api.js`](../../cloud/api/api.js).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/orchestrator/hermes/query` | Query HermesClaw |
| `POST` | `/api/orchestrator/hermes/query` | Query HermesClaw with body |
| `POST` | `/api/orchestrator/hermes/lesson` | Store a lesson |
| `GET` | `/api/orchestrator/hermes/stats` | Get HermesClaw stats |
| `POST` | `/api/orchestrator/hermes/stats` | Get HermesClaw stats |
| `POST` | `/api/orchestrator/hermes/recall` | Recall context |
| `POST` | `/api/orchestrator/hermes/learn` | Learn from input |
| `POST` | `/api/orchestrator/hermes/create-skill` | Create a skill |
| `POST` | `/api/orchestrator/hermes/analyze-patterns` | Analyze patterns |
| `POST` | `/api/orchestrator/hermes/list-skills` | List available skills |
| `POST` | `/api/orchestrator/hermes/list-resources` | List available resources |
| `POST` | `/api/orchestrator/hermes/extract-lessons` | Extract lessons |

### POST /api/orchestrator/hermes/query

**Request body**:
```json
{
  "action": "context_recall",
  "data": {
    "query": "How does the debug team handle rollbacks?",
    "limit": 5
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "output": "The SuperDebugLoop uses RollbackManager...",
    "sources": ["memory", "bug_knowledge_store"]
  }
}
```

### POST /api/orchestrator/hermes/lesson

**Request body**:
```json
{
  "content": "Always validate Docker socket permissions before mounting",
  "tags": ["docker", "security", "deployment"],
  "source": "commissioning-loop"
}
```

**Response**:
```json
{
  "success": true,
  "id": "lesson-1712345678"
}
```

### POST /api/orchestrator/hermes/recall

**Request body**:
```json
{
  "query": "database connection pool settings",
  "limit": 10
}
```

**Response**:
```json
{
  "success": true,
  "results": [
    {
      "content": "Set max pool to 20 connections...",
      "relevance": 0.92,
      "source": "bug_knowledge_store",
      "tags": ["database", "performance"]
    }
  ]
}
```

### POST /api/orchestrator/hermes/create-skill

**Request body**:
```json
{
  "description": "Docker deployment helper for Node.js apps",
  "patterns": ["docker build -t", "docker push", "docker run"]
}
```

**Response**:
```json
{
  "success": true,
  "skill": {
    "name": "docker-deploy-helper",
    "path": ".roo/skills/docker-deploy-helper/SKILL.md"
  }
}
```

---

## Dashboard

HermesClaw is visualized in the SuperRoo Cloud Dashboard under the **Brain** tab:

- **Memory Stats**: Total stored memories by operation type
- **RAG Stats**: Vector store size, query count, avg relevance
- **Ollama Health**: Model readiness, response times, failure rate
- **Growth Tracking**: Ollama readiness score over time with recommendations

---

## Configuration

The [`HermesClaw`](../../cloud/orchestrator/modules/HermesClaw.js:190) is configured via [`DEFAULT_CONFIG`](../../cloud/orchestrator/modules/HermesClaw.js:80):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ollamaBaseUrl` | `"http://127.0.0.1:11434"` | Ollama server URL |
| `ollamaModel` | `"qwen2.5-coder:7b"` | Default Ollama model |
| `apiKey` | `process.env.OPENAI_API_KEY` | OpenAI fallback key |
| `model` | `"gpt-4o-mini"` | OpenAI fallback model |
| `fallbackApiKey` | `process.env.DEEPSEEK_API_KEY` | DeepSeek fallback key |
| `fallbackModel` | `"deepseek-chat"` | DeepSeek fallback model |
| `operationModels` | all `"ollama"` | Per-operation model routing |

---

## Integration

The [`HermesClaw`](../../cloud/orchestrator/modules/HermesClaw.js) integrates with:

| Component | Integration Point |
|-----------|------------------|
| [`LearningGateway`](../../cloud/orchestrator/modules/LearningGateway.js) | Lesson curation and scoring |
| [`FeatureAnswerer`](../../cloud/orchestrator/modules/FeatureAnswerer.js) | Context retrieval for feature questions |
| [`BugKnowledgeStore`](../../cloud/orchestrator/modules/BugKnowledgeStore.js) | pgvector-backed RAG storage |
| [`Ollama`](../../cloud/orchestrator/modules/Ollama.js) | Primary LLM for all operations |
| [`EventLog`](../../cloud/orchestrator/modules/EventLog.js) | Operation logging |

---

## Complete Workflows

### Store and Retrieve a Lesson

```javascript
// Store a lesson
await fetch("http://localhost:3419/api/orchestrator/hermes/lesson", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    content: "Always validate user input on both client and server side",
    tags: ["security", "validation", "best-practice"],
    source: "code-review"
  })
});

// Recall context for a new task
const recallRes = await fetch("http://localhost:3419/api/orchestrator/hermes/recall", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: "input validation patterns",
    limit: 5
  })
});

const { results } = await recallRes.json();
console.log(`Found ${results.length} relevant memories`);
```

### Create a Skill from Patterns

```javascript
const skillRes = await fetch("http://localhost:3419/api/orchestrator/hermes/create-skill", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "Helper for debugging WebSocket connection issues",
    patterns: [
      "WebSocket close with code 1006",
      "WebSocket handshake timeout",
      "Reconnection backoff strategy"
    ]
  })
});

const { skill } = await skillRes.json();
console.log(`Skill created: ${skill.name} at ${skill.path}`);
```

### Analyze Patterns Across Operations

```javascript
const analysisRes = await fetch("http://localhost:3419/api/orchestrator/hermes/analyze-patterns", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "debug",
    timeframe: "7d"
  })
});

const { patterns } = await analysisRes.json();
patterns.forEach(p => {
  console.log(`${p.pattern}: ${p.frequency}x (severity: ${p.severity})`);
});
```

---

## See Also

- [`ML_ENGINE_GUIDE.md`](ML_ENGINE_GUIDE.md) — ML Engine for pattern learning
- [`DEBUG_TEAM_GUIDE.md`](DEBUG_TEAM_GUIDE.md) — Debug Team that uses HermesClaw context
- [`AUTONOMOUS_LOOP_GUIDE.md`](AUTONOMOUS_LOOP_GUIDE.md) — Autonomous loop that feeds lessons
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — Self-healing incident handling
