---
name: n8n
description: 🔄 n8n — Integrate n8n workflow automation (triggers, nodes, webhooks, AI agents, Telegram, Supabase, VPS deployment) into SuperRoo apps
---

# n8n Skill

## When To Use

Use this skill when the user asks to integrate n8n workflow automation, create automated pipelines, set up n8n with SuperRoo services, or build no-code/low-code automations that connect SuperRoo's APIs, Telegram bot, Supabase, or VPS infrastructure.

Also use this skill when tasks involve:

- Setting up n8n on the SuperRoo VPS (`104.248.225.250`) or local Docker
- Creating n8n workflows that trigger from SuperRoo events (deployments, test results, bug reports)
- Connecting n8n to SuperRoo's Telegram bot for automated notifications and approvals
- Building AI agent workflows in n8n using OpenAI/DeepSeek/Anthropic nodes
- Integrating n8n with Supabase (PostgreSQL, Auth, Storage, Realtime)
- Creating webhook-based integrations between n8n and SuperRoo's cloud API at [`cloud/api/api.js`](cloud/api/api.js)
- Automating DevOps pipelines (PM2 restarts, log monitoring, health checks) via [`cloud/ecosystem.config.js`](cloud/ecosystem.config.js)
- Building approval workflows that route through Telegram via [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js)
- Scheduling recurring tasks (daily reports, log rotation, backup jobs)
- Connecting n8n to external services (GitHub, Slack, Email, SMS, CRM)
- Routing through the OpenClaw classifier/pipeline at [`cloud/api/telegramClassifier.js`](cloud/api/telegramClassifier.js) and [`cloud/api/telegramPolicy.js`](cloud/api/telegramPolicy.js)

## Core Concepts

### n8n Architecture

n8n is a fair-code workflow automation tool built on:

- **Workflows**: Directed acyclic graphs (DAGs) of nodes connected by edges
- **Nodes**: Individual automation steps (trigger, action, or logic)
- **Triggers**: Nodes that start workflows (webhook, schedule, event, poll)
- **Credentials**: Securely stored API keys and connection configs
- **Executions**: Individual runs of a workflow with full input/output logging
- **Webhooks**: HTTP endpoints that trigger workflows on POST/PUT/DELETE requests

### Node Types

| Type                | Purpose                       | Examples                                                              |
| ------------------- | ----------------------------- | --------------------------------------------------------------------- |
| **Trigger Nodes**   | Start workflows automatically | Webhook, Schedule (Cron), RSS, Email (IMAP), Telegram Trigger         |
| **Action Nodes**    | Perform operations            | HTTP Request, Supabase, Telegram, OpenAI, GitHub, Slack, Email (SMTP) |
| **Logic Nodes**     | Control flow                  | IF, Switch, Merge, Split, Loop, Wait, Code (JavaScript/Python)        |
| **Transform Nodes** | Manipulate data               | Set, Remove Duplicates, Summarize, Item Lists, XML/JSON Convert       |

### Execution Modes

- **Production**: Runs on n8n server with full persistence and error recovery
- **Manual**: Test-run a workflow from the editor with sample data
- **Retry**: Re-run a failed execution from the point of failure

## SuperRoo + n8n Integration Patterns

### Pattern 1: Telegram-Triggered Workflows

```
Telegram User → SuperRoo Bot → n8n Webhook Node → Workflow → Action
```

1. User sends command to SuperRoo Telegram bot
2. Bot detects intent via [`telegramClassifier.js`](cloud/api/telegramClassifier.js) (OpenClaw LLM classifier)
3. Bot routes through [`telegramPolicy.js`](cloud/api/telegramPolicy.js) for safety checks
4. Bot calls n8n webhook URL with intent data from [`telegramBot.js`](cloud/api/telegramBot.js)
5. n8n workflow executes the automation
6. Result sent back via Telegram Bot API or SuperRoo API

**Setup**:

- Create an n8n Webhook node (POST, production URL)
- Configure [`telegramBot.js`](cloud/api/telegramBot.js) `handleNaturalLanguageInstruction()` to call the webhook for specific intents
- Add `N8N_WEBHOOK_BASE_URL` to VPS environment or `.env`

