---
name: deepseek-api
description: DeepSeek API — Integrate, configure, and troubleshoot DeepSeek API (V3.2, V4 Flash, V4 Pro, R1) in SuperRoo projects. Covers provider setup, model routing, workflow enforcement, R1 format conversion, thinking mode, prompt caching, and pricing.
---

# DeepSeek API Skill

## When To Use

Use this skill when:

- Working with DeepSeek API integration in any project
- Debugging DeepSeek API calls (wrong model, timeout, wrong parameters)
- Configuring DeepSeek as a provider in the SuperRoo extension
- Understanding DeepSeek model capabilities and pricing
- Implementing DeepSeek for text extraction, coding, or reasoning tasks

---

## API Reference

### Base URL

```
https://api.deepseek.com/v1/chat/completions
```

### Authentication

```
Authorization: Bearer <DEEPSEEK_API_KEY>
```

### Supported Models

| Model ID                 | Actual Model                  | Context | Max Output | Use Case                                                                                                                        |
| ------------------------ | ----------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `deepseek-chat`          | DeepSeek-V3.2 (Non-thinking)  | 128K    | 8K         | General chat, coding, extraction                                                                                                |
| `deepseek-reasoner`      | DeepSeek-V3.2 (Thinking mode) | 128K    | 8K         | Complex reasoning, math, code                                                                                                   |
| `deepseek-chat-v4-flash` | DeepSeek-V4-Flash             | 64K     | 8K         | **Cheaper/faster worker**: simple coding, summaries, extraction, routing, compliance checks, Telegram replies, bulk agent tasks |
| `deepseek-chat-v4-pro`   | DeepSeek-V4-Pro               | 128K    | 8K         | **Stronger/slower expert**: hard debugging, architecture, complex coding, long reasoning, final review, important decisions     |

### Pricing (per million tokens, Dec 2025)

| Model                    | Input (cache miss) | Output    | Cache Read (hit) |
| ------------------------ | ------------------ | --------- | ---------------- |
| `deepseek-chat`          | $0.28              | $0.42     | $0.028           |
| `deepseek-reasoner`      | $0.28              | $0.42     | $0.028           |
| `deepseek-chat-v4-flash` | **$0.15**          | **$0.25** | **$0.015**       |
| `deepseek-chat-v4-pro`   | **$0.55**          | **$0.85** | **$0.055**       |

---

## SuperRoo Extension Integration

### Provider Configuration

Defined in [`src/super-roo/settings/config/providers.ts`](../../src/super-roo/settings/config/providers.ts:76):

- Provider ID: `deepseek`
- API Base URL: `https://api.deepseek.com/v1`
- Capabilities: `chat`, `reasoning`

### Handler Implementation

The [`DeepSeekHandler`](../../src/api/providers/deepseek.ts:25) extends `OpenAiHandler` and:

- Uses OpenAI-compatible API format
- Sets `openAiBaseUrl` to `https://api.deepseek.com` (or custom `deepSeekBaseUrl`)
- Default model: `deepseek-chat`
- Default temperature: `0.3`

### Key Implementation Details

1. **R1 Format Conversion** ([`convertToR1Format`](../../src/api/transform/r1-format.ts)):

    - DeepSeek does NOT support successive messages with the same role
    - All messages are converted to merge consecutive same-role messages
    - For `deepseek-reasoner`, `mergeToolResultText` is enabled to preserve `reasoning_content` during tool call sequences

2. **Thinking Mode** (for `deepseek-reasoner`):

    ```typescript
    thinking: {
    	type: "enabled"
    }
    ```

    - Enables Chain of Thought reasoning
    - Required for interleaved thinking with tool calls
    - See: https://api-docs.deepseek.com/guides/thinking_mode

3. **Prompt Cache**:

    - Automatically enabled
    - Cache hits are 10x cheaper ($0.028 vs $0.28 per million tokens)
    - No special configuration needed

4. **Streaming**:

    - `stream: true` with `stream_options: { include_usage: true }`
    - Usage statistics included in stream response

5. **Azure AI Inference**:
    - Supports DeepSeek via Azure AI Inference endpoint
    - Detected via `_isAzureAiInference()` check on base URL
    - Uses `OPENAI_AZURE_AI_INFERENCE_PATH` for request path

### Model Info

Defined in [`packages/types/src/providers/deepseek.ts`](../../packages/types/src/providers/deepseek.ts:11):

```typescript
export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.28,
		outputPrice: 0.42,
		cacheWritesPrice: 0.28,
		cacheReadsPrice: 0.028,
	},
	"deepseek-reasoner": {
		// Same as above + preserveReasoning: true
	},
}
```

