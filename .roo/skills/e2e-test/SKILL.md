---
name: e2e-test
description: Run comprehensive end-to-end tests across the full stack to verify system health. When tests fail, perform systematic root-cause analysis and fix the entire system rather than patching individual bugs. Use when the user reports a bug, a deployment issue, or asks to "make sure everything works."
---

# End-to-End Test Skill

Use this skill when the user wants to verify system health, fix a bug, or ensure a deployment is working correctly. This skill does NOT just run one test — it performs a **systematic health scan** and if anything fails, it **crawls the root cause** and fixes the entire system.

## Core Principles

1. **No one-off bug fixes** — If a test fails, find the systemic root cause and fix the whole class of problems.
2. **Critical thinking over trial-and-error** — Before touching any code, analyze logs, configurations, dependencies, and architecture to understand WHY the failure happened.
3. **End-to-end coverage** — Test the full stack: build, deploy, API, UI, database, network, and external integrations.
4. **Fix the system, not the symptom** — A broken test is a signal that the system has a deeper issue. Address the root cause.

## Workflow

### Phase 1: Health Scan

Run these checks in parallel where possible:

1. **Build check**: Does the project build without errors?
   - `pnpm build` or `npm run build` in the relevant package
   - Check for TypeScript errors, lint errors, missing dependencies

2. **Unit test check**: Do existing unit tests pass?
   - `npx vitest run` in the relevant package directory
   - Note which tests fail and why

3. **Deployment check**: Is the deployed system healthy?
   - Check HTTP endpoints return 200
   - Check PM2/process status
   - Check nginx config syntax
   - Check disk space, memory, CPU

4. **Integration check**: Do the services talk to each other?
   - API → Database connectivity
   - API → Worker queue connectivity
   - Frontend → API connectivity

### Phase 2: Root Cause Analysis (if any check fails)

If any check in Phase 1 fails, do NOT immediately fix the failing test. Instead:

1. **Gather evidence**:
   - Read the full error logs (not just the last line)
   - Check recent git commits for what changed
   - Check environment variables and configuration files
   - Check dependency versions and lockfile consistency
   - Check disk space, memory pressure, process limits

2. **Formulate hypotheses**:
   - List 2-3 possible root causes based on evidence
   - For each hypothesis, predict what other symptoms would appear
   - Test the most likely hypothesis first with a targeted check

3. **Identify the systemic issue**:
   - Is this a one-time fluke or a recurring pattern?
   - Does this failure indicate a missing guard (e.g., no health check, no timeout, no retry)?
   - Would fixing this one thing prevent a whole class of future failures?

4. **Design the fix**:
   - Fix the root cause, not just the symptom
   - Add guards, monitoring, or tests to prevent recurrence
   - Document the fix and the reasoning

### Phase 3: Fix and Verify

1. Apply the fix
2. Re-run ALL checks from Phase 1 (not just the failing one)
3. If any check still fails, go back to Phase 2
4. If all checks pass, record what was fixed and why

## Guardrails

- Do NOT run `npm install` or `pnpm install` without first checking if dependencies are already installed
- Do NOT restart services without first checking their current status
- Do NOT modify code until you have a clear hypothesis of the root cause
- Do NOT skip the health scan even if the user says "just fix this one thing"
- If the fix requires a multi-step deployment, use the deployer skill after fixing
- Always check git status before and after making changes
- If the system is healthy (all checks pass), report that clearly and stop
