# Deployment Checklist

## Pre-Deploy

- [ ] SSH key `id_superroo_vps` is accessible
- [ ] VPS is reachable (`ssh root@104.248.225.250 "echo OK"`)
- [ ] Local changes are committed or stashed
- [ ] Nginx config is valid locally (`nginx -t` equivalent check)
- [ ] Dashboard builds locally (`pnpm --dir cloud/dashboard run build`)

## Deploy Steps

- [ ] Copy nginx config to VPS
- [ ] Update `dev.abcx124.xyz` HTTPS config (add `/_next/static/` block if missing)
- [ ] Test nginx config (`nginx -t`)
- [ ] Reload nginx (`systemctl reload nginx`)
- [ ] Pull latest code on VPS (`git pull origin main`)
- [ ] Install dependencies (`pnpm install --frozen-lockfile`)
- [ ] Build dashboard (`pnpm --dir cloud/dashboard run build`)
- [ ] Restart PM2 services (`pm2 restart ecosystem.config.js && pm2 save`)

## Post-Deploy Verification

- [ ] PM2 shows all 3 services running (`pm2 list`)
- [ ] API health check returns 200 (`curl https://dev.abcx124.xyz/api/health`)
- [ ] CSS files return 200, not 400 (`curl -I https://dev.abcx124.xyz/_next/static/css/`)
- [ ] Website loads without distortion in browser
- [ ] No ERR_TOO_MANY_REDIRECTS in browser console

## Rollback Preparedness

- [ ] Nginx backup exists at `/etc/nginx/sites-enabled/dashboard.save`
- [ ] Previous git SHA is noted for code rollback
- [ ] Rollback commands are ready
