---
name: competitor-research
description: Research agent that studies competitor repos (OpenHands, SWE-agent, VoltAgent, AWS Remote SWE Agents, Power) and extracts patterns, architecture decisions, and best practices to make SuperRoo the best app. Use when the user asks to study competitors, improve SuperRoo based on market research, or close feature gaps.
---

# Competitor Research Skill

Research agent for studying competitor AI coding agent repos and extracting actionable patterns for SuperRoo.

## Repositories to Study

| Repo                  | URL                                             | Focus Area                                                                   |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| OpenHands             | https://github.com/all-hands-ai/openhands       | Event-driven agent architecture, sandboxed execution, capability-ladder docs |
| SWE-agent             | https://github.com/SWE-agent/SWE-agent          | Autonomous issue fixing, codebase navigation, trajectory analysis            |
| VoltAgent             | https://github.com/VoltAgent-ai/VoltAgent       | Multi-agent orchestration, tool routing, delegation, lifecycle management    |
| AWS Remote SWE Agents | https://github.com/awslabs/aws-remote-swe-agent | Cloud-native deployment, S3 artifact storage, Lambda-based tool execution    |
| Power                 | https://github.com/run-power/power              | Composable agent framework, plan-execute-verify separation                   |

## Research Workflow

### Phase 1: Clone & Analyze

For each target repo:

1. **Clone** the repo into a temporary directory
2. **Analyze architecture**: README, package.json, directory structure, key modules
3. **Extract patterns**: Identify 3-5 specific patterns SuperRoo can adopt
4. **Document findings**: Write structured findings to `memory/competitor-research/`

### Phase 2: Pattern Extraction

For each pattern found, document:

```markdown
## Pattern: [Name]

**Source repo**: [repo name]
**File**: [path to key file]
**What it does**: [1-2 sentence description]
**Why SuperRoo needs it**: [specific gap it fills]
**Implementation effort**: [small/medium/large]
**Priority**: [P0/P1/P2]

### How it works

[Technical description of the pattern]

### Adoption plan

1. [Step 1]
2. [Step 2]
3. [Step 3]
```

### Phase 3: Comparison Matrix

After analyzing all repos, update the comparison matrix in `c:/Users/User/.claude/guides/superroo-resources.md` with any new findings.

### Phase 4: Lesson Recording

After each research session, record a lesson in `memory/lessons-learned.md`:

```markdown
### Lesson: Competitor research — [repo name]

Date: [YYYY-MM-DD]
Source: competitor-research agent
Model/API used: [model]
Confidence: [high/medium/low]
Related files: [comma-separated list]

#### Task Summary

Studied [repo name] — extracted [N] patterns for SuperRoo adoption.

#### Key Findings

- [Finding 1]
- [Finding 2]
- [Finding 3]

#### Patterns to Adopt

- [Pattern 1]: [priority]
- [Pattern 2]: [priority]

#### Tags

[competitor-research, [repo-name], pattern-extraction]
```

## Research Script

```bash
# Research a single repo
node scripts/competitor-research.mjs --repo openhands --extract patterns

# Research all repos and generate comparison
node scripts/competitor-research.mjs --all --compare

# Research with specific focus
node scripts/competitor-research.mjs --repo swe-agent --extract architecture --focus "codebase-navigation"

# Update the comparison matrix in global resources
node scripts/competitor-research.mjs --all --update-resources
```

## Priority Research Order

1. **P0 — OpenHands**: Event-bus architecture for agent coordination (closest to SuperRoo's multi-agent model)
2. **P0 — SWE-agent**: Codebase navigation and autonomous issue fixing (directly improves commissioning loop)
3. **P1 — VoltAgent**: Agent delegation and tool routing (improves orchestrator)
4. **P1 — AWS Remote SWE Agents**: Cloud-native deployment and artifact storage (improves VPS deployment)
5. **P2 — Power**: Plan-execute-verify separation (improves commissioning phase structure)
