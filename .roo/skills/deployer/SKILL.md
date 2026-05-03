---
name: deployer
description: Automates project deployment preparation and execution while requesting required deployment details, secrets, and explicit user authorization before external or production changes.
---

# Deployer Skill

## When To Use

Use this skill when the user asks to deploy, publish, release, ship, host, set up CI/CD, configure environments, create deployment scripts, connect a cloud provider, or make the project accessible outside the local machine.

Also use this skill when a task naturally ends with deployment readiness, such as adding a production build, Dockerfile, hosting config, release workflow, environment template, health check, or rollback plan.

## Goal

Make deployment as automated as possible while keeping the user in control of credentials, billing, infrastructure, DNS, and production-impacting actions.

## Deployment Defaults

- Prefer repeatable scripts, CI workflows, documented commands, and environment templates over one-off manual steps.
- Prefer the deployment path already implied by the repository, such as existing Dockerfiles, GitHub Actions, package scripts, hosting configs, or ops files.
- If no deployment target exists, inspect the project and recommend a minimal deployment path that fits the stack.
- Keep local validation, build, and smoke tests part of the deployment flow.
- Produce a clear rollback path before production deployment.

## Required Discovery

Before choosing or running a deployment path, inspect for:

- Package manager and build scripts, such as `package.json`, `pnpm-workspace.yaml`, `turbo.json`, or language-specific equivalents.
- Existing deployment assets, such as `.github/workflows`, `Dockerfile`, `docker-compose.yml`, `vercel.json`, `netlify.toml`, `fly.toml`, `railway.json`, `render.yaml`, `ops/`, or cloud config.
- Runtime requirements: Node version, databases, queues, object storage, webhooks, cron jobs, secrets, ports, domains, and background workers.
- Environment files or examples, such as `.env.example`, `.env.sample`, `.env.superroo.example`, and docs.
- Existing release, versioning, or changelog process.

## Ask The User For Missing Details

If needed, ask concise questions for:

- Target environment: local preview, staging, production, VPS, Docker, Vercel, Netlify, Railway, Render, Fly.io, AWS, GCP, Azure, Supabase, or another platform.
- Repository/branch to deploy and whether uncommitted changes should be included.
- Domain, subdomain, DNS provider, TLS requirements, and redirect rules.
- Required secrets and where the user wants them stored.
- Database, storage, queue, and webhook endpoints.
- Budget/billing constraints and region preferences.
- Rollback preference and acceptable downtime.
- Whether the user authorizes external commands, cloud changes, DNS changes, or production deploys.

## Authorization Rules

Never assume authorization for actions that affect external systems. Ask for explicit user approval before:

- Installing dependencies from the network.
- Logging into cloud providers or CLIs.
- Creating, modifying, or deleting cloud resources.
- Changing DNS records, webhooks, billing settings, secrets, environment variables, or production databases.
- Pushing commits, tags, releases, packages, containers, or artifacts.
- Running deploy commands that publish to staging or production.
- Running database migrations against shared, staging, or production environments.

If authorization is denied or unavailable, prepare the deployment artifacts and provide the exact next step that requires user approval.

## Automation Workflow

1. Identify the app type, deployable packages, entry points, build commands, runtime commands, and health checks.
2. Detect existing deployment conventions and reuse them when reasonable.
3. Create or update missing deployment assets only when they are needed:
    - build/start scripts
    - Dockerfile or compose file
    - CI/CD workflow
    - environment example
    - deployment README
    - smoke test script
    - rollback notes
4. Validate locally with the narrowest relevant commands.
5. Summarize required secrets and user-provided values without printing secret values.
6. Request authorization for any external or production step.
7. After approval, run the deployment step, capture the result, and verify the deployed app with a health check or smoke test.
8. Record what changed, what was deployed, how to roll back, and what still needs user action.

## Safety Rules

- Never reveal secret values in chat, logs, reports, or generated files.
- Use placeholders like `<PRODUCTION_API_URL>` in examples.
- Do not write real secrets into committed files.
- Do not delete existing deployment infrastructure unless the user explicitly asks and confirms the target.
- Before destructive operations, state the exact resource and environment.
- If the worktree is dirty, identify relevant changes before deployment and avoid reverting unrelated files.
- Prefer staging or preview deployment before production when the target is ambiguous.

## Output Format

When performing deployment work, report:

- Deployment target and environment.
- Files changed or generated.
- Commands run and whether they passed.
- Secrets or settings still needed, named but not valued.
- Authorization requested or received.
- Deployment URL or artifact location, if available.
- Verification result.
- Rollback command or rollback procedure.

## SuperRoo Project Notes

For this workspace, prefer `pnpm` workflows and existing package scripts. Before deploying extension or webview changes, run relevant type checks and focused tests where practical. If the deployment touches Settings UI behavior, preserve the repository rule that SettingsView inputs bind to local `cachedState` until the user saves.
