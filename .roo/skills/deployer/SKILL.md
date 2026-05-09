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

## Performance Optimizations

### 1. Parallel Execution

Run independent deploy steps concurrently to reduce total deploy time:

- **Nginx config deploy** (SCP + test + reload) is independent of code build — run it in parallel with `pnpm install` / `pnpm build`.
- **Health check** can start as soon as PM2 restarts — don't wait for nginx config to finish.
- Use `&` + `wait` in shell scripts or `Promise.all` in TypeScript for parallel execution.

### 2. Filtered / Incremental Installs

Avoid full monorepo installs when only a subset of packages changed:

- Use `pnpm install --filter cloud/dashboard --frozen-lockfile` instead of `pnpm install --frozen-lockfile` when only the dashboard changed.
- Use `pnpm install --filter cloud/api --frozen-lockfile` when only the API changed.
- The pnpm store is already shared — filtered installs skip unrelated workspace packages.
- If multiple packages changed, use `pnpm install --filter ...{cloud/dashboard,cloud/api}... --frozen-lockfile`.

### 3. Build Caching

- Next.js build cache (`cloud/dashboard/.next/cache`) persists across deploys — do NOT delete it.
- pnpm store (`~/.local/share/pnpm/store`) is shared across all projects — avoid `pnpm store prune` before deploys.
- Use `--prefer-offline` flag when lockfile hasn't changed to skip network resolution.

### 4. Deploy Timeout Monitoring

- Set an overall deploy timeout (recommended: 600s = 10 minutes max).
- Log elapsed time per step to identify slow stages.
- If a step exceeds 120s without output, log a warning but continue.
- Record deploy duration in `CommitDeployLog` for trend analysis.

### 5. Deploy History & Stuck Deployments

- All deploys are recorded in `server/src/memory/commit-deploy-log.json`.
- If a deploy has `status: "building"` with `completedAt: null` for more than 1 hour, it is stuck.
- Fix stuck deploys by updating their status to `"failed"` with a `failureReason` field.
- Check `CommitDeployLog.getDeploys({ status: "building" })` before starting a new deploy.

### 6. Deploy Scripts Reference

| Script                       | Location                                   | Purpose                                                 |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| remote-deploy-dashboard.sh   | cloud/remote-deploy-dashboard.sh           | Run from local machine to deploy to VPS via SSH         |
| deploy-dashboard.sh          | cloud/deploy-dashboard.sh                  | Run directly on VPS for local deploy                    |
| remote-deploy-crash-fixes.sh | cloud/remote-deploy-crash-fixes.sh         | Crash resilience deploy (Docker sandbox, PM2 reload)    |
| DeployOrchestrator.ts        | src/super-roo/deploy/DeployOrchestrator.ts | TypeScript orchestrator with health checks and rollback |

### 7. Deploy Flow Diagram

```
[Git Pull] -> [pnpm install --filter] -> [pnpm build] ---+
                                                          +-> [PM2 restart] -> [Health Check] -> [Done]
[Nginx SCP] -> [nginx -t] -> [systemctl reload] ---------+
         (parallel with build)                (wait for both)
```
