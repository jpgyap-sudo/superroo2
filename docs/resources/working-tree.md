# SuperRoo Working Tree

> **Purpose**: This document is the single source of truth for the SuperRoo product architecture. All agents should read this to understand the system structure, module interactions, and product features before making changes.

## Overview

The SuperRoo system is organized into **18 core modules** spanning orchestration, agent execution, safety, persistence, self-healing, machine learning, product memory, commit/deploy tracking, parallel execution, and infrastructure. Each module has a status, owner, connections to other modules, and specific product features it enables.

## Module Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                                 │
│  Task dispatch, agent lifecycle, workflow orchestration             │
└──────────┬────────────────────────────────────────────────┬─────────┘
           │ routes tasks to                                  │ manages
           ▼                                                 ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│   AGENT SYSTEM   │  │   SAFETY SYSTEM  │  │      TASK QUEUE          │
│  Coder, Debugger │◄─┤  Mode-based ACL  │  │  Priority-based queue    │
│  PM, Tester, ... │  │  Capability gate │  │  BullMQ integration      │
└────────┬─────────┘  └──────────────────┘  └──────────────────────────┘
         │
         ├──► MEMORY SYSTEM (SQLite persistence for all entities)
         ├──► FEATURE REGISTRY (Feature lifecycle & health tracking)
         ├──► BUG REGISTRY (Bug tracking & fix management)
         ├──► EVENT LOG (Append-only event stream for observability)
         │
         ├──► SELF-HEALING SYSTEM
         │     ├── Healing Bus (incident coordination)
         │     ├── Root Cause Classifier (pattern-based classification)
         │     ├── Repair Plan Builder (structured fix generation)
         │     └── Self-Healing Loop (detect → classify → plan → fix → verify)
         │
         ├──► ML ENGINE
         │     ├── Neural Network (Tensor, layers, optimizers, loss fns)
         │     ├── Learners (CodeLearner, DebugLearner, TestLearner)
         │     └── Infinite Improvement Loop (continuous learning)
         │
         ├──► PRODUCT MEMORY
         │     ├── Product Feature Agent (feature discovery)
         │     ├── Product Updates Agent (change timeline)
         │     ├── Feature Tester Agent (test execution)
         │     └── Bug-Feature Mapper (traceability)
         │
         ├──► PARALLEL EXECUTION ENGINE
         │     ├── Agent Bus (inter-agent messaging)
         │     ├── Parallel Healing Pipeline
         │     └── Parallel ML Trainer
         │
         ├──► CPU GUARD (Resource-aware autonomous protection)
         ├──► DEPLOY SYSTEM (GitHub Actions + VPS SSH)
         ├──► COMMIT & DEPLOY LOG (Centralized commit/deploy audit trail)
         ├──► CRAWLER AGENT (Data crawling & extraction)
         ├──► FILE IMPORTER (Filesystem import)
         ├──► REMOTE SHELL (SSH remote execution)
         │
         ├──► SETTINGS & API KEYS SYSTEM
         │     ├── API Keys View (Provider key management)
         │     ├── Settings View (VPS control center)
         │     ├── Secret Vault (AES-256-GCM encrypted storage)
         │     ├── Provider Testers (Real SDK connection testing)
         │     └── Agent Routing Sync (Provider availability → routing)
