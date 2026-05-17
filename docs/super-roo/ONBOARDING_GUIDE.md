# SuperRoo Onboarding Guide

Welcome to **SuperRoo** — an autonomous AI coding agent platform built on top of the Roo Code VS Code extension. This guide will help you get started with development, testing, and deployment.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Development Setup](#development-setup)
4. [Running Tests](#running-tests)
5. [Key Modules](#key-modules)
6. [Workflow](#workflow)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** >= 18 (see `.nvmrc` / `.tool-versions`)
- **pnpm** >= 9 (the project uses pnpm workspaces)
- **VS Code** (for extension development)
- **Git** (for version control)

Optional but recommended:

- **Ollama** (for local LLM inference used by the learning layer)
- **Docker** (for containerized deployment)
- **Tailscale** (for VPS SSH access)

---

## Project Structure

```
superroo2/
├── src/                    # VS Code extension source (TypeScript)
│   ├── extension.ts        # Extension entry point
│   ├── super-roo/          # Core SuperRoo modules
│   │   ├── agents/         # Agent orchestration
│   │   ├── crawler/        # Data ingestion (RSS, web scraping)
│   │   ├── deploy/         # Deployment orchestrator
│   │   ├── healing/        # Self-healing system (HealingBus, RootCauseClassifier)
│   │   ├── import/         # File import utilities
│   │   ├── lessons/        # Learning layer (LessonRetriever, PromptEnhancer)
│   │   ├── logging/        # Event logging system
│   │   ├── memory/         # Memory stores (SQLite, MemoryStore)
│   │   ├── ml/             # ML Engine (Tensor, Layers, Loss, Optimizers)
│   │   ├── safety/         # Safety manager
│   │   └── settings/       # Settings types and configuration
│   └── package.json        # Extension manifest
├── webview-ui/             # React-based WebView UI
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── super-roo/  # SuperRoo dashboard tabs
│   │   │   └── ui/         # Shared UI components (Radix-based)
│   │   ├── context/        # React contexts (ExtensionStateContext)
│   │   ├── i18n/           # Internationalization (12+ locales)
│   │   └── utils/          # Utility functions
│   └── package.json
├── cloud/                  # Cloud dashboard (Next.js) & worker scripts
│   ├── dashboard/          # Next.js 14 dashboard app
│   ├── api/                # API endpoints (Telegram bot, etc.)
│   └── worker/             # Background workers
├── apps/
│   └── web-superroo/       # Marketing website (Next.js 16)
├── packages/               # Shared packages
│   └── vscode-shim/        # VS Code API shim for testing
├── docs/                   # Documentation
│   ├── super-roo/          # SuperRoo-specific docs
│   └── resources/          # Working tree, API references
├── memory/                 # Learning layer storage
│   ├── lessons-learned.md  # All lessons learned
│   ├── bugs-fixed.md       # Bug registry
│   └── model-decisions.md  # Architecture decisions
├── scripts/                # Build & utility scripts
├── locales/                # Translated READMEs & docs
└── commissioning/          # Test results & commissioning reports
```

---

## Development Setup

### 1. Install Dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all workspace dependencies
pnpm install
```

### 2. Build the Extension

```bash
# Build the VS Code extension
cd src && pnpm run build

# Build the WebView UI
cd webview-ui && pnpm run build
```

### 3. Run in Development Mode

Open the `src/` directory in VS Code and press `F5` to launch the Extension Development Host.

For WebView UI development:

```bash
cd webview-ui && pnpm run dev
```

---

## Running Tests

The project uses **Vitest** for testing. Tests must be run from the correct workspace directory.

### Backend Tests (src/)

```bash
# Run all tests
cd src && npx vitest run

# Run a specific test file
cd src && npx vitest run super-roo/healing/__tests__/HealingBus.test.ts

# Run tests in watch mode
cd src && npx vitest
```

### WebView UI Tests (webview-ui/)

```bash
# Run all tests
cd webview-ui && npx vitest run

# Run a specific test file
cd webview-ui && npx vitest run src/components/super-roo/tabs/__tests__/DashboardTab.spec.tsx
```

### Key Testing Patterns

- **ESM module mocking**: Use `vi.mock()` at the top level for `fs`, `fs/promises`, etc.
- **Default imports**: When mocking `import fs from "fs/promises"`, include `default: { readFile: mockReadFile }` in the mock factory.
- **Private field access**: Use type assertion `as unknown as { field: Type }` to access private fields in tests.
- **React components**: Mock context hooks with `vi.mock()` and `vi.fn()`.

---

## Key Modules

### ML Engine (`src/super-roo/ml/`)

Pure TypeScript neural network engine with:

- **Tensor**: N-dimensional array with autograd support
- **Layers**: Dense, Conv2D, MaxPool2D, Flatten, Dropout, BatchNorm, ReLU, Sigmoid, Tanh, Softmax
- **Loss functions**: CrossEntropy, MSE, Huber, Hinge, BCE
- **Optimizers**: SGD, Adam
- **LR Schedulers**: StepDecay, ExponentialDecay, ReduceLROnPlateau
- **Model Persistence**: Atomic JSON save/load

### Healing Module (`src/super-roo/healing/`)

Self-healing system with:

- **HealingBus**: Incident reporting, state machine, healing actions, repair plans, escalation
- **RootCauseClassifier**: 22 root cause patterns (ENV_MISSING, DB_SCHEMA_MISMATCH, API_AUTH_FAILURE, etc.)
- **RepairPlanBuilder**: Generates repair plans from classified incidents
- **SelfHealingLoop**: Autonomous healing loop with safety checks

### Learning Layer (`src/super-roo/lessons/`)

Institutional memory system:

- **LessonRetriever**: Loads, filters, sorts, and formats lessons from JSONL index
- **PromptEnhancer**: Injects relevant lessons into prompts for different models
- **Lesson format**: Supports codex, claude, deepseek, kimi formats

### Crawler (`src/super-roo/crawler/`)

Data ingestion system:

- **CrawlerAgent**: RSS feed crawling, text extraction, entity analysis, signal emission
- Scheduled crawling with configurable intervals
- Error tracking with `errorCounts` map

### Deploy (`src/super-roo/deploy/`)

Deployment orchestrator:

- **DeployOrchestrator**: GitHub Actions + VPS deployment pipeline
- Health checks, rollback support, Nginx config management
- Tailscale SSH for secure VPS access

---

## Workflow

### Standard Development Cycle

1. **Read lessons**: Check `memory/lessons-learned.md` for relevant context
2. **Build agent context**: Run `node scripts/ml/build-agent-context.mjs "<task>"`
3. **Implement changes**: Follow the project's coding standards
4. **Write tests**: Ensure test coverage for all new code
5. **Run tests**: Verify all tests pass
6. **Record lesson**: Run `node scripts/extract-lesson-from-commit.mjs --interactive`
7. **Commit**: Use conventional commit messages

### Agent Routing

The project uses a multi-model architecture:

- **DeepSeek**: Primary coding worker (low-cost, high-quality)
- **Codex**: Planner, reviewer, tester, final verifier
- **Ollama**: Local memory, lessons, summaries, feature knowledge
- **Central Brain**: Persistent memory database / pgvector / lesson store

---

## Deployment

### VPS Deployment (Mandatory: Tailscale SSH)

```bash
# Tailscale IP (NEVER use public IP for SSH)
SSH_TARGET="root@100.64.175.88"

# Deploy via the orchestrator
cd src && node -e "
const { DeployOrchestrator } = require('./super-roo/deploy');
const orch = new DeployOrchestrator({ /* config */ });
orch.deploy('1.0.0', 'abc123').then(console.log);
"
```

See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for full details.

### Commit & Deploy Log

All commits and deployments must be recorded in [`CommitDeployLog`](../../src/super-roo/product-memory/CommitDeployLog.ts):

```typescript
CommitDeployLog.recordCommit({
	sha: "abc123",
	agentName: "codex",
	type: "feature",
	title: "Add user authentication",
	filesChanged: ["src/auth.ts"],
	featuresAffected: ["auth"],
})
```

---

## Troubleshooting

### Common Issues

| Issue                                 | Solution                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| `vitest: command not found`           | Run tests from the correct workspace (`cd src` or `cd webview-ui`) |
| `Cannot spy on export in ESM`         | Use `vi.mock()` instead of `vi.spyOn()` for `fs`, `fs/promises`    |
| `Cannot access before initialization` | Use `vi.hoisted()` for mock variables                              |
| SQLite build errors                   | Ensure `better-sqlite3` build tools are installed                  |
| WebView not loading                   | Check `webview-ui` build output exists                             |

### Getting Help

- Check `memory/lessons-learned.md` for past solutions
- Check `memory/bugs-fixed.md` for similar bugs
- Check `docs/super-roo/TROUBLESHOOTING.md` for known issues
- Check the Working Tree at [`docs/resources/working-tree.md`](../resources/working-tree.md)

---

## Next Steps

1. Read the [Working Tree](../resources/working-tree.md) to understand the full architecture
2. Explore the [ML Engine API](ML_ENGINE_API.md) for ML features
3. Review the [Healing Module Guide](HEALING_MODULE_GUIDE.md) for self-healing
4. Check the [Deployment Guide](DEPLOYMENT_GUIDE.md) for production deployment
5. Browse `memory/lessons-learned.md` for accumulated engineering wisdom
