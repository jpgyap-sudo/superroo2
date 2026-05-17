# model-decisions.md

Initialized by SuperRoo workflow check.

---

## Legacy Model/API Decisions Migrated — 2026-05-17

### Legacy Lesson: Model Router Task-Based Routing

Date: 2026-05-08
Source: Roo Code legacy session
Model/API used: kimi-k2.5
Confidence: high
Related files: src/super-roo/settings/services/modelRouterService.ts

#### Task Summary

Implemented model routing service that maps task types to optimal provider/model pairs based on cost, quality, and speed tradeoffs.

#### Files Changed

- `src/super-roo/settings/services/modelRouterService.ts`

#### Decision Made

Created routing table with primary and fallback providers:

| Task Type    | Primary Provider | Primary Model            | Fallback 1 | Fallback 2               |
| ------------ | ---------------- | ------------------------ | ---------- | ------------------------ |
| coding       | anthropic        | claude-sonnet-4-20250514 | deepseek   | deepseek-chat            |
| debugging    | deepseek         | deepseek-chat            | anthropic  | claude-sonnet-4-20250514 |
| crawling     | groq             | llama-3.3-70b-versatile  | deepseek   | deepseek-chat            |
| planning     | anthropic        | claude-sonnet-4-20250514 | openai     | gpt-4o                   |
| architecture | openai           | gpt-4o                   | anthropic  | claude-sonnet-4-20250514 |
| fast_fix     | groq             | llama-3.3-70b-versatile  | deepseek   | deepseek-chat            |

#### Rationale

- Claude excels at coding and planning tasks
- DeepSeek offers good quality at lower cost
- Groq provides fastest inference for latency-sensitive tasks
- OpenAI GPT-4o provides balanced performance for architecture

#### Test Result

Routing working in production. Cost savings observed.

#### Lesson Learned

Different AI providers have different strengths. A routing layer improves both cost-efficiency and output quality by matching tasks to optimal providers.

#### Reusable Rule

**Always route by task type, not just user preference. Implement fallback chains for reliability.**

#### Tags

model-router, ai-providers, cost-optimization, routing, multi-model

---

### Legacy Lesson: Codex Workflow Model Routing

Date: 2026-05-01 (from AGENTS.md)
Source: Roo Code legacy session
Model/API used: codex/deepseek/ollama
Confidence: high
Related files: docs/super-roo/agent-workflow/codex-deepseek-ollama.md

#### Task Summary

Established model-routing workflow for SuperRoo development.

#### Decision Made

- **Codex** = planner, reviewer, tester, final verifier
- **DeepSeek** = primary low-cost coder / refactor worker
- **Ollama** = local memory, lessons, summaries, feature knowledge, retrieval helper
- **Central Brain** = persistent memory database / pgvector / lesson store

#### Rationale

- Codex provides high-quality reasoning and verification
- DeepSeek offers cost-effective coding at good quality
- Ollama provides privacy for sensitive data and local operations
- Central Brain enables persistence across sessions

#### Workflow Sequence

1. Read repo rules and current context
2. Check prior lessons and memory for related work
3. Write the implementation plan
4. Delegate the main coding work to DeepSeek when available
5. Review the result, run tests, and record lessons

#### Lesson Learned

Multi-model workflows leverage each model's strengths. Codex plans/reviews, DeepSeek implements, Ollama handles memory.

#### Reusable Rule

**Use model specialization: Codex for planning/review, DeepSeek for coding, Ollama for memory/context.**

#### Tags

codex, deepseek, ollama, workflow, multi-model, central-brain

---

### Legacy Lesson: Gemini Model Configuration

Date: 2026-02-17 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: gemini
Confidence: medium
Related files: src/api/providers/gemini.ts

#### Task Summary

Updated Gemini provider with proper defaults for temperature and cost reporting.

#### Decision Made

- Improved default temperature settings for Gemini models
- Better cost reporting integration
- Proper handling of thinkingLevel against model capabilities

#### Rationale

Gemini models have different optimal settings than other providers. Default configuration should match provider best practices.

#### Lesson Learned

Each provider has unique configuration requirements. Default settings should be provider-specific, not generic.

#### Reusable Rule

**Provider configurations MUST be validated against model capabilities. Never use one-size-fits-all defaults.**

#### Tags

gemini, provider-config, model-settings

---

### Legacy Lesson: OpenAI Codex Provider Implementation

Date: 2026-05-01 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: openai-codex
Confidence: high
Related files: src/api/providers/openai-codex.ts

#### Task Summary

Added GPT-5.5 support via OpenAI Codex provider.

#### Decision Made

- Implemented dedicated OpenAI Codex provider for latest GPT models
- Added GPT-5.2, GPT-5.3, GPT-5.4, GPT-5.5 model support
- Stream parsing for done-only and content_part events
- Duplicate-text guards when deltas are already streamed

#### Rationale

Codex models have different streaming behavior and event formats than standard OpenAI models. Dedicated provider allows proper handling.

#### Test Result

Models working correctly with streaming.

#### Lesson Learned

New model families often need dedicated provider implementations. Streaming behavior varies significantly between model types.

#### Reusable Rule

**Create dedicated providers for model families with unique streaming or API behaviors. Don't overload existing providers.**

#### Tags

openai, codex, gpt-5, streaming, provider-implementation