### Pattern 2: SuperRoo Event → n8n Automation

```
SuperRoo Event (deploy/test/bug) → SuperRoo API → n8n Webhook → Workflow
```

1. SuperRoo completes an action (deploy, test run, bug report)
2. SuperRoo API sends POST to n8n webhook with event payload via [`api.js`](cloud/api/api.js)
3. n8n workflow processes the event (notify Telegram, log to Supabase, create GitHub issue)

**Setup**:

- Add n8n webhook URLs to SuperRoo's notification system in [`api.js`](cloud/api/api.js)
- Use the existing Telegram notification infrastructure at [`telegramBot.js`](cloud/api/telegramBot.js) `sendMessage()` / `sendInlineKeyboard()`

### Pattern 3: Scheduled SuperRoo Operations

```
n8n Cron Trigger → HTTP Request Node → SuperRoo API → Action
```

1. n8n cron triggers at scheduled interval
2. HTTP Request node calls SuperRoo API endpoints at `https://dev.abcx124.xyz/api/`
3. SuperRoo executes the operation (run tests, check logs, restart workers)
4. n8n processes the response (send report, log results)

**Setup**:

- Create n8n Schedule Trigger node
- Use HTTP Request node with SuperRoo API Bearer token (Telegram bot token)
- Available endpoints:
    - `GET /api/system/stats` — System health (CPU, memory, disk, Docker)
    - `POST /api/tg/read-logs` — Read recent logs (`limit` param)
    - `POST /api/tg/run-tests` — Execute test suite
    - `POST /api/tg/debug-plan` — Generate debug plan for an issue
    - `POST /api/tg/restart-worker` — Restart PM2 worker process
    - `POST /api/tg/deploy-status` — Check deployment status
    - `GET /api/system/docker` — Docker container stats

### Pattern 4: AI Agent Pipeline (OpenClaw Integration)

```
n8n AI Agent Node → DeepSeek/OpenAI → SuperRoo API → Action
```

1. n8n AI Agent node receives input (from webhook, Telegram, or cron)
2. LLM processes the request (classify intent, generate response) using DeepSeek API
3. n8n calls SuperRoo API to execute the action via `/api/tg/*` endpoints
4. Result returned to the user via Telegram or webhook

**Setup**:

- Configure DeepSeek credentials in n8n (reuse `DEEPSEEK_API_KEY` from SuperRoo providers)
- Use SuperRoo's existing provider configs from [`api.js`](cloud/api/api.js) `PROVIDERS` array
- Route through `/api/tg/*` endpoints for execution
- For AI classification, mirror the OpenClaw pattern from [`telegramClassifier.js`](cloud/api/telegramClassifier.js)

### Pattern 5: Approval Workflow via Telegram Inline Keyboards

```
n8n Workflow → Telegram: Send Inline Keyboard → User Approves/Rejects → n8n Webhook Response → Continue/Fail
```

1. n8n workflow reaches an approval step
2. Sends inline keyboard via Telegram Bot API using `sendInlineKeyboard()` pattern from [`telegramBot.js`](cloud/api/telegramBot.js)
3. User clicks Approve/Reject
4. Callback data routes back to n8n webhook
5. n8n continues or fails the workflow based on approval

**Setup**:

- Create n8n Webhook node for receiving callback responses
- Use Telegram Send Message node with inline keyboard markup
- Configure callback data to include n8n execution ID for correlation

## Deployment

### Option 1: Docker on VPS (Recommended)

Deploy n8n on the SuperRoo VPS (`104.248.225.250`) using Docker Compose alongside existing services.

**Create [`cloud/docker-compose.n8n.yml`](cloud/docker-compose.n8n.yml)**:

