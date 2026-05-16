---
name: superroo-vps-deployer
description: 🚀 SuperRoo VPS Deployer — Automated deployment to the SuperRoo cloud dashboard VPS at 104.248.225.250
---

# SuperRoo VPS Deployer Skill

## When To Use

Use this skill when the user asks to deploy, publish, or push updates to the SuperRoo cloud dashboard, API, worker, or any service running on the SuperRoo VPS at `104.248.225.250`.

Also use this skill when a task ends with "deploy to the VPS", "make it live", "push to production", or similar deployment requests for the SuperRoo cloud infrastructure.

## VPS Connection Details

| Property | Value |
|----------|-------|
| Host | `104.248.225.250` |
| User | `root` |
| SSH Key | `C:\Users\User\.ssh\id_superroo_vps` |
| Project Root | `/opt/superroo2` |
| Cloud Dir | `/opt/superroo2/cloud` |
| Dashboard Dir | `/opt/superroo2/cloud/dashboard` |

## SSH Command Template

Always use the `-i` flag with the explicit key path. Do NOT rely on SSH config host aliases or default key loading.

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "<command>"
```

## Deployment Steps

### 1. Pull latest code

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && git pull origin main"
```

### 2. Install dependencies

Use the full path to pnpm since it's not in the non-interactive SSH PATH:

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && /usr/bin/node /usr/lib/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile"
```

### 3. Build the dashboard

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=120 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && /usr/bin/node /usr/lib/node_modules/pnpm/bin/pnpm.cjs --dir cloud/dashboard run build"
```

### 4. Restart PM2 services

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save"
```

### 5. Verify deployment

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "pm2 list && echo '---DASHBOARD STATUS---' && curl -s -o /dev/null -w 'HTTP %{http_code}' http://localhost:3001"
```

## All-in-One Deploy Command

For a full deploy in a single SSH session (recommended):

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && git pull origin main && /usr/bin/node /usr/lib/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile && /usr/bin/node /usr/lib/node_modules/pnpm/bin/pnpm.cjs --dir cloud/dashboard run build && cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save"
```

**Timeout**: Set to at least 300 seconds (5 minutes) since `pnpm install` and `next build` can take a while.

## PM2 Services on VPS

| Service | Port | Description |
|---------|------|-------------|
| `superroo-api` | 8787 | Backend API server |
| `superroo-worker` | — | Background job worker |
| `superroo-dashboard` | 3001 | Next.js dashboard (served via nginx) |
| `product-image-studio` | — | Product image processing |

## Health Check

The dashboard is accessible at:
- `http://104.248.225.250:3001` (direct)
- `https://dev.abcx124.xyz` (via nginx reverse proxy)

## Troubleshooting

### pnpm not found
Use the full path: `/usr/bin/node /usr/lib/node_modules/pnpm/bin/pnpm.cjs`

### Build fails
Check if the `next` module is installed in `cloud/dashboard/node_modules/.pnpm`. If not, the `pnpm install --frozen-lockfile` step may have failed silently. Try without `--frozen-lockfile`.

### Dashboard not starting after deploy
Check PM2 logs:
```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "pm2 logs superroo-dashboard --lines 50"
```

### Port conflict
Ensure port 3001 is not already in use:
```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "lsof -i :3001"
```

## Using for Other Projects

This deployer can be adapted for other projects on the same VPS or different servers. To adapt:

1. **Same VPS, different project path**: Change `PROJECT_ROOT` from `/opt/superroo2` to the target path
2. **Different VPS/server**: Update the SSH target (`root@<IP>`), key path, and project root
3. **Different package manager**: Replace the pnpm commands with `npm`, `yarn`, or the appropriate tool
4. **Different build command**: Replace `pnpm --dir cloud/dashboard run build` with the project's build command
5. **Different process manager**: Replace `pm2` commands with `systemctl`, `supervisor`, or `docker` commands

The core pattern — `git pull → install deps → build → restart services → verify` — applies to most web projects.

## Authorization

This skill has pre-authorized access to the SuperRoo VPS at `104.248.225.250` using the `id_superroo_vps` SSH key. No additional user approval is needed for deployment commands that:
- Pull code from the configured git remote
- Install dependencies
- Build the dashboard
- Restart PM2 services
- Verify deployment health

User approval IS still required for:
- Changing SSH keys or VPS credentials
- Modifying nginx configuration
- Changing DNS records or domains
- Database migrations
- Installing new system packages on the VPS
- Any destructive operations (deleting files, stopping services permanently)
- Deploying to a different server or project not covered by this skill
