# DeepSeek API Resource

## Overview

DeepSeek API is the primary coding and reasoning provider for the SuperRoo ecosystem. It provides OpenAI-compatible chat completions at very low cost with 128K context window and prompt caching.

## API Details

| Property | Value                                          |
| -------- | ---------------------------------------------- |
| Base URL | `https://api.deepseek.com/v1/chat/completions` |
| SDK      | `@ai-sdk/deepseek` v2.0.18                     |
| Auth     | Bearer token (`DEEPSEEK_API_KEY`)              |
| Format   | OpenAI-compatible                              |

## Models

| Model ID                 | Actual Model      | Context | Max Output | Type           | Use Case                                                                                             |
| ------------------------ | ----------------- | ------- | ---------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `deepseek-chat`          | DeepSeek-V3.2     | 128K    | 8K         | Non-thinking   | General chat, coding, extraction                                                                     |
| `deepseek-reasoner`      | DeepSeek-V3.2     | 128K    | 8K         | Thinking (CoT) | Complex reasoning, math, code                                                                        |
| `deepseek-chat-v4-flash` | DeepSeek-V4-Flash | 64K     | 8K         | Non-thinking   | **Cheaper/faster**: simple coding, summaries, extraction, routing, compliance, Telegram, bulk tasks  |
| `deepseek-chat-v4-pro`   | DeepSeek-V4-Pro   | 128K    | 8K         | Thinking       | **Stronger/slower**: hard debugging, architecture, complex coding, long reasoning, review, decisions |

## Pricing (per million tokens)

| Cost Type          | deepseek-chat | deepseek-reasoner | deepseek-chat-v4-flash | deepseek-chat-v4-pro |
| ------------------ | ------------- | ----------------- | ---------------------- | -------------------- |
| Input (cache miss) | $0.28         | $0.28             | **$0.15**              | **$0.55**            |
| Output             | $0.42         | $0.42             | **$0.25**              | **$0.85**            |
| Cache read (hit)   | $0.028        | $0.028            | **$0.015**             | **$0.055**           |

## Key Implementation Files

| File                                                                                                                   | Purpose                                            |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [`src/api/providers/deepseek.ts`](../../src/api/providers/deepseek.ts)                                                 | DeepSeek handler (extends OpenAiHandler)           |
| [`packages/types/src/providers/deepseek.ts`](../../packages/types/src/providers/deepseek.ts)                           | Model definitions and pricing                      |
| [`src/super-roo/settings/config/providers.ts`](../../src/super-roo/settings/config/providers.ts)                       | Provider configuration                             |
| [`src/super-roo/settings/services/modelRouterService.ts`](../../src/super-roo/settings/services/modelRouterService.ts) | Agent routing with DeepSeek as primary coder       |
| [`src/super-roo/product-memory/WorkflowEnforcer.ts`](../../src/super-roo/product-memory/WorkflowEnforcer.ts)           | Workflow enforcement requiring DeepSeek for coding |
| [`src/api/transform/r1-format.ts`](../../src/api/transform/r1-format.ts)                                               | R1 format conversion (merges same-role messages)   |
| [`cloud/api/api.js`](../../cloud/api/api.js)                                                                           | Cloud API DeepSeek provider config                 |
| [`scripts/test-deepseek-api.mjs`](../../scripts/test-deepseek-api.mjs)                                                 | API test script                                    |
| [`src/api/providers/__tests__/deepseek.spec.ts`](../../src/api/providers/__tests__/deepseek.spec.ts)                   | Unit tests                                         |

## Agent Routing

DeepSeek is the primary coding worker. Routing defined in:

- [`src/super-roo/settings/services/modelRouterService.ts`](../../src/super-roo/settings/services/modelRouterService.ts:22)
- [`src/super-roo/settings/config/agentRouting.ts`](../../src/super-roo/settings/config/agentRouting.ts:17)
- [`src/super-roo/settings/services/modelRouter.ts`](../../src/super-roo/settings/services/modelRouter.ts:29)
- [`cloud/api/api.js`](../../cloud/api/api.js:1304)

**V4 Flash** (`deepseek-chat-v4-flash`) — cheap/fast worker for:

- Simple coding, summaries, extraction, routing
- Compliance checks, Telegram replies, bulk agent tasks

**V4 Pro** (`deepseek-chat-v4-pro`) — strong/slow expert for:

- Hard debugging, architecture, complex coding
- Long reasoning, final review, important decisions

| Agent          | Primary  | Fallback 1       | Fallback 2         |
| -------------- | -------- | ---------------- | ------------------ |
| Planner        | V4 Pro   | OpenAI GPT-4o    | Anthropic Claude   |
| Coder          | V4 Flash | Anthropic Claude | OpenAI GPT-4o      |
| Debugger       | V4 Pro   | Anthropic Claude | OpenAI GPT-4o      |
| Crawler        | V4 Flash | Groq Llama       | OpenAI GPT-4o-mini |
| Tester         | V4 Flash | Groq Llama       | OpenAI GPT-4o-mini |
| Deploy Checker | V4 Pro   | Groq Llama       | OpenAI GPT-4o-mini |

## Workflow Compliance

The WorkflowEnforcer requires DeepSeek for coding phases:

```typescript
// Default config
{
    requireDeepseekForCoding: true,
    deepseek: {
        primaryApiKey: process.env.DEEPSEEK_API_KEY,
        fallbackApiKey: process.env.DEEPSEEK_API_KEY_FALLBACK,
        model: "deepseek-chat-v4-flash",  // V4 Flash as default worker
        maxTokens: 4096,
    }
}
```

## Technical Notes

1. **R1 Format**: DeepSeek does not support consecutive same-role messages. All messages are converted via `convertToR1Format()` which merges adjacent messages with the same role.

2. **Thinking Mode**: For `deepseek-reasoner`, the `thinking: { type: "enabled" }` parameter enables Chain of Thought reasoning. `preserveReasoning: true` ensures `reasoning_content` is preserved during tool call sequences.

3. **Prompt Cache**: Automatically enabled. Cache hits are 10x cheaper than misses. No special configuration needed.

4. **Temperature**: Default is `0.3`. For extraction tasks, use `0.1` for deterministic output.

5. **Streaming**: Always enabled with `stream_options: { include_usage: true }` for token usage tracking.

## Environment Variables

```env
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_API_KEY_FALLBACK=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
```
