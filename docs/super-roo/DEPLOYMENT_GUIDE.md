# SuperRoo Deployment Guide

This guide is for staging SuperRoo on a DigitalOcean VPS as an always-on daemon with optional Telegram control.

## Current Shape

```text
VS Code Extension = control panel
CLI               = local automation worker
Core Engine       = shared task contract
Daemon            = always-on VPS runtime
Telegram          = remote command bridge into daemon
GitHub/CI         = typecheck and bundle gate
```

## VPS Requirements

- Ubuntu 22.04/24.04 LTS
- Node.js 20.19.2
- pnpm 10.x via Corepack
- Git
- A non-root `superroo` service user

## Install

```bash
sudo adduser --system --group --home /opt/superroo superroo
sudo mkdir -p /opt/superroo /var/lib/superroo /etc/superroo
sudo chown -R superroo:superroo /opt/superroo /var/lib/superroo

sudo -u superroo git clone https://github.com/jpgyap-sudo/superroo2.git /opt/superroo
cd /opt/superroo
corepack enable
corepack prepare pnpm@10.10.0 --activate
pnpm install --frozen-lockfile
pnpm --filter superroo check-types
pnpm --filter superroo bundle
```

## Environment

Create `/etc/superroo/superroo.env`:

```bash
SUPERROO_DAEMON_HOST=127.0.0.1
SUPERROO_DAEMON_PORT=3417
SUPERROO_DAEMON_TOKEN=change-this-long-random-token
SUPERROO_WORKSPACE_ROOT=/opt/superroo
SUPERROO_DB_PATH=/var/lib/superroo/superroo.sqlite
SUPERROO_SAFETY_MODE=SAFE
SUPERROO_SELF_IMPROVE=false
SUPERROO_CRAWLER_ENABLED=false

SUPERROO_DAEMON_URL=http://127.0.0.1:3417
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_ID=
```

Keep the daemon bound to `127.0.0.1` unless it is behind TLS and strong authentication.

## Systemd

Install the daemon service:

```bash
sudo cp /opt/superroo/ops/superroo-daemon.service /etc/systemd/system/superroo-daemon.service
sudo systemctl daemon-reload
sudo systemctl enable --now superroo-daemon
sudo systemctl status superroo-daemon --no-pager
```

Optional Telegram bridge:

```ini
[Unit]
Description=SuperRoo Telegram Bridge
After=network.target superroo-daemon.service

[Service]
Type=simple
User=superroo
WorkingDirectory=/opt/superroo/src
EnvironmentFile=/etc/superroo/superroo.env
ExecStart=/usr/bin/node dist/telegram/bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Save that as `/etc/systemd/system/superroo-telegram.service`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now superroo-telegram
```

## Smoke Tests

```bash
curl http://127.0.0.1:3417/health

curl -H "Authorization: Bearer $SUPERROO_DAEMON_TOKEN" \
  http://127.0.0.1:3417/status

curl -X POST http://127.0.0.1:3417/tasks \
  -H "Authorization: Bearer $SUPERROO_DAEMON_TOKEN" \
  -H "content-type: application/json" \
  -d '{"source":"cli","agent":"coder","goal":"Audit deployment readiness","priority":"normal"}'
```

## Safety Notes

- Use `SUPERROO_SAFETY_MODE=SAFE` for first VPS staging.
- Do not enable `FULL_AUTONOMOUS` until branch/PR/CI gates are fully wired.
- Telegram only submits structured tasks to the daemon; it must not execute arbitrary shell commands.
- Keep GitHub deploys behind CI checks and protected branches.