```yaml
version: "3.8"
services:
    n8n:
        image: n8nio/n8n:latest
        container_name: n8n
        restart: unless-stopped
        ports:
            - "127.0.0.1:5678:5678"
        environment:
            - N8N_HOST=n8n.abcx124.xyz
            - N8N_PORT=5678
            - N8N_PROTOCOL=https
            - WEBHOOK_URL=https://n8n.abcx124.xyz
            - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
            - DB_TYPE=postgresdb
            - DB_POSTGRESDB_HOST=${SUPABASE_DB_HOST}
            - DB_POSTGRESDB_PORT=5432
            - DB_POSTGRESDB_DATABASE=${SUPABASE_DB_NAME:-postgres}
            - DB_POSTGRESDB_USER=${SUPABASE_DB_USER:-postgres}
            - DB_POSTGRESDB_PASSWORD=${SUPABASE_DB_PASSWORD}
            - N8N_METRICS=true
            - N8N_METRICS_INCLUDE_DEFAULT_METRICS=true
            - N8N_BASIC_AUTH_ACTIVE=true
            - N8N_BASIC_AUTH_USER=${N8N_BASIC_AUTH_USER:-admin}
            - N8N_BASIC_AUTH_PASSWORD=${N8N_BASIC_AUTH_PASSWORD}
            - EXECUTIONS_DATA_PRUNE=true
            - EXECUTIONS_DATA_MAX_AGE=168
            - N8N_EVENT_BUS_ENABLED=true
            - N8N_EVENT_BUS_LOG_FILE=/var/log/n8n/events.log
        volumes:
            - n8n_data:/home/node/.n8n
            - /opt/superroo2/cloud/logs/n8n:/var/log/n8n
        networks:
            - superroo_network
        logging:
            driver: "json-file"
            options:
                max-size: "10m"
                max-file: "3"

volumes:
    n8n_data:

networks:
    superroo_network:
        external: true
```

**Deploy**:

```bash
# Copy to VPS
scp cloud/docker-compose.n8n.yml root@104.248.225.250:/opt/superroo2/cloud/

# SSH into VPS
ssh root@104.248.225.250

# Create logs directory
mkdir -p /opt/superroo2/cloud/logs/n8n

# Set environment variables in /opt/superroo2/.env
echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> /opt/superroo2/.env
echo "N8N_BASIC_AUTH_PASSWORD=$(openssl rand -hex 16)" >> /opt/superroo2/.env

# Start n8n
cd /opt/superroo2/cloud
docker compose -f docker-compose.n8n.yml up -d

# Check logs
docker compose -f docker-compose.n8n.yml logs -f
```

**Nginx reverse proxy config** — Add to [`cloud/nginx-dashboard.conf`](cloud/nginx-dashboard.conf):

```nginx
# n8n reverse proxy
location /n8n/ {
    proxy_pass http://127.0.0.1:5678/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

Then reload nginx:

```bash
sudo cp /opt/superroo2/cloud/nginx-dashboard.conf /etc/nginx/sites-enabled/dashboard
sudo nginx -t && sudo systemctl reload nginx
```

### Option 2: PM2 Process (Lightweight)

Add n8n as a PM2 process in [`cloud/ecosystem.config.js`](cloud/ecosystem.config.js):

```javascript
{
    name: "n8n",
    script: "n8n",
    interpreter: "none",
    cwd: "/opt/superroo2/cloud",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    exp_backoff_restart_delay: 1000,
    max_restarts: 10,
    restart_delay: 5000,
    min_uptime: 10000,
    kill_timeout: 15000,
    env: {
        N8N_PORT: 5678,
        WEBHOOK_URL: "https://n8n.abcx124.xyz",
        N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY,
        DB_TYPE: "postgresdb",
        DB_POSTGRESDB_HOST: process.env.SUPABASE_DB_HOST,
        DB_POSTGRESDB_PORT: "5432",
        DB_POSTGRESDB_DATABASE: "postgres",
        DB_POSTGRESDB_USER: "postgres",
        DB_POSTGRESDB_PASSWORD: process.env.SUPABASE_DB_PASSWORD,
        N8N_BASIC_AUTH_ACTIVE: "true",
        N8N_BASIC_AUTH_USER: "admin",
        N8N_BASIC_AUTH_PASSWORD: process.env.N8N_BASIC_AUTH_PASSWORD,
    },
    log_file: "/opt/superroo2/cloud/logs/n8n-combined.log",
    out_file: "/opt/superroo2/cloud/logs/n8n-out.log",
    error_file: "/opt/superroo2/cloud/logs/n8n-error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true,
}
```

Deploy:

```bash
ssh root@104.248.225.250
cd /opt/superroo2/cloud
npm install -g n8n
pm2 start ecosystem.config.js --only n8n
pm2 save
```

### Option 3: Docker Compose with Supabase (Local Dev)

```yaml
version: "3.8"
services:
    n8n:
        image: n8nio/n8n:latest
        restart: unless-stopped
        ports:
            - "5678:5678"
        environment:
            - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
            - DB_TYPE=postgresdb
            - DB_POSTGRESDB_HOST=supabase-db
            - DB_POSTGRESDB_PORT=5432
            - DB_POSTGRESDB_DATABASE=postgres
            - DB_POSTGRESDB_USER=postgres
            - DB_POSTGRESDB_PASSWORD=${SUPABASE_DB_PASSWORD}
            - N8N_METRICS=true
        volumes:
            - n8n_data:/home/node/.n8n
        depends_on:
            - supabase-db

