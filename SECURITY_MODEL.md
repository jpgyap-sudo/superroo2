# 🔐 SuperRoo Security Model

> **How SuperRoo protects your code, secrets, and infrastructure — from the VS Code extension to the cloud dashboard.**

---

## Security Principles

1. **Least Privilege** — Every agent, service, and user operates with the minimum permissions needed.
2. **Defense in Depth** — Multiple layers of security at every level: extension, API, database, network, and infrastructure.
3. **Encryption Everywhere** — Data is encrypted at rest and in transit. Secrets are never stored in plaintext.
4. **Audit Trail** — Every action is logged. Every commit and deployment is recorded in the append-only Commit & Deploy Log.
5. **Safe by Default** — Safety mode is enabled by default. Dangerous operations require explicit approval.

---

## Threat Model

| Threat                   | Mitigation                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Malicious code execution | Safety Manager, mode-based ACL, capability gating, approval workflows                              |
| API key leakage          | AES-256-GCM encrypted Secret Vault, environment variable fallback, masked display                  |
| Unauthorized API access  | JWT authentication, OTP verification, rate limiting, IP allowlisting (Telegram)                    |
| Data exfiltration        | Sandboxed execution, read-only mode for analysis agents, approval gates for destructive operations |
| Supply chain attack      | Lockfile verification (`pnpm-lock.yaml`), frozen installs, dependency scanning                     |
| SSH compromise           | Tailscale mesh VPN (no public IP exposure), key-based auth, automatic key rotation                 |
| Container escape         | Docker sandbox with resource limits, read-only root filesystem, no privileged mode                 |
| Memory corruption        | Atomic writes with file locking (`safeWriteJson`), append-only logs, rollback capability           |

---

## Layer 1: VS Code Extension

### Safety Manager

The [`SafetyManager`](src/super-roo/safety/SafetyManager.ts) is the gatekeeper for all agent operations:

- **Mode-based ACL**: Each mode (Code, Architect, Debug, Ask, etc.) has a defined set of allowed file patterns and capabilities.
- **Capability gating**: Agents must declare their capabilities. Operations outside declared capabilities are blocked.
- **Approval workflows**: Destructive operations (file deletion, environment modification, deployment) require explicit user approval.
- **Dangerous pattern detection**: The system scans for dangerous patterns in code before execution (e.g., `rm -rf /`, crypto miners, reverse shells).

### Secret Vault

API keys and secrets are stored using **AES-256-GCM encryption**:

- Keys are encrypted with a vault key derived from the OS keychain (Windows Credential Manager, macOS Keychain, Linux libsecret).
- Encrypted secrets are stored in `globalStorage` (VS Code's secure storage).
- Secrets are masked in the UI — only the last 4 characters are visible.
- Provider testers verify keys without exposing them.

### Approval System

| Operation                  | Approval Required         |
| -------------------------- | ------------------------- |
| File read                  | ❌ No                     |
| File write (existing)      | ❌ No (for allowed modes) |
| File create                | ❌ No                     |
| File delete                | ✅ Yes                    |
| Terminal command           | ✅ Yes (configurable)     |
| Environment variable write | ✅ Yes                    |
| Network request            | ✅ Yes (configurable)     |
| Deployment                 | ✅ Yes                    |
| Extension modification     | ✅ Yes                    |

---

## Layer 2: Cloud API

### Authentication

| Method            | Endpoint          | Use Case                             |
| ----------------- | ----------------- | ------------------------------------ |
| **JWT**           | `/api/auth/*`     | Dashboard login, API access          |
| **OTP**           | `/api/auth/otp/*` | One-time password for Telegram login |
| **Telegram HMAC** | `/api/telegram/*` | Telegram bot request verification    |
| **Bearer Token**  | `/api/brain/*`    | MCP server and AI agent access       |

### Rate Limiting

- **Per-IP**: 100 requests per minute per IP address
- **Per-Token**: 1000 requests per minute per authenticated token
- **Telegram IPs**: Whitelisted Telegram IP ranges bypass rate limits
- **Abuse detection**: Rapid repeated failures trigger temporary IP blocks

### Input Validation

- All request bodies are parsed and validated
- SQL injection prevention via parameterized queries (PostgreSQL)
- No `eval()` or dynamic code execution in API handlers
- File uploads are validated for type and size

---

## Layer 3: Database

### PostgreSQL + pgvector

- **Authentication**: Password-based with strong passwords (auto-generated)
- **Network**: Bound to Docker internal network (not exposed publicly)
- **Encryption**: TLS for external connections
- **Backup**: Automated pg_dump to encrypted storage
- **Schema**: Parameterized queries only — no raw string concatenation

### SQLite (Extension)

- **Location**: Stored in VS Code's `globalStorage` directory
- **Permissions**: Read/write only by the extension process
- **Backup**: Automatic backup on schema migration

---

## Layer 4: Network

### Tailscale Mesh VPN

**All SSH connections use Tailscale — never public IPs.**

```
┌──────────────┐     Tailscale     ┌──────────────────┐
│  Developer   │◄──── Encrypted ───►│  VPS (DigitalOcean) │
│  Machine     │     Mesh VPN      │  100.64.175.88   │
└──────────────┘                   └──────────────────┘
```

- **No open SSH ports**: The VPS firewall blocks all inbound traffic except HTTP/HTTPS (ports 80, 443).
- **Automatic key rotation**: Tailscale handles key rotation transparently.
- **ACLs**: Tailscale ACLs restrict which devices can SSH to the VPS.

### HTTPS / TLS

- **Dashboard**: TLS via Let's Encrypt (auto-renewed)
- **API**: TLS via Let's Encrypt (auto-renewed)
- **Internal services**: HTTP only (isolated on Docker network)
- **MCP Server**: HTTP only (bound to localhost)

---

## Layer 5: Infrastructure

### Docker Security

- **No privileged containers**: All containers run without `--privileged`
- **Read-only root filesystem**: Containers mount only required volumes
- **Resource limits**: Memory and CPU limits on every container
- **Health checks**: Every service has a health check — unhealthy containers are auto-restarted
- **Network isolation**: Services communicate over an internal Docker network

### VPS Hardening

- **Firewall**: UFW with default deny, only ports 80/443 open
- **Automatic updates**: Unattended-upgrades for security patches
- **Fail2ban**: Brute force protection for any exposed services
- **Monitoring**: Disk usage, memory, CPU, and service health alerts
- **Backup**: Daily encrypted backups to off-site storage

---

## Layer 6: Secrets Management

### Secret Vault Architecture

```
User enters API key
    │
    ▼
Encrypt with AES-256-GCM
    │
    ├──► Key derived from OS keychain
    │
    ▼
Store encrypted in globalStorage
    │
    ▼
On read: Decrypt → Use → Never log
```

### What's Encrypted

| Secret             | Storage                 | Encryption                |
| ------------------ | ----------------------- | ------------------------- |
| OpenAI API Key     | Secret Vault            | AES-256-GCM               |
| Anthropic API Key  | Secret Vault            | AES-256-GCM               |
| DeepSeek API Key   | Secret Vault            | AES-256-GCM               |
| Telegram Bot Token | Environment / Vault     | AES-256-GCM               |
| Database Password  | Environment             | At-rest (disk encryption) |
| SSH Keys           | File system (600 perms) | At-rest (disk encryption) |

### What's Never Stored

- Plaintext API keys in logs
- Plaintext API keys in error messages
- Plaintext API keys in the UI (masked)
- Session tokens in URLs
- Secrets in git history

---

## Layer 7: AI Agent Safety

### Agent Capability Declaration

Every agent declares its capabilities when registered:

```typescript
const coderAgent = {
	capabilities: ["read:file", "write:file", "execute:command", "search:code"],
	restrictions: ["no:delete", "no:env:write", "no:network:external"],
}
```

### Approval Gates

| Gate                  | Trigger                              | Resolution                     |
| --------------------- | ------------------------------------ | ------------------------------ |
| **File Delete**       | Agent attempts to delete a file      | User must approve              |
| **Environment Write** | Agent attempts to modify env vars    | User must approve              |
| **Network External**  | Agent attempts to reach external API | User must approve              |
| **Deploy**            | Agent attempts to deploy             | Consensus vote + user approval |
| **Dangerous Pattern** | Agent generates dangerous code       | Blocked + logged               |

### Safety Mode

- **SAFE** (default): All approval gates enabled. Agents cannot perform destructive operations without consent.
- **AUTO**: Approval gates are bypassed for trusted agents. Use with caution.
- **CUSTOM**: Per-operation approval configuration.

---

## Compliance & Auditing

### Commit & Deploy Log

Every code change and deployment is recorded in the append-only [`CommitDeployLog`](src/super-roo/product-memory/CommitDeployLog.ts):

```json
{
	"sha": "a1b2c3d4",
	"agent": "deepseek-coder",
	"type": "feature",
	"title": "Add predictive swarm debugging",
	"files": ["cloud/api/api.js", "cloud/orchestrator/..."],
	"features": ["predictive-swarm"],
	"timestamp": 1716000000000
}
```

### Lesson Obligation

Every agent must register a lesson intent before starting work and store a lesson after completing it. This creates an auditable trail of what was learned.

### Event Log

All system events are recorded in an append-only event log with:

- Timestamp (nanosecond precision)
- Source (agent, service, user)
- Event type
- Payload (sanitized — no secrets)

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly or use GitHub's private vulnerability reporting.

We take all reports seriously and will respond within 48 hours.

---

_Last updated: May 2026_
