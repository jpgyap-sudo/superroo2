# SuperContinue

A pure local Ollama coding agent fork with SuperRoo ecosystem integration, ML neural network enhancements, and lesson learning.

## Features

- **Pure Local Ollama** - All models run locally via Ollama, no cloud connections
- **No Telemetry** - All data stays within the SuperRoo ecosystem
- **Central Brain Integration** - Connects to SuperRoo's learning layer for lessons and tasks
- **ML Enhancements** - Neural routing, adaptive temperature, ensemble voting, FIM caching
- **Lesson Learning** - Contributes to and retrieves from institutional memory

## Installation

```bash
cd packages/supercontinue
npm install
npm run build
```

## Configuration

### Ollama Models

| Role | Model | Use Case |
|------|-------|----------|
| Planner | `hermes3:latest` | Task planning, reasoning |
| Architect | `phi4:latest` | Architecture decisions |
| Coding | `qwen2.5-coder:7b` | Autocomplete, chat, edit |
| Complex Coding | `qwen2.5-coder:14b` | Large refactoring |
| Embeddings | `nomic-embed-text:latest` | Codebase indexing |

### Continue.dev Integration

Place config files in `~/.continue/`:

**config.yaml:**
```yaml
name: SuperContinue Local Ollama
version: 1.0.0
schema: v1

models:
  - name: hermes3-planner
    provider: ollama
    model: hermes3:latest
    apiBase: http://localhost:11434
    roles: [chat]
    contextLength: 32768
    temperature: 0.3

  - name: qwen2.5-coder-7b
    provider: ollama
    model: qwen2.5-coder:7b
    apiBase: http://localhost:11434
    roles: [autocomplete, chat, edit]
    contextLength: 32768
    temperature: 0.0
    promptTemplates:
      autocomplete:
        prefix: "<|fim_prefix|>"
        suffix: "<|fim_suffix|>"
        middle: "<|fim_middle|>"

disableTelemetry: true
allowRemoteConfig: false
```

## Usage

### Basic

```typescript
import { 
  MODEL_ROLES, 
  defaultConfig, 
  getSuperContinueBrain 
} from "@superroo/supercontinue"

const brain = getSuperContinueBrain()

// Register lesson intent at session start
await brain.registerLessonIntent("Implement feature X")

// Get relevant lessons for context
const lessons = await brain.getRelevantLessons("fix database connection")

// Store a lesson after completing work
await brain.storeLesson(
  "Fixed connection pool leak", 
  "The bug was caused by...", 
  ["bugfix", "database"]
)
```

### ML Modules

```typescript
import { 
  ModelRouter, 
  TemperatureController,
  EnsembleVoter,
  FIMCache,
  Prompter
} from "@superroo/supercontinue"

// Neural model routing
const router = ModelRouter.getInstance()
const prediction = await router.predict({ fileCount: 5, lineCount: 100 })

// Adaptive temperature
const temp = TemperatureController.getInstance()
const temperature = temp.getTemperature({ successProb: 0.8, bugRiskClass: 1 })

// FIM caching
const cache = FIMCache.getInstance()
const completions = await cache.getCompletions({ prefix: "function ", suffix: " }" })

// Lesson-augmented prompts
const prompter = Prompter.getInstance()
const augmented = await prompter.buildPrompt({ task: "Refactor auth module" })
```

### VS Code Extension Provider

```typescript
import { SuperContinueHandler } from "@superroo/supercontinue"

// Use as API handler
const handler = new SuperContinueHandler({
  ollamaModelId: "qwen2.5-coder:7b",
  ollamaBaseUrl: "http://localhost:11434"
})
```

## Verification

```bash
# Run verification script
node scripts/test-supercontinue.mjs

# Or manually check:
curl http://localhost:11434/api/tags
```

## Files

- `src/index.ts` - Main exports
- `src/brain.ts` - Central Brain client
- `src/router.ts` - Neural model router
- `src/temperature.ts` - Adaptive temperature control
- `src/ensemble.ts` - Multi-model voting
- `src/cache.ts` - FIM pattern cache
- `src/prompter.ts` - Lesson-augmented prompts
- `config.yaml` - Continue.dev configuration
- `config.ts` - TypeScript configuration

## License

MIT