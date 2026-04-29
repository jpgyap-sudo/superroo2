# Phase 6 Prompt — DevOps + Auto Deploy

Build the DevOps Agent.

Requirements:
- Git branch creation
- Commit changes
- Push branch
- Optional GitHub Actions deployment trigger
- Optional SSH deployment
- PM2 restart helper
- Health check
- Rollback helper
- Deployment report

Folder target:
`src/super-roo/devops/`

Create:
- `git-manager.ts`
- `github-actions-manager.ts`
- `ssh-deployer.ts`
- `pm2-manager.ts`
- `rollback-manager.ts`
- `deploy-reporter.ts`
- `devops.agent.ts`

Safety:
- Production deploy disabled by default.
- Require permission level 4 for production.
- Require health check URL.
- Require rollback command before production deploy.

Add tests with mocked command execution.
