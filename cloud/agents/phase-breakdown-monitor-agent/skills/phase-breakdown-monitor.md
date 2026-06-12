# Phase Breakdown Monitor Skill

Use this monitoring skill to detect when a new feature, new app, or debugging situation should be handled with a structured phase breakdown before implementation.

## When to use this skill

- A new feature or new application is being scoped.
- A debugging request is ambiguous, spans multiple systems, or is not clearly localized.
- The problem touches frontend, backend, infrastructure, or product/process at the same time.
- The user says "this is complex", "break this down", "help me plan", or "figure out the safe path."

## What this skill does

- Detects candidate triggers for structured planning.
- Invokes the repository's persistent phase breakdown skill.
- Produces a phase-based plan with exit criteria and next-step recommendations.
- Avoids premature implementation when more discovery is needed.

## How to use it

1. Review the incoming request or feature description.
2. If the request is large or uncertain, invoke the `.roo/skills/phase-breakdown/SKILL.md` skill.
3. Return a phase-by-phase plan instead of a direct fix.
4. Recommend the next step: gather evidence, confirm scope, or verify assumptions.
