---
name: project-artifact-generator
description: Generates project agents, resources, rules, skills, and required Markdown documentation from repository signals, ML/neural coding patterns, and user goals while asking before overwriting important files.
---

# Project Artifact Generator Skill

## When To Use

Use this skill when the user asks SuperRoo to create, improve, or infer project support artifacts, including:

- `AGENTS.md`, `.roo/rules`, `.roo/skills`, `.roo/commands`, `.agents/skills`, or agent role files.
- Resource documents, templates, references, runbooks, checklists, or project memory files.
- Markdown files such as `README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TESTING.md`, `OPERATIONS.md`, `TROUBLESHOOTING.md`, `CHANGELOG.md`, `ROADMAP.md`, or feature specs.
- Project setup files such as `.env.example`, config examples, release notes, onboarding docs, or CI/CD notes.

## Goal

Use SuperRoo's project analysis, coding history, and ML/neural risk signals to generate the missing project artifacts that help future agents and humans work safely and quickly.

## Core Behavior

- Prefer generating concrete files over giving only advice when the user asks for project artifacts.
- Infer artifact needs from the actual repository structure, package scripts, existing docs, tests, workflows, and recurring project rules.
- Make generated artifacts useful immediately, but keep them reviewable and easy to edit.
- Ask the user for missing project goals, audience, deployment target, or policy choices when guessing would create misleading documentation.
- Ask before overwriting existing important files.

## Discovery Checklist

Before generating artifacts, inspect the relevant local signals:

- Existing docs and project metadata: `README.md`, `AGENTS.md`, `.roo/`, `.agents/`, `docs/`, `plans/`, `package.json`, workspace files, and root config files.
- Build and test flow: package scripts, `turbo.json`, CI workflows, Docker files, test folders, and type-check commands.
- Product shape: app folders, extension/webview packages, API routes, database files, ops folders, workers, and release scripts.
- Current agent rules: `.roo/rules*`, `.roomodes`, existing skills, commands, and guidance files.
- Recent project signals: bug logs, improvement reports, task notes, failing tests, repeated user requests, and changed files.

## ML And Neural Signals

Treat these as prioritization signals, not unquestionable truth:

- Repeated failures become candidates for guardrails in `AGENTS.md`, rules, skills, or troubleshooting docs.
- Repeated successful workflows become candidates for commands, runbooks, or reusable skills.
- Files touched together often indicate a workflow that should be documented.
- High-risk areas such as deployment, secrets, webview message contracts, settings state, migrations, and external APIs deserve explicit checklists.
- If a pattern is project-specific, prefer workspace artifacts. If it is portable across projects, suggest a global skill.

## Artifact Types

### Agents

Create or update agent-facing guidance when the project needs durable behavior:

- `AGENTS.md` for repository-wide instructions.
- `.roo/rules/<topic>.md` for general rules.
- `.roo/rules-code/<topic>.md` for coding-mode rules.
- `.roo/skills/<skill-name>/SKILL.md` for reusable project workflows.
- `.agents/skills/<skill-name>/SKILL.md` when cross-agent compatibility is more important than Roo-specific behavior.

Good agent artifacts must say when to use the rule/skill, what to inspect, what to avoid, and how to validate.

### Resources

Create resource/reference files when agents need project context without bloating every prompt:

- `docs/resources/<topic>.md`
- `docs/runbooks/<topic>.md`
- `docs/templates/<topic>.md`
- `docs/references/<topic>.md`

Use resources for API schemas, deployment matrices, database notes, product vocabulary, prompts, integration setup, and operational procedures.

### Markdown Docs

Generate docs based on what the project is missing:

- `ARCHITECTURE.md`: system shape, packages, data flow, extension/webview/backend boundaries.
- `DEPLOYMENT.md`: environments, required secrets, build steps, deploy flow, rollback.
- `TESTING.md`: type checks, focused tests, integration tests, manual QA.
- `OPERATIONS.md`: monitoring, logs, jobs, incident response.
- `TROUBLESHOOTING.md`: known failures, symptoms, fixes, commands.
- `CONTRIBUTING.md`: branch flow, code style, review/test expectations.
- `SECURITY.md`: secret handling, reporting, dependency review, risky operations.
- `ROADMAP.md` or `plans/*.md`: prioritized improvement plan.

## Authorization Rules

Ask before:

- Overwriting existing `AGENTS.md`, README, security docs, deployment docs, or committed policy files.
- Creating global artifacts outside the workspace.
- Writing secrets, tokens, private URLs, or production values.
- Running network, deployment, cloud, package publishing, migration, or destructive commands.
- Changing docs that describe legal, compliance, billing, or security commitments.

When approval is not available, create a draft file with a clear name such as `docs/drafts/<topic>.md` or explain the exact pending write.

## Generation Workflow

1. Identify the artifact request and target audience: human, future agent, deployment operator, contributor, or product owner.
2. Inspect existing artifacts to avoid duplication.
3. Decide whether the artifact should be workspace-local, Roo-specific, cross-agent, global, or a normal project doc.
4. Draft the minimum useful artifact with concrete commands, paths, and project rules.
5. Include validation steps and ownership boundaries.
6. Ask before overwriting important files.
7. Write the file, then re-read the header/frontmatter to verify names and paths are correct.
8. Summarize created files and any assumptions.

## Quality Rules

- Keep artifacts specific to this project. Avoid generic filler.
- Use placeholders for secrets: `<API_KEY>`, `<PRODUCTION_URL>`, `<DATABASE_URL>`.
- Prefer checklists and commands that can actually be run in this repo.
- Do not invent unsupported features, services, or guarantees.
- Link related local files by path when useful.
- For skills, frontmatter `name` must exactly match the parent folder name.
- For `SettingsView` work in this repo, preserve the rule that inputs bind to local `cachedState` until Save.

## Suggested Output

When done, report:

- Files created or updated.
- Why each artifact was needed.
- Signals used to generate it.
- Any assumptions or details still needed from the user.
- Validation performed.