---

### Legacy Lesson: OpenRouter Provider Error Handling

Date: 2026-01-27 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: openrouter
Confidence: high
Related files: src/api/providers/openrouter.ts

#### Task Summary

Improved error handling for OpenRouter provider rate limits and streaming errors.

#### Decision Made

- Handle rate limit errors specifically
- Parse error metadata from OpenRouter responses
- Proper error categorization for telemetry

#### Rationale

OpenRouter has unique error formats and rate limiting behavior. Proper handling improves user experience and debugging.

#### Lesson Learned

Provider-specific error handling is necessary. Generic error handling misses important context.

#### Reusable Rule

**Implement provider-specific error parsing for each provider. Include rate limit detection and retry guidance.**

#### Tags

openrouter, error-handling, rate-limiting, provider-specific

---

### Legacy Lesson: Ollama Local Model Integration

Date: 2026-05-10
Source: Roo Code legacy session
Model/API used: ollama
Confidence: high
Related files: src/api/providers/fetchers/ollama.ts, cloud/sql/ollama-rag-schema.sql

#### Task Summary

Integrated Ollama for local model execution and embeddings.

#### Decision Made

- Ollama for cheap local inference (qwen2.5:3b for quick tasks)
- Ollama for embeddings (nomic-embed)
- Fallback provider when cloud APIs unavailable
- RAG storage with pgvector for embeddings

#### Rationale

Local models provide:

- Privacy for sensitive code
- Zero API costs for suitable tasks
- Offline capability
- Fast embedding generation

#### Test Result

Ollama integration working for embeddings and small tasks.

#### Lesson Learned

Local models are valuable for embeddings and simple tasks. Don't rely solely on cloud APIs.

#### Reusable Rule

**Use Ollama for: embeddings, simple completions, privacy-sensitive tasks, offline fallback.**

#### Tags

ollama, local-models, embeddings, privacy, cost-optimization

---

### Legacy Lesson: Claude Hybrid Reasoning Model Support

Date: 2026-02-19 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: claude
Confidence: high
Related files: src/api/providers/anthropic.ts, src/api/providers/anthropic-vertex.ts

#### Task Summary

Added support for Claude "thinking" models with hybrid reasoning.

#### Decision Made

- Detect `:thinking` suffix in model IDs
- Enable reasoning for hybrid models automatically
- Handle thought blocks in responses

#### Rationale

Claude hybrid models require explicit reasoning enablement. The `:thinking` suffix indicates this requirement.

#### Lesson Learned

Model capabilities change over time. Provider implementations must adapt to new model behaviors.

#### Reusable Rule

**Detect model capabilities from model IDs. Enable features automatically based on model identifiers.**

#### Tags

claude, anthropic, reasoning, thinking-models, provider-implementation

---

### Legacy Lesson: Bedrock Cross-Region Inference

Date: 2026-02-20 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: bedrock
Confidence: high
Related files: src/api/providers/bedrock.ts

#### Task Summary

Implemented cross-region inference support for AWS Bedrock.

#### Decision Made

- Parse region prefixes from model IDs
- Support both cross-region and global inference profiles
- Handle ARNs with inference prefixes

#### Rationale

AWS Bedrock offers cross-region inference for better availability. Model IDs include region prefixes that must be handled.

#### Lesson Learned

Cloud providers have complex model naming conventions. Provider code must handle various ID formats.

#### Reusable Rule

**Normalize model IDs by stripping region prefixes for lookup, but preserve them for API calls.**

#### Tags

bedrock, aws, cross-region, inference, provider-implementation

---

### Legacy Lesson: Model Warmup for CLI Performance

Date: 2026-02-18 (from CHANGELOG)
Source: Roo Code legacy session
Model/API used: various
Confidence: medium
Related files: apps/cli/src/commands/cli/run.ts

#### Task Summary

Implemented model warmup on CLI startup to reduce cold start latency.

#### Decision Made

- Warm up Roo model on CLI startup
- Handle warmup failures gracefully (don't fail startup)
- Log warmup status

#### Rationale

Cold starts affect user experience. Proactive warmup reduces latency for first user request.

#### Test Result

First request latency reduced significantly.

#### Lesson Learned

Model loading has overhead. Warmup improves perceived performance for interactive use.

#### Reusable Rule

**Warm up AI models on service startup. Handle warmup failures gracefully.**

#### Tags

cli, performance, model-loading, user-experience

---

### Legacy Lesson: Embedding Model Dimension Handling

Date: 2026-05-08 (from CHANGELOG history)
Source: Roo Code legacy session
Model/API used: various embedders
Confidence: high
Related files: src/services/code-index/embedders/\*.ts

#### Task Summary

Fixed vector dimension mismatch errors when switching embedding models.

#### Decision Made

- Validate model dimensions before use
- Store dimension in configuration
- Rebuild indexes when dimension changes

#### Rationale

Different embedding models produce vectors of different dimensions. Mixing dimensions causes errors in vector databases.

#### Test Result

Dimension changes now handled correctly.

#### Lesson Learned

Embedding models have different output dimensions. Vector stores require consistent dimensions.

#### Reusable Rule

**Validate embedding dimensions before use. Rebuild indexes when switching models with different dimensions.**

#### Tags

embeddings, vector-store, dimensions, qdrant, pgvector

---
