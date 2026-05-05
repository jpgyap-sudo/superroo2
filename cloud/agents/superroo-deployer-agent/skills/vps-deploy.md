# VPS Deploy Skill

## Overview

Automated deployment to SuperRoo production VPS at `104.248.225.250` with full root SSH access.

## Prerequisites

- SSH key at `C:\Users\User\.ssh\id_superroo_vps`
- SSH alias `superroo-vps` configured in `C:\Users\User\.ssh\config`
- Root access confirmed (key works for `root@104.248.225.250`)

## Connection

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "<command>"
```

## Deployment Types

### 1. Quick nginx config update (no build needed)

Use when only nginx config changed (e.g., adding `/_next/static/` block):

```powershell
# Copy config
scp -i C:\Users\User\.ssh\id_superroo_vps cloud/nginx-dashboard.conf root@104.248.225.250:/etc/nginx/sites-enabled/dashboard

# Test and reload
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "nginx -t && systemctl reload nginx"
```

### 2. Full dashboard deploy (build + PM2 restart + nginx)

Use when dashboard code changed:

```powershell
# 1. Copy nginx config
scp -i C:\Users\User\.ssh\id_superroo_vps cloud/nginx-dashboard.conf root@104.248.225.250:/etc/nginx/sites-enabled/dashboard

# 2. Pull latest code
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && git pull origin main"

# 3. Build dashboard
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && corepack enable && pnpm install --frozen-lockfile && pnpm --dir cloud/dashboard run build"

# 4. Restart PM2
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save"

# 5. Test and reload nginx
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "nginx -t && systemctl reload nginx"
```

### 3. Update HTTPS config (dev.abcx124.xyz)

When adding `/_next/static/` block to the Certbot-managed HTTPS config:

```powershell
# Add the static block to the HTTPS server block
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "sed -i '/location \/ {/i\    location /_next/static/ {\n        alias /opt/superroo2/cloud/dashboard/.next/static/;\n        expires 365d;\n        add_header Cache-Control \"public, immutable, max-age=31536000\";\n        access_log off;\n    }\n' /etc/nginx/sites-enabled/dev.abcx124.xyz"

# Test and reload
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "nginx -t && systemctl reload nginx"
```

## Verification

### Health check

```powershell
# API health
curl -k https://dev.abcx124.xyz/api/health

# CSS check (should return 200, not 400)
curl -s -o /dev/null -w "%%{http_code}" https://dev.abcx124.xyz/_next/static/css/$(ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "ls /opt/superroo2/cloud/dashboard/.next/static/css/" | head -1)

# PM2 status
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "pm2 list"
```

## Rollback

### Nginx config rollback

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cp /etc/nginx/sites-enabled/dashboard.save /etc/nginx/sites-enabled/dashboard && nginx -t && systemctl reload nginx"
```

### Code rollback

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && git reset --hard <previous-sha> && cd cloud/dashboard && pnpm run build && cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save"
```

## Important Warnings

- The `dev.abcx124.xyz` config is managed by Certbot — Certbot may remove the `/_next/static/` block on renewal. Always verify after Certbot runs.
- The `superroo` user does NOT have sudo. Always connect as `root`.
- Always run `nginx -t` before `systemctl reload nginx` to avoid breaking the site.
- The `dashboard.save` file is the backup of the original working HTTP config.