---

## Agent Routing

DeepSeek is the **primary coding worker** in the SuperRoo workflow (per [`AGENTS.md`](../../AGENTS.md)).

**V4 Flash** (`deepseek-chat-v4-flash`) is used for cheap/fast tasks:

- Simple coding, summaries, extraction, routing
- Compliance checks, Telegram replies, bulk agent tasks

**V4 Pro** (`deepseek-chat-v4-pro`) is used for complex/important tasks:

- Hard debugging, architecture, complex coding
- Long reasoning, final review, important decisions

| Agent Role     | Primary Model                       | Fallback         |
| -------------- | ----------------------------------- | ---------------- |
| Planner        | V4 Pro (`deepseek-chat-v4-pro`)     | OpenAI GPT-4o    |
| Coder          | V4 Flash (`deepseek-chat-v4-flash`) | Anthropic Claude |
| Debugger       | V4 Pro (`deepseek-chat-v4-pro`)     | Anthropic Claude |
| Crawler        | V4 Flash (`deepseek-chat-v4-flash`) | Groq Llama       |
| Tester         | V4 Flash (`deepseek-chat-v4-flash`) | Groq Llama       |
| Deploy Checker | V4 Pro (`deepseek-chat-v4-pro`)     | Groq Llama       |

Defined in:

- [`src/super-roo/settings/services/modelRouterService.ts`](../../src/super-roo/settings/services/modelRouterService.ts:22)
- [`src/super-roo/settings/config/agentRouting.ts`](../../src/super-roo/settings/config/agentRouting.ts:17)
- [`src/super-roo/settings/services/modelRouter.ts`](../../src/super-roo/settings/services/modelRouter.ts:29)
- [`cloud/api/api.js`](../../cloud/api/api.js:1304)

### Workflow Enforcement

The [`WorkflowEnforcer`](../../src/super-roo/product-memory/WorkflowEnforcer.ts:42) requires DeepSeek for coding tasks:

- `requireDeepseekForCoding: true` (default)
- Default model: `deepseek-chat-v4-flash`
- Falls back to `DEEPSEEK_API_KEY_FALLBACK` if primary key fails
- Logs delegation success/failure via `ModelUsageTracker`

---

## Cloud API Integration

### DeepSeek in Cloud API

The cloud API at [`cloud/api/api.js`](../../cloud/api/api.js:1246) configures DeepSeek as a provider:

```javascript
{
    id: "deepseek",
    name: "DeepSeek",
    models: [{ id: "deepseek-chat", name: "DeepSeek V3" }],
}
```

### DeepSeek for PDF Extraction (productgenerator)

In the productgenerator project, DeepSeek is used for **PDF catalog text extraction**:

- Endpoint: `POST https://api.deepseek.com/v1/chat/completions`
- Model: `deepseek-chat`
- Temperature: 0.1 (deterministic extraction)
- `response_format: { type: 'json_object' }` for structured output
- Batch processing: splits large PDFs into 4000-char chunks, 3 concurrent batches
- Critical: always set `max_tokens: 8192` (not 4096 default) to prevent truncation

---

## Common Issues & Fixes

### 1. "Successive messages with the same role"

**Error**: DeepSeek rejects requests with consecutive same-role messages.
**Fix**: Use `convertToR1Format()` to merge consecutive messages.

### 2. Reasoning content lost during tool calls

**Issue**: `reasoning_content` is dropped when tool results create new user messages.
**Fix**: Enable `mergeToolResultText: true` for `deepseek-reasoner` models.

### 3. Truncated JSON output

**Issue**: Large responses get cut off at 4096 tokens.
**Fix**: Always set `max_tokens: 8192` for extraction tasks.

### 4. Timeout on complex tasks

**Issue**: DeepSeek can be slow on complex reasoning tasks.
**Fix**: Ensure client timeout is adequate (60s+ for complex tasks).

---

## Environment Variables

```env
DEEPSEEK_API_KEY=sk-...                    # Primary API key
DEEPSEEK_API_KEY_FALLBACK=sk-...           # Fallback API key
DEEPSEEK_BASE_URL=https://api.deepseek.com # Optional custom base URL
```

---

## Testing

Test script: [`scripts/test-deepseek-api.mjs`](../../scripts/test-deepseek-api.mjs)

```bash
node scripts/test-deepseek-api.mjs [--key <key>] [--model <model>] [--verbose]
```

Unit tests: [`src/api/providers/__tests__/deepseek.spec.ts`](../../src/api/providers/__tests__/deepseek.spec.ts)

```bash
cd src && npx vitest run api/providers/__tests__/deepseek.spec.ts
```
