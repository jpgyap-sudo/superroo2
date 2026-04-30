# SuperRoo DigitalOcean VPS Staging Runbook

This runbook is for running SuperRoo as a headless 24/7 agent on a DigitalOcean Droplet.

## Readiness Model

The headless daemon is a staging-safe runtime for the orchestrator. It provides:

- `GET /health` for uptime and liveness checks.
- `GET /status` for authenticated queue/runtime status.
- `POST /tasks` for authenticated task submission.
- A persistent SQLite database.
- The orchestrator task loop and ML improvement loop.

The daemon does not expose a public web UI and binds to `127.0.0.1` by default. Put it behind SSH tunneling, a VPN, or a reverse proxy with TLS and authentication if remote access is needed.

## Droplet Baseline

- Ubuntu LTS.
- Node.js `20.19.2`.
- pnpm via Corepack.
- A non-root `superroo` user.
- DigitalOcean Cloud Firewall allowing SSH only from trusted IPs.
- DigitalOcean Monitoring enabled with CPU, memory, disk, and bandwidth alerts.

## Install

```bash
sudo useradd --system --create-home --shell /bin/bash superroo
sudo mkdir -p /opt/superroo /etc/superroo /var/lib/superroo
sudo chown -R superroo:superroo /opt/superroo /var/lib/superroo

cd /opt/superroo
git clone https://github.com/jpgyap-sudo/superroo2.git .
corepack enable
pnpm install --frozen-lockfile

sudo cp .env.superroo.example /etc/superroo/superroo.env
sudo editor /etc/superroo/superroo.env

sudo cp ops/superroo-daemon.service /etc/systemd/system/superroo-daemon.service
sudo systemctl daemon-reload
sudo systemctl enable --now superroo-daemon
```

## Health Checks

```bash
curl http://127.0.0.1:3417/health
curl -H "Authorization: Bearer $SUPERROO_DAEMON_TOKEN" http://127.0.0.1:3417/status
```

## Submit a Task

```bash
curl -X POST http://127.0.0.1:3417/tasks \
  -H "Authorization: Bearer $SUPERROO_DAEMON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":"coder","goal":"Inspect the repo and suggest the next safe improvement","priority":"normal"}'
```

## Deploy/Restart

`scripts/restart.sh` is the restart hook used by `DeployOrchestrator`. It installs dependencies, runs checks, packages the VSIX, and restarts the systemd service.

```bash
sudo systemctl restart superroo-daemon
sudo journalctl -u superroo-daemon -f
```

## Important Production Notes

- Keep `SUPERROO_SAFETY_MODE=SAFE` until the real coding runner is wired and tested.
- Keep `SUPERROO_DAEMON_HOST=127.0.0.1` unless a reverse proxy with TLS and authentication is configured.
- Rotate `SUPERROO_DAEMON_TOKEN` before exposing any endpoint.
- Do not enable `SUPERROO_SELF_IMPROVE=true` on production until rollback and repository protection are tested.