volumes:
    n8n_data:
```

## Environment Variables

Add to VPS environment (managed in `/opt/superroo2/.env`):

```bash
# n8n Core
N8N_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
N8N_HOST=n8n.abcx124.xyz
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.abcx124.xyz
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<generate with: openssl rand -hex 16>

# Database (use existing Supabase PostgreSQL)
SUPABASE_DB_HOST=db.yourproject.supabase.co
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=<your-password>

# SuperRoo API (for n8n HTTP Request nodes)
SUPERROO_API_URL=https://dev.abcx124.xyz/api
SUPERROO_API_TOKEN=<telegram-bot-token>

# Optional: External Services
SLACK_WEBHOOK_URL=
GITHUB_TOKEN=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
```

## Security Considerations

1. **Encryption Key**: Store `N8N_ENCRYPTION_KEY` securely in `/opt/superroo2/.env` — it encrypts all credentials in the n8n database
2. **Network Isolation**: Bind n8n to `127.0.0.1:5678` (localhost only) and route through nginx reverse proxy
3. **Authentication**: Enable n8n basic auth in production:
    ```bash
    N8N_BASIC_AUTH_ACTIVE=true
    N8N_BASIC_AUTH_USER=admin
    N8N_BASIC_AUTH_PASSWORD=<strong-password>
    ```
4. **Webhook Security**: Validate incoming webhook payloads with HMAC signatures
5. **Rate Limiting**: Configure n8n's built-in rate limiter for production workflows:
    ```bash
    N8N_EXECUTIONS_TIMEOUT=3600
    N8N_EXECUTIONS_TIMEOUT_PRIORITY=600
    N8N_EXECUTIONS_DATA_PRUNE=true
    N8N_EXECUTIONS_DATA_MAX_AGE=168  # hours
    ```
6. **Audit Logging**: Enable n8n event bus for audit trail:
    ```bash
    N8N_EVENT_BUS_ENABLED=true
    N8N_EVENT_BUS_LOG_FILE=/var/log/n8n/events.log
    ```
7. **Data Pruning**: Auto-delete old execution data to prevent disk exhaustion on the VPS (1GB droplet)

## Useful n8n Workflow Templates

### Template 1: Deploy Health Monitor

Pings SuperRoo system stats every 5 minutes and alerts via Telegram if unhealthy.

```
[Cron: Every 5 min]
  → [HTTP Request: GET {{SUPERROO_API_URL}}/system/stats]
    → [Headers: { "Authorization": "Bearer {{SUPERROO_API_TOKEN}}" }]
  → [IF: {{$json.data.health}} !== "healthy"]
    → [Telegram: Send Message]
      → [Chat ID: {{BOSS_TELEGRAM_CHAT_ID}}]
      → [Text: "🚨 SuperRoo health check FAILED\nCPU: {{$json.data.cpu}}%\nMemory: {{$json.data.memory}}%\nDisk: {{$json.data.disk}}%"]
  → [ELSE]
    → [NoOp: Skip alert]
