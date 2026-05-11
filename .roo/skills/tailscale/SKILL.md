---
name: tailscale
description: 🔗 Tailscale — Manage Tailscale SSH connections, deploy via Tailscale IP, and maintain Tailscale mesh network for SuperRoo VPS infrastructure
---

# Tailscale Skill

## When To Use

Use this skill when:

- The user asks to **deploy via Tailscale**, **use Tailscale SSH**, or **switch from direct IP to Tailscale**
- The user mentions **Tailscale IP**, **tailnet**, **mesh network**, or **Tailscale SSH**
- The user wants to **update SSH targets from public IP to Tailscale IP** for security
- The user says **"use tailscale from now on for global deployment"**
- The user wants to **add Tailscale to the auto-deployer** or any deploy script

## Tailscale Network Topology

```
┌─────────────────────┐         ┌─────────────────────┐
│   Local Machine     │         │   VPS (DigitalOcean) │
│   desktop-28f24pj   │◄───────►│   ubuntu-s-2vcpu     │
│   Windows           │  WireGuard │   Linux            │
│   100.111.69.127    │         │   100.64.175.88      │
└─────────────────────┘         └─────────────────────┘
```

## Key Information

| Item               | Value                                |
| ------------------ | ------------------------------------ |
| Local Tailscale IP | `100.111.69.127`                     |
| VPS Tailscale IP   | `100.64.175.88`                      |
| VPS Hostname       | `ubuntu-s-2vcpu-4gb-amd-nyc1`        |
| VPS Public IP      | `104.248.225.250`                    |
| SSH User           | `root`                               |
| SSH Key            | `C:\Users\User\.ssh\id_superroo_vps` |
| Connection         | Direct (not relayed)                 |

## SSH via Tailscale

When deploying via Tailscale, use the **Tailscale IP** (`100.64.175.88`) instead of the public IP (`104.248.225.250`).

### SSH Command Template

```bash
SSH_KEY="C:\\Users\\User\\.ssh\\id_superroo_vps"
SSH_TARGET="root@100.64.175.88"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i ${SSH_KEY}"

# Test connection
timeout 15 ssh ${SSH_OPTS} ${SSH_TARGET} "echo 'Tailscale SSH OK'"

# Run command
timeout 30 ssh ${SSH_OPTS} ${SSH_TARGET} "cd /opt/superroo2 && git pull"
```

### SCP via Tailscale

```bash
timeout 30 scp ${SSH_OPTS} local-file "${SSH_TARGET}:/remote/path"
```

## Files That Need Tailscale IP Updates

When switching from public IP to Tailscale IP, update these files:

| File                                 | Current IP        | New IP          |
| ------------------------------------ | ----------------- | --------------- |
| `cloud/remote-deploy-dashboard.sh`   | `104.248.225.250` | `100.64.175.88` |
| `cloud/worker/autoDeployer.js`       | `104.248.225.250` | `100.64.175.88` |
| `cloud/deploy-via-ssh.ps1`           | `104.248.225.250` | `100.64.175.88` |
| `cloud/deploy-dashboard-windows.ps1` | `104.248.225.250` | `100.64.175.88` |
| `cloud/deploy-dashboard.sh`          | `104.248.225.250` | `100.64.175.88` |

## Verification

After switching to Tailscale, verify the connection:

```bash
# Test SSH via Tailscale
timeout 15 ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -i C:\\Users\\User\\.ssh\\id_superroo_vps root@100.64.175.88 "echo 'OK' && hostname && tailscale ip -4"

# Expected output:
# OK
# ubuntu-s-2vcpu-4gb-amd-nyc1
# 100.64.175.88
```

## Benefits of Tailscale over Public IP

1. **Encrypted by default** — WireGuard encryption, no need for separate VPN
2. **No open SSH port** — SSH port doesn't need to be exposed to the internet
3. **Direct connection** — Peer-to-peer when possible (currently direct, not relayed)
4. **Stable IP** — Tailscale IP doesn't change even if public IP changes
5. **Access control** — Tailscale ACLs provide additional security layer
6. **No SSH key rotation on IP change** — Tailscale IP is tied to the machine identity
