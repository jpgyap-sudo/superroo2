# SuperRoo System Architecture

## Overview
SuperRoo is an AI-powered coding assistant with cloud infrastructure, ML engine, and multi-agent system.

## Core Modules

### 1. Orchestrator
- Task routing, agent lifecycle management, workflow orchestration
- Source: src/super-roo/orchestrator/

### 2. Agent System
- Coder Agent: Code generation & implementation
- Debugger Agent: Bug investigation & root cause analysis
- PM Agent: Product management & feature tracking
- Tester Agent: Test execution & quality gates
- Supabase Agent: Database operations
- Self-Healing Agent: Autonomous incident response
- Source: src/super-roo/agents/

### 3. Safety System
- Autonomy level enforcement (OFF -> SAFE -> AUTO -> FULL_AUTONOMOUS)
- Capability gating, blocklist filtering
- Source: src/super-roo/safety/

### 4. Memory System
- SQLite persistence, CRUD for all entities, event sourcing
- Source: src/super-roo/memory/

### 5. Task Queue
- Priority queuing, job retry & backoff, concurrency control
- BullMQ integration
- Source: src/super-roo/queue/

### 6. Event Log
- Event streaming, observability, audit trail
- Source: src/super-roo/logging/

### 7. Feature Registry
- Feature lifecycle tracking (planned -> building -> testing -> working -> deprecated)
- Health monitoring (unknown -> healthy -> degraded -> failing)
- Bug-to-feature mapping
- Source: src/super-roo/features/

### 8. Bug Registry
- Bug recording & tracking, severity classification, fix attempt history
- Source: src/super-roo/bugs/

### 9. Self-Healing System
- Healing Bus: Incident coordination hub
- Root Cause Classifier: Pattern-based classification
- Repair Plan Builder: Structured fix generation
- Self-Healing Loop: detect -> classify -> plan -> fix -> verify
- Source: src/super-roo/healing/

### 10. Machine Learning Engine
- Neural network training, code/debug/test pattern learning
- Infinite improvement loop
- Source: src/super-roo/ml/

### 11. Product Memory
- Product Feature Agent, Product Updates Agent
- Feature Tester Agent, Bug-Feature Mapper
- Commit & Deploy Log: Centralized audit trail
- Source: src/super-roo/product-memory/

### 12. Commit & Deploy Log
- Centralized commit recording, deploy lifecycle tracking
- Health check verification, rollback tracking
- Agent-aware audit trail, feature-linked commits
- Source: src/super-roo/product-memory/CommitDeployLog.ts

### 13. Parallel Execution Engine
- Parallel task execution, inter-agent messaging
- Parallel healing pipeline, parallel ML training
- Source: src/super-roo/parallel/

### 14. CPU Guard
- CPU usage monitoring, autonomous task throttling
- Resource-aware scheduling
- Source: src/super-roo/cpu-guard/

### 15. Deploy System
- GitHub Actions dispatch, VPS SSH deployment
- Rollback management, health check verification
- Source: src/super-roo/deploy/

### 16. Crawler Agent
- Web crawling, entity extraction, signal detection
- Source: src/super-roo/crawler/

### 17. File Importer
- File import, content extraction, type validation
- Source: src/super-roo/import/

### 18. Remote Shell
- SSH command execution, remote file operations
- Source: src/super-roo/remote/

### 19. Settings & API Keys System
- Provider API key management, encrypted secret storage (AES-256-GCM)
- Real provider connection testing, agent routing sync
- VPS control center (auto-approve, MCP, guardrails)
- Source: cloud/api/api.js, cloud/dashboard/src/components/views/

## Cloud Infrastructure
- API Server: Port 8787, BullMQ queue, Redis backend
- Worker: Processes jobs from queue, runs in Docker sandbox
- Dashboard: Next.js app on port 3001
- VPS: 104.248.225.250, nginx reverse proxy at dev.abcx124.xyz
- PM2 process management with ecosystem.config.js

## Telegram Bot Commands
- /code <instruction> - Create a coding task
- /ask <question> - Ask the AI support assistant
- /diff <taskId> - Show changed files
- /test <taskId> - Run test suite
- /approve <taskId> - Approve pending changes
- /deploy <taskId> - Deploy approved build (OTP required)
- /status [taskId] - Check system or task status
- /session - Check active session
- /otp - Set up Google Authenticator
- /logs [n] - View recent logs
- /projects - List and select projects
- /workspace - Show active workspace
- /specify <workspace> - Bind group chat to a workspace
- /help - Show all commands
