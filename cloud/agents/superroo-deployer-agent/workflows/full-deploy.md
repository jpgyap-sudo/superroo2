# Full Deploy Workflow

## Trigger

Run this workflow when deploying code changes to the SuperRoo production VPS.

## Steps

### Step 1: Verify SSH Connection

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "echo CONNECTED_OK"
```

If this fails, check the SSH key path and VPS status.

### Step 2: Deploy Nginx Config

Copy the updated nginx config to the VPS:

```powershell
scp -i C:\Users\User\.ssh\id_superroo_vps cloud/nginx-dashboard.conf root@104.248.225.250:/etc/nginx/sites-enabled/dashboard
```

### Step 3: Update HTTPS Config (dev.abcx124.xyz)

Add the `/_next/static/` block to the Certbot-managed HTTPS config if not already present:

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "grep -q '_next/static' /etc/nginx/sites-enabled/dev.abcx124.xyz && echo ALREADY_EXISTS || echo NEEDS_UPDATE"
```

If NEEDS_UPDATE, insert the block:

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "sed -i '/location \/ {/i\    location /_next/static/ {\n        alias /opt/superroo2/cloud/dashboard/.next/static/;\n        expires 365d;\n        add_header Cache-Control \"public, immutable, max-age=31536000\";\n        access_log off;\n    }\n' /etc/nginx/sites-enabled/dev.abcx124.xyz"
```

### Step 4: Test and Reload Nginx

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "nginx -t && systemctl reload nginx"
```

### Step 5: Pull Latest Code

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && git pull origin main"
```

### Step 6: Build Dashboard

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && corepack enable && pnpm install --frozen-lockfile && pnpm --dir cloud/dashboard run build"
```

### Step 7: Restart PM2 Services

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save"
```

### Step 8: Verify Deployment

```powershell
# Check PM2 status
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "pm2 list"

# Check API health
curl -k https://dev.abcx124.xyz/api/health

# Check CSS returns 200
curl -s -o /dev/null -w "%{http_code}" https://dev.abcx124.xyz/_next/static/css/
```

## Rollback Procedure

If the deploy fails:

1. **Nginx**: `cp /etc/nginx/sites-enabled/dashboard.save /etc/nginx/sites-enabled/dashboard && nginx -t && systemctl reload nginx`
2. **Code**: `cd /opt/superroo2 && git reset --hard <previous-sha> && cd cloud/dashboard && pnpm run build && cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save`
3. **Verify**: Re-run health checks
