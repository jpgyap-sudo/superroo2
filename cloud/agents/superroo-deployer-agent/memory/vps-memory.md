# VPS Memory — SuperRoo Production Server

## Connection Details

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| **Host**         | `104.248.225.250`                                          |
| **Domain**       | `dev.abcx124.xyz`                                          |
| **SSH User**     | `root` (full sudo access)                                  |
| **SSH Key**      | `C:\Users\User\.ssh\id_superroo_vps`                       |
| **SSH Alias**    | `superroo-vps` (configured in `C:\Users\User\.ssh\config`) |
| **OS**           | Ubuntu (with Docker)                                       |
| **Project Root** | `/opt/superroo2`                                           |

## Nginx Architecture

The VPS has **TWO** nginx site configs:

### 1. `dashboard` (HTTP, port 80)

- **File**: `/etc/nginx/sites-enabled/dashboard`
- **Purpose**: Internal HTTP proxy for dashboard
- **Proxies to**: `http://127.0.0.1:3001`
- **Also proxies**: `/api/` → `http://127.0.0.1:8787/`
- **Static assets**: Must serve `/_next/static/` from `/opt/superroo2/cloud/dashboard/.next/static/`
- **Backup**: `/etc/nginx/sites-enabled/dashboard.save`

### 2. `dev.abcx124.xyz` (HTTPS, port 443 — Certbot-managed)

- **File**: `/etc/nginx/sites-enabled/dev.abcx124.xyz`
- **Purpose**: Public HTTPS entry point for `https://dev.abcx124.xyz/`
- **SSL**: Certbot-managed at `/etc/letsencrypt/live/dev.abcx124.xyz/`
- **Proxies to**: `http://localhost:3001`
- **HTTP→HTTPS redirect**: Certbot-managed (301 redirect)
- **Static assets**: MUST also serve `/_next/static/` from `/opt/superroo2/cloud/dashboard/.next/static/`
- **WARNING**: This file is managed by Certbot — Certbot may rewrite it on renewal. The `/_next/static/` block must be re-added if Certbot regenerates the config.

## PM2 Services

| Service              | Port | Script                                         | CWD                              |
| -------------------- | ---- | ---------------------------------------------- | -------------------------------- |
| `superroo-api`       | 8787 | `./api/api.js`                                 | `/opt/superroo2/cloud`           |
| `superroo-worker`    | —    | `./worker/worker.js`                           | `/opt/superroo2/cloud`           |
| `superroo-dashboard` | 3001 | `./.next/standalone/cloud/dashboard/server.js` | `/opt/superroo2/cloud/dashboard` |

**PM2 config**: `/opt/superroo2/cloud/ecosystem.config.js`

## Static Assets (CSS/JS Fix)

Next.js 14 standalone server returns **400 Bad Request** for CSS/JS files. The fix is to serve them directly from nginx:

```nginx
location /_next/static/ {
    alias /opt/superroo2/cloud/dashboard/.next/static/;
    expires 365d;
    add_header Cache-Control "public, immutable, max-age=31536000";
    access_log off;
}
```

This block must be added to **BOTH**:

- `/etc/nginx/sites-enabled/dashboard` (HTTP config)
- `/etc/nginx/sites-enabled/dev.abcx124.xyz` (HTTPS config)

## Deployment Commands

### Full deploy (from local machine):

```powershell
# 1. Copy nginx config
scp -i C:\Users\User\.ssh\id_superroo_vps cloud/nginx-dashboard.conf root@104.248.225.250:/etc/nginx/sites-enabled/dashboard

# 2. Test and reload nginx
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "nginx -t && systemctl reload nginx"

# 3. Pull latest code on VPS
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && git pull origin main"

# 4. Build dashboard
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2 && corepack enable && pnpm install --frozen-lockfile && pnpm --dir cloud/dashboard run build"

# 5. Restart PM2
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "cd /opt/superroo2/cloud && pm2 restart ecosystem.config.js && pm2 save"

# 6. Health check
curl -k https://dev.abcx124.xyz/api/health
```

### Quick nginx reload only:

```powershell
ssh -i C:\Users\User\.ssh\id_superroo_vps root@104.248.225.250 "nginx -t && systemctl reload nginx"
```

## Rollback

- **Nginx config backup**: `/etc/nginx/sites-enabled/dashboard.save`
- **PM2 rollback**: `pm2 restart ecosystem.config.js` (uses previous build)
- **Git rollback**: `cd /opt/superroo2 && git reset --hard <previous-sha>`

## Important Notes

- The `superroo` user does NOT have passwordless sudo. Always use `root` for SSH.
- The `dashboard` config was previously overwritten with SSL paths that don't exist — the backup at `dashboard.save` saved the working config.
- Certbot manages the `dev.abcx124.xyz` config — if Certbot renews, the `/_next/static/` block may be removed.
- The `.next/static/` directory exists at `/opt/superroo2/cloud/dashboard/.next/static/` with `css/`, `chunks/`, and media subdirectories.
