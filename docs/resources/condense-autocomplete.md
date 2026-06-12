# Condense Autocomplete — Global Resource

## Status
**In Planning** — Research complete, awaiting implementation approval

## Research Summary

### QwenCoder 2.5 1.5B for Autocomplete
- **Model size**: 1.5B parameters (~986MB)
- **Context window**: 32K tokens
- **FIM support**: Yes — uses `<|fim_prefix|>`, `<|fim_suffix|>`, `<|fim_middle|>` tokens
- **Ollama API**: `/api/generate` with `stream: true`
- **Latency**: <500ms for local inference on decent hardware
- **License**: Apache 2.0

### Multi-Model Architecture Patterns
1. **Continue.dev** — Uses `tabAutocompleteModel` separate from chat model
2. **Aider Architect-Editor** — Thinker model plans, editor model implements
3. **Devin** — Compound AI with planner + specialized executors
4. **OpenCastle** — Multi-agent orchestration with role-based routing

### Key Insight
The pattern is proven: use a **fast local model** for autocomplete while a **powerful remote model** handles heavy reasoning. This keeps UI responsive during long operations.

## Implementation Checklist

### Phase 1: Infrastructure
- [ ] Add `condenseAutocompleteModel` to provider settings schema
- [ ] Create `AutocompleteModel` abstraction in `src/core/condense/`
- [ ] Add Ollama FIM streaming helper function
- [ ] Add `shouldEnableCondenseAutocomplete()` guard

### Phase 2: Integration
- [ ] Modify `summarizeConversation()` to accept streaming callback
- [ ] Add `startCondenseAutocomplete()` / `stopCondenseAutocomplete()` to Task.ts
- [ ] Wire up in 4 condense paths (lines 1807, 2549, 4043, 4328)
- [ ] Add editor context extraction (`getEditorContextForAutocomplete()`)

### Phase 3: UI
- [ ] Add `condenseAutocompleteUpdate` webview message type
- [ ] Show ghost text in ChatTextArea during condense
- [ ] Add setting toggle in settings UI
- [ ] Handle Tab acceptance during condense

### Phase 4: Testing
- [ ] Unit tests for autocomplete stream
- [ ] Integration test: condense + autocomplete parallel
- [ ] Fallback test: Ollama unavailable
- [ ] Cancellation test: user types during autocomplete

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/condense/autocomplete.ts` | Create | Autocomplete streaming logic |
| `src/core/condense/index.ts` | Modify | Add streaming callback support |
| `src/core/task/Task.ts` | Modify | Add autocomplete start/stop |
| `src/core/environment/getEnvironmentDetails.ts` | Modify | Pass autocomplete state |
| `src/super-roo/settings/services/modelRouterTypes.ts` | Modify | Add condense_autocomplete route |
| `webview-ui/src/components/chat/ChatTextArea.tsx` | Modify | Show autocomplete during condense |
| `src/shared/api.ts` | Modify | Add condenseAutocompleteUpdate message type |

## Dependencies
- Ollama running locally with `qwen2.5-coder:1.5b` model pulled
- VS Code InlineCompletionItemProvider API
- AbortController for request cancellation

## Estimated Effort
- Phase 1: 2-3 hours
- Phase 2: 2-3 hours
- Phase 3: 3-4 hours
- Phase 4: 2-3 hours
- **Total**: ~10-13 hours
