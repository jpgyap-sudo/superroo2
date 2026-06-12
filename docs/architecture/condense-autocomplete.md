# Multi-Model Condense Autocomplete

## Concept
Use a **fast local model** (QwenCoder 2.5 1.5B via Ollama) for streaming autocomplete/typing during condense operations, while the **main thinker model** (DeepSeek API) handles the heavy summarization.

## Architecture Pattern
```
┌─────────────────────────────────────────────────────────────┐
│                    SuperRoo Extension                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Thinker    │    │   Condense   │    │  Autocomplete │  │
│  │  (DeepSeek)  │    │  Summarizer  │    │  (QwenCoder)  │  │
│  │              │    │              │    │              │  │
│  │ • Complex    │    │ • Full       │    │ • Fast       │  │
│  │   reasoning  │    │   summary    │    │   streaming  │  │
│  │ • Planning   │    │ • Context    │    │ • FIM-based  │  │
│  │ • Decisions  │    │   overflow   │    │ • Local      │  │
│  │              │    │   rescue     │    │   Ollama     │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         └───────────────────┼───────────────────┘           │
│                             │                               │
│                    ┌────────▼────────┐                     │
│                    │  Central Brain  │                     │
│                    │  (Memory/Log)   │                     │
│                    └─────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Model Roles
| Role | Model | Purpose | Latency Target |
|------|-------|---------|----------------|
| Thinker | DeepSeek API | Main conversation, complex reasoning | 2-5s |
| Condense Summarizer | DeepSeek API | Full context summarization | 5-15s |
| Autocomplete | QwenCoder 2.5 1.5B (Ollama) | Streaming typing during condense | <500ms |

### 2. Trigger Conditions
Autocomplete during condense activates when:
- `isAutomaticTrigger === true` (automatic condensing)
- Context is > 50% of window size
- Main condense API call is in progress
- User is actively typing in the chat input

### 3. FIM Template for QwenCoder
```json
{
  "model": "qwen2.5-coder:1.5b",
  "prompt": "<|fim_prefix|>{{prefix}}<|fim_suffix|>{{suffix}}<|fim_middle|>",
  "stream": true,
  "options": {
    "temperature": 0.2,
    "max_tokens": 256,
    "stop": ["<|endoftext|>", "\n\n"]
  }
}
```

### 4. Streaming Protocol
```
Main Condense Flow:
1. Start condense API call (DeepSeek)
2. Simultaneously start autocomplete stream (QwenCoder)
3. As user types, cancel/replace autocomplete request
4. When condense completes, stop autocomplete
5. Show condensed summary + any autocomplete text
```

## Implementation Plan

### Phase 1: Infrastructure ✅
- [x] Add `condense_autocomplete` to `TaskRouteType` in `modelRouterTypes.ts`
- [x] Add `condense_autocomplete` to `ModelCapability` in `modelRouterTypes.ts`
- [x] Create `condenseAutocompleteService.ts` with `generateAutocomplete` and `isAutocompleteAvailable`
- [x] Add Ollama FIM streaming support via `/api/generate`
- [x] Add `condense_autocomplete` route to `modelRouterService.ts` (Ollama primary, DeepSeek/Groq fallback)
- [x] Add API routes `/condense-autocomplete/generate` and `/condense-autocomplete/available`
- [x] Update frontend `modelRouterApi.ts` with autocomplete endpoints

### Phase 2: Integration ✅
- [x] Modify `summarizeConversation` to accept streaming callback
- [x] Add autocomplete trigger in Task.ts condense paths
- [x] Wire up cancellation when condense completes

### Phase 3: UI ✅
- [x] Show "Condensing..." status with autocomplete indicator
- [x] Allow user to accept/reject autocomplete during condense
- [x] Add setting to enable/disable autocomplete during condense

## Files Modified
- `src/core/condense/index.ts` — Add streaming callback support
- `src/core/condense/autocomplete.ts` — New file for autocomplete logic
- `src/core/task/Task.ts` — Trigger autocomplete during condense
- `src/core/environment/getEnvironmentDetails.ts` — Pass autocomplete state
- `src/super-roo/settings/services/modelRouterTypes.ts` — Add condense_autocomplete route
- `webview-ui/src/components/chat/ChatTextArea.tsx` — Show autocomplete during condense

## Risks & Mitigations
| Risk | Mitigation |
|------|-----------|
| Ollama not running | Graceful fallback, disable autocomplete |
| Model too slow | 500ms timeout, cancel if no first token |
| Context confusion | Only use last 100 lines for FIM prefix/suffix |
| User typing conflict | Cancel previous autocomplete on new keystroke |

## Success Metrics
- Autocomplete latency < 500ms (p95)
- Condense time unchanged (parallel, not blocking)
- User can still type normally during condense
- No context pollution between condense and autocomplete
