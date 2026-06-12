# Phase Breakdown Monitor Triggers

This resource defines the kinds of work that should prompt the Phase Breakdown Monitor Agent to invoke the persistent phase breakdown skill.

## Automatic trigger conditions

- "new feature", "new app", "build a new", "add support for"
- "debug", "investigate", "troubleshoot", "root cause"
- "complex", "multiple systems", "unknown failure", "not sure what to change"
- "refactor", "rearchitecture", "large change", "cross-service"

## Recommended action when triggered

- Suggest `/skill phase-breakdown` to the user.
- Create a phase plan with explicit goals and success criteria.
- Avoid jumping directly to implementation without first defining the problem.
- For debugging workflows, pair the plan with a testable hypothesis and reproduction steps.
