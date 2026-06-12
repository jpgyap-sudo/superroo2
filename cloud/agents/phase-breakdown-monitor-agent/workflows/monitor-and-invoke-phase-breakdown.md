# Workflow: Monitor and Invoke Phase Breakdown

1. Detect complexity triggers:
   - New feature request, new app design, or architecture expansion
   - Bug triage / debugging request that is vague or crosses modules
   - Cross-system work involving frontend, backend, infra, or security
   - Large change, rework, refactor, or uncertainty about the root cause

2. Classify the request:
   - Low complexity: proceed with normal planning and execution.
   - Medium/high complexity: require structured phase breakdown.

3. Trigger the persistent phase breakdown skill:
   - Use `.roo/skills/phase-breakdown/SKILL.md` as the canonical reference.
   - Prefer `/skill phase-breakdown` if the system supports the slash command interface.
   - If direct invocation is unavailable, output a phase plan in the agent result.

4. Build the plan:
   - Phase 0: Problem Definition
   - Phase 1: Information Gathering
   - Phase 2: Hypothesis Formation
   - Phase 3: Solution Design
   - Phase 4: Implementation
   - Phase 5: Systemic Improvement

5. Recommend the next step:
   - For feature work: confirm scope, acceptance criteria, and impacted systems.
   - For debugging: gather logs, reproduce the issue, and test hypotheses.
   - For new apps: sketch the architecture, dependencies, and integration points first.
   - Always document the decision path and exit criteria before coding.
