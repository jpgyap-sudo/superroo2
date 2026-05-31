---
name: software-architect
description: Software architecture design, system planning, and coding task breakdown methodology for Kilo Code agents
---

# Software Architect Skill

Comprehensive methodology for software architecture design, system planning, and breaking down coding tasks for implementation agents.

## Architecture Design Framework

### 1. Requirements Analysis

Before designing, always:

- Identify functional requirements (what the system must do)
- Identify non-functional requirements (performance, security, scalability)
- Identify constraints (tech stack, timeline, team skills)
- Document assumptions and dependencies

### 2. System Architecture Patterns

#### Layered Architecture

```
┌─────────────────────────────────────┐
│         Presentation Layer          │  ← UI, API endpoints, CLI
├─────────────────────────────────────┤
│        Business Logic Layer         │  ← Services, use cases, workflows
├─────────────────────────────────────┤
│         Data Access Layer           │  ← Repositories, ORM, queries
├─────────────────────────────────────┤
│         Database Layer              │  ← Storage, caching, queues
└─────────────────────────────────────┘
```

**When to use**: Enterprise apps, CRUD systems, standard web apps

#### Microservices Architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Service A│  │ Service B│  │ Service C│
│ (API)    │  │ (Worker) │  │ (Auth)   │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     └─────────────┼─────────────┘
                   │
          ┌────────┴────────┐
          │  Message Queue  │
          │  (Redis/Rabbit) │
          └─────────────────┘
```

**When to use**: Large teams, independent scaling, polyglot persistence

#### Event-Driven Architecture

```
Producer → Event Bus → Consumer A
                  → Consumer B
                  → Consumer C
```

**When to use**: Real-time systems, async workflows, decoupled systems

#### Hexagonal (Ports & Adapters)

```
         ┌─────────────────┐
         │   Domain Core   │  ← Business logic, no framework deps
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
  Ports        Ports        Ports
    │             │             │
  Adapter      Adapter      Adapter
 (REST)       (DB)         (CLI)
```

**When to use**: Testability, framework independence, complex domains

### 3. Component Design Principles

#### SOLID Principles

- **S**ingle Responsibility: One class/module = one reason to change
- **O**pen/Closed: Open for extension, closed for modification
- **L**iskov Substitution: Subtypes must be substitutable for base types
- **I**nterface Segregation: Many specific interfaces > one general interface
- **D**ependency Inversion: Depend on abstractions, not concretions

#### Design Patterns Reference

| Pattern       | Use Case                       | Example                              |
| ------------- | ------------------------------ | ------------------------------------ |
| Factory       | Object creation logic varies   | `createLogger(env)` → Winston/Bunyan |
| Strategy      | Algorithm selection at runtime | Payment processors, auth methods     |
| Observer      | Event notification systems     | Event emitters, pub/sub              |
| Decorator     | Add behavior dynamically       | Middleware, logging wrappers         |
| Repository    | Data access abstraction        | `userRepo.findById(id)`              |
| Service Layer | Business logic orchestration   | `OrderService.placeOrder()`          |
| CQRS          | Separate read/write models     | Event-sourced systems                |

### 4. Task Breakdown Methodology

#### Phase-Based Breakdown

**Phase 1: Foundation**

- Project structure setup
- Configuration management
- Database schema/migrations
- Core interfaces/types
- Base classes/utilities

**Phase 2: Core Implementation**

- Domain models
- Business logic services
- Data access layer
- API endpoints

**Phase 3: Integration**

- External service connections
- Authentication/authorization
- Error handling middleware
- Logging/monitoring

**Phase 4: Quality**

- Unit tests
- Integration tests
- E2E tests
- Documentation

**Phase 5: Deployment**

- Docker configuration
- CI/CD pipeline
- Environment configs
- Health checks

#### Task Specification Template

```markdown
## Task: [Task Name]

**Phase**: [1-5]
**Priority**: [High/Medium/Low]
**Estimated Effort**: [hours]

### Objective

[One sentence describing what this task accomplishes]

### Context

[Why this task is needed, what problem it solves]

### Implementation Steps

1. [Specific step 1]
2. [Specific step 2]
3. [Specific step 3]

### Files to Create/Modify

- `path/to/file1.ts` — [purpose]
- `path/to/file2.ts` — [purpose]

### Acceptance Criteria

- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

### Dependencies

- [Task X] must be completed first
- Requires [library/service]

### Testing

- Unit tests: [specific tests]
- Integration tests: [specific scenarios]

### Notes

[Any gotchas, edge cases, or considerations]
```

### 5. Codebase Research Strategy

#### Before Planning Any Feature:

1. **Search for existing patterns**: Use code-search to find similar implementations
2. **Check dependencies**: Review package.json for existing libraries
3. **Identify extension points**: Where should new code hook in?
4. **Map data flow**: How does data move through the system?
5. **Find test patterns**: How are existing features tested?

#### Research Commands

- `/code-search "authentication middleware"` — Find similar auth implementations
- `/grep-code "interface.*Repository"` — Find repository patterns
- `/find-files "*.service.ts"` — Locate service layer files

### 6. Quality Checklist

Before handing off to coder agent, verify:

- [ ] All tasks have clear acceptance criteria
- [ ] Dependencies are explicitly listed
- [ ] File paths are specific and exist (or should exist)
- [ ] No circular dependencies introduced
- [ ] Error handling strategy defined
- [ ] Testing approach specified
- [ ] Performance considerations noted
- [ ] Security implications reviewed

### 7. Delegation Format

When outputting tasks for the coder agent, use this format:

```markdown
# Implementation Plan: [Feature Name]

## Overview

[2-3 sentences describing the feature]

## Architecture Decision

[Why this approach, what alternatives were considered]

## Task Breakdown

### Task 1: [Name]

[Full task specification using template above]

### Task 2: [Name]

[Full task specification using template above]

## Execution Order

1. Task 1 → Task 2 → Task 3
2. Tasks 4 and 5 can run in parallel

## Success Criteria

- [ ] All tasks completed
- [ ] Tests passing
- [ ] Feature works as specified
```

## Resources

### Key Project Files

- `docs/resources/working-tree.md` — System architecture and module map
- `docs/super-roo/ARCHITECTURE_DIAGRAMS.md` — Visual architecture docs
- `docs/super-roo/CLI_ARCHITECTURE.md` — CLI system design
- `src/super-roo/settings/config/agentRouting.ts` — Agent routing config

### Design References

- Working Tree: Single source of truth for module connections
- Feature Registry: Track incomplete features
- Bug Registry: Known issues to avoid
- Lesson summaries: Past architectural decisions