```

### Template 2: Automated Test Runner

Triggered via webhook, runs tests, reports results to Telegram.

```
[Webhook: POST /test-runner]
  → [HTTP Request: POST {{SUPERROO_API_URL}}/tg/run-tests]
    → [Headers: { "Authorization": "Bearer {{SUPERROO_API_TOKEN}}" }]
    → [Body: { "taskId": "{{$json.body.taskId}}" }]
  → [Wait: 30 seconds]
  → [HTTP Request: GET {{SUPERROO_API_URL}}/tg/read-logs?limit=50]
  → [IF: {{$json.data.failed}} > 0]
    → [Telegram: Send Message]
      → [Text: "❌ Tests FAILED\n{{$json.data.summary}}"]
    → [GitHub: Create Issue]
      → [Title: "Test Failure: {{$json.body.taskId}}"]
      → [Body: "{{$json.data.logs}}"]
  → [ELSE]
    → [Telegram: Send Message]
      → [Text: "✅ Tests PASSED\n{{$json.data.summary}}"]
```

### Template 3: Log Aggregator to Supabase

Collects SuperRoo logs hourly and stores them in Supabase for analysis.

````
[Cron: Every hour]
  → [HTTP Request: POST {{SUPERROO_API_URL}}/tg/read-logs]
    → [Body: { "limit": 200 }]
  → [Code: Transform logs]
    → JavaScript:
      ```javascript
      const logs = $input.all();
      return logs.map(log => ({
        timestamp: new Date().toISOString(),
        level: log.level || 'info',
        message: log.message,
        source: log.source || 'superroo-api',
        raw: JSON.stringify(log)
      }));
      ```
  → [Supabase: Insert rows]
    → [Table: n8n_logs]
    → [Rows: {{$json}}]
````

### Template 4: Bug Report Pipeline

Takes a bug report from Telegram, generates a debug plan, and creates a GitHub issue.

```
[Telegram Trigger: /bug <description>]
  → [HTTP Request: POST {{SUPERROO_API_URL}}/tg/debug-plan]
    → [Body: { "issue": "{{$json.message.text}}" }]
  → [AI: Analyze bug]
    → [Model: deepseek-chat]
    → [Prompt: "Analyze this bug report and suggest root causes:\n{{$json.data.plan}}"]
  → [Telegram: Send Message]
    → [Text: "🔍 Debug Plan Generated\n{{$json.data.plan}}"]
  → [GitHub: Create Issue]
    → [Title: "Bug: {{$json.message.text}}"]
    → [Labels: ["bug", "automated"]]
