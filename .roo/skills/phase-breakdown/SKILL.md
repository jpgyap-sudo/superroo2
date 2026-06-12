---
name: phase-breakdown
description: Break down complex problems into clear, sequential phases to find systematic solutions. Use when a problem is too large to solve in one step, requires multi-domain coordination, or when the user says "this is complex" or "break this down."
---

# Phase Breakdown Skill

Use this skill when faced with a complex problem that cannot be solved in a single step. This skill provides a structured methodology for decomposing large problems into manageable phases, each with clear goals, deliverables, and success criteria.

## Core Principles

1. **Divide and conquer** — Break the problem into independent phases that can be solved sequentially or in parallel.
2. **Each phase has a clear exit criterion** — You know when a phase is done and can move to the next.
3. **Fail fast between phases** — If a phase cannot be completed, stop and reassess before proceeding.
4. **Critical thinking before action** — Each phase starts with analysis, not implementation.
5. **Document as you go** — Record decisions, dead ends, and rationale so the next phase builds on solid ground.

## Workflow

### Phase-by-Phase Flowchart

```text
[Problem Definition]
        |
[Information Gathering]
        |
[Hypothesis Formation]
        |
[Solution Design]
        |
[Implementation]
        |
[Systemic Improvement]
```

This skill is persistently stored in `.roo/skills/phase-breakdown/SKILL.md` so it can be reused by all SuperRoo extensions and agents when work is complex, new, or uncertain.

This document is now accessible to the cloud Phase Breakdown Monitor Agent at `cloud/agents/phase-breakdown-monitor-agent`.

### Phase 0: Problem Definition

Before any implementation, define the problem clearly:

1. **What is the symptom?** (What does the user see that is wrong?)
2. **What is the expected behavior?** (What should happen instead?)
3. **What is the scope?** (Which systems, files, services are involved?)
4. **What is NOT the problem?** (Rule out unrelated areas to avoid scope creep)

**Exit criterion**: A one-paragraph problem statement that the user agrees with.

### Phase 1: Information Gathering

Collect all relevant data before proposing solutions:

1. **Read error logs** — Full stack traces, not just the last line
2. **Check recent changes** — `git log --oneline -10` to see what changed recently
3. **Check configuration** — Environment variables, config files, deployment settings
4. **Check dependencies** — Package versions, lockfile consistency, peer dependency conflicts
5. **Check system state** — Running processes, disk space, memory, network connectivity

**Exit criterion**: A list of 3-5 pieces of evidence that explain the current state.

### Phase 2: Hypothesis Formation

Based on the evidence, form hypotheses:

1. **List 2-3 possible root causes** — Each hypothesis should be specific and testable
2. **For each hypothesis, predict additional symptoms** — If this hypothesis is true, what else would we observe?
3. **Rank hypotheses by likelihood** — Based on evidence, not gut feeling
4. **Design a test for the top hypothesis** — What command, log check, or code inspection would confirm or reject it?

**Exit criterion**: One confirmed root cause with supporting evidence.

### Phase 3: Solution Design

Design the fix before implementing:

1. **What is the minimal change that fixes the root cause?**
2. **What other parts of the system could this change affect?**
3. **What guards or tests should be added to prevent recurrence?**
4. **Is there a simpler alternative?** (Occam's razor — prefer the simplest fix)

**Exit criterion**: A written plan describing what will change, why, and what the risks are.

### Phase 4: Implementation

Implement the solution:

1. **Make the change** — One focused change at a time
2. **Verify the fix** — Test that the original symptom is resolved
3. **Run regression checks** — Ensure nothing else broke
4. **Commit with a clear message** — Include the root cause in the commit message

**Exit criterion**: The fix is committed and verified.

### Phase 5: Systemic Improvement

Prevent the same class of problems:

1. **Add monitoring** — Would a health check, alert, or log have caught this earlier?
2. **Add tests** — Would a unit test, integration test, or e2e test have prevented this?
3. **Update documentation** — Would better docs have helped someone avoid this?
4. **Update runbooks** — Would a deployment checklist or troubleshooting guide help?

**Exit criterion**: At least one systemic improvement is in place.

## Next Steps and Recommendations

1. If you are planning a new feature or app, start with Phase 0 and confirm the scope before writing code.
2. If you are debugging, gather logs and reproduce the failure before moving to Phase 4.
3. Use the phase plan to identify the smallest safe fix, then add regression tests as part of implementation.
4. After the fix, apply systemic improvement: monitoring, docs, and test coverage.
5. If the problem remains unclear, revisit Phase 2 and refine your hypotheses before proceeding.

## When to Use This Skill

- The problem involves multiple systems (e.g., frontend + API + database)
- The error message is vague or unhelpful
- Previous fix attempts have failed
- The user explicitly asks to "break this down" or "figure this out step by step"
- The problem has recurred multiple times

## When NOT to Use This Skill

- The fix is obvious and trivial (e.g., a typo in a string)
- The user explicitly says "just do it, don't overthink it"
- You are in the middle of an active deployment and need to fix something urgently (use the deployer skill instead)

## Guardrails

- Do NOT skip Phase 0 (Problem Definition) — if you don't know what the problem is, you can't fix it
- Do NOT jump to Phase 4 (Implementation) without completing Phases 1-3
- If a phase takes too long (>15 minutes), stop and report progress to the user
- If new evidence contradicts your current hypothesis, go back to Phase 2
- Document dead ends — knowing what didn't work is as valuable as knowing what did