```

## Module Details

### 1. Orchestrator

- **Owner**: `SuperRooOrchestrator`
- **Status**: `stable`
- **Connections**: Agents, Queue, Safety, Memory, Logging
- **Features**: Task routing, Agent lifecycle management, Workflow orchestration
- **Source**: [`src/super-roo/orchestrator/`](../src/super-roo/orchestrator/)

### 2. Agent System

- **Owner**: `AgentRegistry`
- **Status**: `stable`
- **Connections**: Orchestrator, Safety, Memory, Logging, Healing, Product Memory
- **Features**: Automated coding, Debugging & root cause analysis, Test execution, Product management, Self-healing
- **Agents**:
    - **Coder Agent** ([`src/super-roo/agents/CoderAgent.ts`](../src/super-roo/agents/CoderAgent.ts)) - Code generation & implementation
    - **Debugger Agent** ([`src/super-roo/agents/DebuggerAgent.ts`](../src/super-roo/agents/DebuggerAgent.ts)) - Bug investigation & root cause analysis
    - **PM Agent** ([`src/super-roo/agents/PmAgent.ts`](../src/super-roo/agents/PmAgent.ts)) - Product management & feature tracking
    - **Tester Agent** ([`src/super-roo/agents/TesterAgent.ts`](../src/super-roo/agents/TesterAgent.ts)) - Test execution & quality gates
    - **Supabase Agent** ([`src/super-roo/agents/SupabaseAgent.ts`](../src/super-roo/agents/SupabaseAgent.ts)) - Database operations
    - **Self-Healing Agent** ([`src/super-roo/agents/SelfHealingAgent.ts`](../src/super-roo/agents/SelfHealingAgent.ts)) - Autonomous incident response

### 3. Safety System

- **Owner**: `SafetyManager`
- **Status**: `stable`
- **Connections**: Orchestrator, Agents, Deploy
- **Features**: Autonomy level enforcement (OFF → SAFE → AUTO → FULL_AUTONOMOUS), Capability gating, Blocklist filtering
- **Source**: [`src/super-roo/safety/`](../src/super-roo/safety/)

### 4. Memory System

- **Owner**: `MemoryStore`
- **Status**: `stable`
- **Connections**: Orchestrator, Features, Bugs, Logging, Queue
- **Features**: SQLite persistence, CRUD for all entities, Event sourcing
- **Source**: [`src/super-roo/memory/`](../src/super-roo/memory/)

### 5. Task Queue

- **Owner**: `TaskQueue`
- **Status**: `stable`
- **Connections**: Orchestrator, Memory, Logging
- **Features**: Priority queuing, Job retry & backoff, Concurrency control
- **Source**: [`src/super-roo/queue/`](../src/super-roo/queue/)

### 6. Event Log

- **Owner**: `EventLog`
- **Status**: `stable`
- **Connections**: Orchestrator, Memory, Healing
- **Features**: Event streaming, Observability, Audit trail
- **Source**: [`src/super-roo/logging/`](../src/super-roo/logging/)

### 7. Feature Registry

- **Owner**: `FeatureRegistry`
- **Status**: `stable`
- **Connections**: Memory, Bugs, Product Memory, Agents
- **Features**: Feature lifecycle tracking (planned → building → testing → working → deprecated), Health monitoring (unknown → healthy → degraded → failing), Bug-to-feature mapping
- **Source**: [`src/super-roo/features/`](../src/super-roo/features/)

### 8. Bug Registry

- **Owner**: `BugRegistry`
- **Status**: `stable`
- **Connections**: Memory, Features, Healing
- **Features**: Bug recording & tracking, Severity classification, Fix attempt history
- **Source**: [`src/super-roo/bugs/`](../src/super-roo/bugs/)

### 9. Self-Healing System

- **Owner**: `HealingBus / SelfHealingLoop`
- **Status**: `stable`
- **Connections**: Bugs, Features, Agents, Logging, ML, Parallel
- **Features**: Incident detection, Root cause classification, Repair plan generation, Auto-fix deployment, Verification cycle
- **Sub-modules**:
    - **Healing Bus** ([`src/super-roo/healing/HealingBus.ts`](../src/super-roo/healing/HealingBus.ts)) - Incident coordination hub
    - **Root Cause Classifier** ([`src/super-roo/healing/RootCauseClassifier.ts`](../src/super-roo/healing/RootCauseClassifier.ts)) - Pattern-based classification
    - **Repair Plan Builder** ([`src/super-roo/healing/RepairPlanBuilder.ts`](../src/super-roo/healing/RepairPlanBuilder.ts)) - Structured fix generation
    - **Self-Healing Loop** ([`src/super-roo/healing/SelfHealingLoop.ts`](../src/super-roo/healing/SelfHealingLoop.ts)) - State machine driving detect→classify→plan→fix→verify

### 10. Machine Learning Engine

- **Owner**: `NeuralNetwork / InfiniteImprovementLoop`
- **Status**: `experimental`
- **Connections**: Healing, Agents, Parallel
- **Features**: Neural network training, Code pattern learning, Debug pattern learning, Test pattern learning, Infinite improvement loop
- **Sub-modules**:
    - **ML Engine** ([`src/super-roo/ml/engine/`](../src/super-roo/ml/engine/)) - Tensor, layers, optimizers, loss functions
    - **Learners** ([`src/super-roo/ml/learning/`](../src/super-roo/ml/learning/)) - CodeLearner, DebugLearner, TestLearner
    - **Improvement Loop** ([`src/super-roo/ml/loop/`](../src/super-roo/ml/loop/)) - Continuous improvement cycle

### 11. Product Memory

- **Owner**: `ProductMemoryService`
- **Status**: `stable`
- **Connections**: Features, Bugs, Agents, Logging
- **Features**: Product feature tracking, Update timeline, Feature test history, Bug-to-feature mapping, Agent notes
- **Sub-modules**:
    - **Product Feature Agent** ([`src/super-roo/product-memory/agents/ProductFeatureAgent.ts`](../src/super-roo/product-memory/agents/ProductFeatureAgent.ts))
    - **Product Updates Agent** ([`src/super-roo/product-memory/agents/ProductUpdatesAgent.ts`](../src/super-roo/product-memory/agents/ProductUpdatesAgent.ts))
    - **Feature Tester Agent** ([`src/super-roo/product-memory/agents/FeatureTesterAgent.ts`](../src/super-roo/product-memory/agents/FeatureTesterAgent.ts))
    - **Bug-Feature Mapper** ([`src/super-roo/product-memory/agents/BugFeatureMapperAgent.ts`](../src/super-roo/product-memory/agents/BugFeatureMapperAgent.ts))
    - **Commit & Deploy Log** ([`src/super-roo/product-memory/CommitDeployLog.ts`](../src/super-roo/product-memory/CommitDeployLog.ts)) - Centralized audit trail for all commits and deploys

### 12. Commit & Deploy Log

- **Owner**: `CommitDeployLog`
- **Status**: `active`
- **Connections**: Product Memory, Deploy System, Event Log, Working Tree Agent
- **Features**: Centralized commit recording, Deploy lifecycle tracking, Health check verification, Rollback tracking, Agent-aware audit trail, Feature-linked commits
- **Source**: [`src/super-roo/product-memory/CommitDeployLog.ts`](../src/super-roo/product-memory/CommitDeployLog.ts)
- **Data**: [`server/src/memory/commit-deploy-log.json`](../server/src/memory/commit-deploy-log.json)

    > **IMPORTANT**: This is THE single source of truth for all commits and deployments across all coding agents. Every agent MUST use `CommitDeployLog.recordCommit()` and `CommitDeployLog.recordDeploy()` to record their work. The log is append-only (no deletions, only status updates) and agent-aware (records which agent made the change).

### 14. Parallel Execution Engine

- **Owner**: `ParallelExecutor / AgentBus`
- **Status**: `experimental`
- **Connections**: Agents, Healing, ML
- **Features**: Parallel task execution, Inter-agent messaging, Parallel healing, Parallel ML training
- **Sub-modules**:
    - **Agent Bus** ([`src/super-roo/parallel/AgentBus.ts`](../src/super-roo/parallel/AgentBus.ts))
    - **Parallel Healing Pipeline** ([`src/super-roo/parallel/ParallelHealingPipeline.ts`](../src/super-roo/parallel/ParallelHealingPipeline.ts))
    - **Parallel ML Trainer** ([`src/super-roo/parallel/ParallelMLTrainer.ts`](../src/super-roo/parallel/ParallelMLTrainer.ts))

### 15. CPU Guard

- **Owner**: `AgentLoopGuard / AutonomousController`
- **Status**: `stable`
- **Connections**: Agents, Orchestrator
- **Features**: CPU usage monitoring, Autonomous task throttling, Resource-aware scheduling
- **Source**: [`src/super-roo/cpu-guard/`](../src/super-roo/cpu-guard/)

### 16. Deploy System

- **Owner**: `DeployOrchestrator`
- **Status**: `stable`
- **Connections**: Safety, Logging
- **Features**: GitHub Actions dispatch, VPS SSH deployment, Rollback management, Health check verification
- **Source**: [`src/super-roo/deploy/`](../src/super-roo/deploy/)

### 17. Crawler Agent

- **Owner**: `CrawlerAgent`
- **Status**: `experimental`
- **Connections**: Logging
- **Features**: Web crawling, Entity extraction, Signal detection
- **Source**: [`src/super-roo/crawler/`](../src/super-roo/crawler/)

### 18. File Importer

- **Owner**: `FileImporter`
- **Status**: `stable`
- **Connections**: Memory
- **Features**: File import, Content extraction, Type validation
- **Source**: [`src/super-roo/import/`](../src/super-roo/import/)

### 19. Remote Shell

- **Owner**: `RemoteShell`
- **Status**: `experimental`
- **Connections**: Deploy, Safety
- **Features**: SSH command execution, Remote file operations
- **Source**: [`src/super-roo/remote/`](../src/super-roo/remote/)

### 20. Settings & API Keys System

- **Owner**: `SettingsService / SecretVault`
- **Status**: `active`
- **Connections**: Dashboard, API Server, Deploy System, Agent System
- **Features**: Provider API key management, Encrypted secret storage (AES-256-GCM), Real provider connection testing, Agent routing sync, VPS control center (auto-approve, MCP, guardrails), Deployment safety validation
- **Sub-modules**:
    - **API Keys View** ([`cloud/dashboard/src/components/views/api-keys.tsx`](../cloud/dashboard/src/components/views/api-keys.tsx)) - Provider key management UI with save/test/delete
    - **Settings View** ([`cloud/dashboard/src/components/views/settings.tsx`](../cloud/dashboard/src/components/views/settings.tsx)) - Advanced VPS control center
    - **Secret Vault** ([`cloud/api/api.js`](../cloud/api/api.js)) - AES-256-GCM encrypted key storage with masking
    - **Provider Testers** ([`cloud/api/api.js`](../cloud/api/api.js)) - Real SDK connection testing for OpenAI, Anthropic, DeepSeek, Kimi, OpenRouter, Groq
    - **Provider Config** ([`cloud/config/providers.ts`](../cloud/config/providers.ts)) - Provider definitions with models and capabilities
    - **Agent Routing Config** ([`cloud/config/agent-routing.ts`](../cloud/config/agent-routing.ts)) - Agent-to-provider routing with fallbacks
    - **Settings API** ([`cloud/api/api.js`](../cloud/api/api.js)) - REST endpoints for providers, routes, approval evaluation, and full settings CRUD

## Interaction Flows

### Task Execution Flow

```
User/CLI → Orchestrator → Safety Gate → Queue → Agent Dispatch → Agent Execution → Memory/Logging
```

### Self-Healing Flow

```
Incident Detection → Healing Bus → Root Cause Classifier → Repair Plan Builder → Self-Healing Loop → Fix → Verify
```

### Product Memory Flow

```
Feature Discovery → Product Feature Agent → Feature Registry → Tester Agent → Bug-Feature Mapper → Product Updates
```

### ML Improvement Flow

```
Task History → CodeLearner/DebugLearner/TestLearner → Neural Network Training → Infinite Improvement Loop → Better Agent Performance
```

### Commit & Deploy Log Flow

```
Agent Commit → CommitDeployLog.recordCommit() → JSON Persistence → Dashboard Visualization
Agent Deploy → CommitDeployLog.recordDeploy() → Health Check → Status Update → Dashboard Visualization
```

## Status Legend

| Status         | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `stable`       | Production-ready, well-tested, actively maintained |
| `active`       | Currently being developed or enhanced              |
| `experimental` | Proof of concept, may change or be removed         |
| `deprecated`   | Scheduled for removal, avoid new dependencies      |

## How Agents Should Use This

1. **Before making changes**: Read this document to understand which modules are affected and their connections
2. **When debugging**: Trace the interaction flow to identify which module is likely the source
3. **When adding features**: Check the Feature Registry and Product Memory first to avoid duplication
4. **When fixing bugs**: Check the Bug Registry and Healing System for existing incidents
5. **When improving performance**: Consider the CPU Guard and Parallel Execution Engine for resource management
6. **When committing code**: ALWAYS use `CommitDeployLog.recordCommit()` to record your commit. Include the commit SHA, agent name, type, title, files changed, and features affected.
7. **When deploying**: ALWAYS use `CommitDeployLog.recordDeploy()` to record the deploy attempt, then `CommitDeployLog.updateDeployStatus()` to update the result (healthy/unhealthy/rolled_back/failed).
8. **When checking history**: Use `CommitDeployLog.getCommits()` and `CommitDeployLog.getDeploys()` with filters to see what other agents have done.

## Dashboard Visualization

The Working Tree is visualized in the SuperRoo Cloud Dashboard under the **Working Tree** tab ([`cloud/dashboard/src/components/views/working-tree.tsx`](../cloud/dashboard/src/components/views/working-tree.tsx)). It provides an interactive tree view with search, status filtering, and detailed module information including connections and product features. The tab also includes a **Commit & Deploy Log** panel showing recent commits, deploy status, and statistics.