```

### Template 5: Daily Summary Bot

Generates a daily summary of SuperRoo system health and sends it to the Telegram group.

```
[Cron: 9 AM daily (Asia/Singapore)]
  → [HTTP Request: GET {{SUPERROO_API_URL}}/system/stats]
  → [HTTP Request: GET {{SUPERROO_API_URL}}/system/docker]
  → [Supabase: Query yesterday's events]
    → [Query: SELECT COUNT(*), status FROM n8n_logs WHERE timestamp > NOW() - INTERVAL '24 hours' GROUP BY status]
  → [AI: Summarize]
    → [Prompt: "Create a brief daily summary from this data:\nSystem: {{$json[0]}}\nDocker: {{$json[1]}}\nEvents: {{$json[2]}}"]
  → [Telegram: Send Message to Group]
    → [Chat ID: <group-chat-id>]
    → [Text: "📊 Daily SuperRoo Summary\n{{$json.data}}"]
    → [Parse Mode: Markdown]
```

### Template 6: Worker Restart & Recovery

Monitors worker health and auto-restarts if unresponsive.

```
[Cron: Every 2 min]
  → [HTTP Request: GET {{SUPERROO_API_URL}}/system/stats]
  → [IF: {{$json.data.worker}} === "dead" OR {{$json.data.worker}} === undefined]
    → [HTTP Request: POST {{SUPERROO_API_URL}}/tg/restart-worker]
      → [Headers: { "Authorization": "Bearer {{SUPERROO_API_TOKEN}}" }]
    → [Telegram: Send Message]
      → [Text: "🔄 Worker was unresponsive — restart initiated\nResult: {{$json.data}}"]
    → [Wait: 30 seconds]
    → [HTTP Request: GET {{SUPERROO_API_URL}}/system/stats]
    → [IF: {{$json.data.worker}} !== "running"]
      → [Telegram: Send Message]
        → [Text: "🚨 Worker restart FAILED — manual intervention required"]
  → [ELSE]
    → [NoOp: Worker is healthy]
```

### Template 7: Multi-Project Deployment Pipeline

Orchestrates deployment across multiple SuperRoo projects with approval gates.

````
[Webhook: POST /deploy-pipeline]
  → [Code: Parse request]
    → JavaScript:
      ```javascript
      const body = $input.first().json.body;
      return {
        project: body.project,
        branch: body.branch || 'main',
        version: body.version,
        deployId: `deploy-${Date.now()}`
      };
      ```
  → [Telegram: Send Inline Keyboard]
    → [Text: "🚀 Deploy {{$json.project}} v{{$json.version}} to production?"]
    → [Buttons: [{"text":"✅ Approve","callback_data":"deploy:approve:{{$json.deployId}}"},{"text":"❌ Reject","callback_data":"deploy:reject:{{$json.deployId}}"}]]
  → [Webhook: Wait for callback response]
    → [Response Filter: {{$json.body.callback_data}} starts with "deploy:approve:{{$json.deployId}}"]
  → [HTTP Request: POST {{SUPERROO_API_URL}}/deploy]
    → [Body: { "project": "{{$json.project}}", "version": "{{$json.version}}" }]
  → [Telegram: Send Message]
    → [Text: "✅ Deployment complete\nProject: {{$json.project}}\nVersion: {{$json.version}}"]
````

## Troubleshooting

| Issue                         | Cause                               | Fix                                                                |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Webhook not triggering        | Network/firewall blocking port 5678 | Check VPS firewall: `ufw allow 5678` or bind to localhost only     |
| Workflow execution stuck      | Missing credentials                 | Verify credential names match node config in n8n editor            |
| Database connection failed    | Supabase connection string wrong    | Check `SUPABASE_DB_*` env vars in `/opt/superroo2/.env`            |
| PM2 process exits             | Missing global n8n install          | Run `npm install -g n8n` on VPS                                    |
| Webhook returns 404           | Wrong webhook URL                   | Use production URL from n8n editor, not test URL                   |
| Rate limit exceeded           | Too many executions                 | Adjust `N8N_EXECUTIONS_TIMEOUT` and concurrency settings           |
| n8n container won't start     | Port 5678 already in use            | Check with `ss -tlnp \| grep 5678` and kill conflicting process    |
| Disk space full               | Execution data not pruned           | Set `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168` |
| Telegram messages not sending | Wrong bot token or chat ID          | Verify `SUPERROO_API_TOKEN` matches Telegram bot token             |
| nginx 502 Bad Gateway         | n8n container not running           | Check `docker ps \| grep n8n` and restart if needed                |

## Resources

- [n8n Documentation](https://docs.n8n.io/)
- [n8n Nodes Reference](https://docs.n8n.io/integrations/builtin/credentials/)
- [n8n Docker Deployment](https://docs.n8n.io/hosting/installation/docker/)
- [n8n AI Agent Nodes](https://docs.n8n.io/advanced-ai/)
- [n8n Telegram Trigger Node](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramTrigger/)
- [SuperRoo API Reference](docs/resources/working-tree.md)
- [SuperRoo VPS Deployment](docs/super-roo/DIGITALOCEAN_VPS.md)
- [SuperRoo Telegram Bot](cloud/api/telegramBot.js) — Bot message/notification functions
- [SuperRoo API Endpoints](cloud/api/api.js) — All available REST endpoints
- [SuperRoo PM2 Ecosystem](cloud/ecosystem.config.js) — Process management config
- [SuperRoo Nginx Config](cloud/nginx-dashboard.conf) — Reverse proxy configuration
- [SuperRoo OpenClaw Classifier](cloud/api/telegramClassifier.js) — LLM intent classification
- [SuperRoo Safety Policy](cloud/api/telegramPolicy.js) — Action approval rules
- [SuperRoo Engineer Reply](cloud/api/telegramEngineer.js) — Senior engineer response formatter
