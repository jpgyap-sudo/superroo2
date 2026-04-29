# Phase 10 Prompt — Model Router

Build a model router for Super Roo.

Purpose:
Route tasks to the best model/provider.

Examples:
- Claude: debugging and coding
- OpenAI: reasoning and planning
- Kimi: long-context reading
- Local model: cheap classification

Folder target:
`src/super-roo/model-router/`

Create:
- `model-router.ts`
- `model-provider.ts`
- `claude-adapter.ts`
- `openai-adapter.ts`
- `kimi-adapter.ts`
- `local-model-adapter.ts`

Requirements:
- Provider interface
- Task type routing
- Fallback provider
- Retry logic
- Cost estimate placeholder
- Never log API keys

Add tests for routing and fallback.
