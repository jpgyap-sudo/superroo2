---
name: workspace-domain-guard
description: Detect likely wrong-workspace or wrong-project requests before editing code. Use when the user asks to add or modify features whose domain, product, customer, data model, terminology, routes, or dependencies may not match the current repository, such as asking for dog app code while working in a medical app.
---

# Workspace Domain Guard

Use this skill before making edits when a request may belong to a different project than the current workspace.

## Workflow

1. Infer the workspace identity from durable evidence:

    - README, package/app names, product copy, route names, schemas, migrations, domain models, tests, and existing feature folders.
    - Recent task context when it is consistent with the repository.

2. Infer the requested domain:

    - Product type, entities, workflows, audience, regulated context, external services, and feature vocabulary.

3. Compare the two:

    - Strong mismatch: the request introduces a different product/domain with no supporting repository evidence.
    - Weak mismatch: the request could be an integration, demo, sample data, test fixture, or admin/internal tool.
    - No mismatch: the repository already contains matching terminology or architecture.

4. If there is a strong mismatch, do not edit files yet. Ask a short confirmation question that names both sides:

    - "This workspace looks like a medical app, but the request is for a dog adoption feature. Should I continue in this repo, or did you mean to switch workspaces?"

5. If the user confirms, continue and make the requested change. If they intended another workspace, stop and tell them to open the correct project.

## Guardrails

- Do not block on superficial mismatches such as example content, placeholder names, seed data, demos, tests, or documentation unless the requested implementation would reshape product code.
- Do not ask when the user explicitly says the feature is intentionally cross-domain.
- Prefer one clear warning over repeated questions.
- When warning, include the evidence briefly: project name, README/app wording, or existing domain entities.
