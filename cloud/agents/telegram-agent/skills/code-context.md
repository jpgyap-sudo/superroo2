# Code Context Skill

Understand and reference the SuperRoo codebase when answering questions.

## Project Structure

The SuperRoo project is a monorepo with these key areas:

### Core Extension (src/)
- VS Code extension with agent system, ML engine, memory, safety, etc.
- TypeScript codebase
- Key modules: Orchestrator, Agent System, Safety, Memory, ML Engine, Healing, Features, Bugs

### Cloud Server (cloud/)
- Node.js API server on port 8787
- BullMQ queue with Redis backend
- Telegram bot integration
- Docker sandbox for agent execution
- Dashboard (Next.js on port 3001)

### Agent System (cloud/agents/)
- Each agent has: agent.json, skills/, workflows/, resources/, memory/
- Agents run inside Docker sandbox via BullMQ worker
- Current agents: telegram-agent, superroo-debugger-agent, superroo-deployer-agent, superroo-tester-agent, github-pr-agent, skill-generator-agent, homeu-* agents

### ML Engine (src/super-roo/ml/)
- Neural network with layers, tensors, optimizers
- Learners: CodeLearner, DebugLearner, TestLearner
- InfiniteImprovementLoop for continuous learning

## When Answering Code Questions

1. Reference specific file paths when discussing code
2. Explain the architecture and how components connect
3. If the user asks about a specific module, describe its purpose, inputs, outputs, and connections
4. Use `code blocks` for technical references
