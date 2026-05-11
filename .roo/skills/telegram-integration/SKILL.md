---
name: telegram-integration
description: 🤖 Telegram Bot — Integrate, manage, and troubleshoot the SuperRoo Telegram bot with ML-powered conversation learning, notification agent, group chat support, and agent routing
---

# Telegram Integration Skill

Provides comprehensive guidance for working with the SuperRoo Telegram Bot integration. Use when tasks involve the Telegram bot, group chat functionality, Telegram Agent, ML-powered conversation learning, Telegram Notification Agent, or any Telegram-related features.

## Architecture Overview

The Telegram bot system consists of these components:

### 1. Bot Entry Point
- **File**: [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) — Main bot logic (~2779 lines)
- **Webhook URL**: `https://dev.abcx124.xyz/api/telegram/webhook`
- **Bot username**: `@superroo_bot`
- **Bot token**: `8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ` (set via `TELEGRAM_BOT_TOKEN` env var)
- **API base**: `https://api.telegram.org/bot<token>/`

### 2. Authentication
- **File**: [`cloud/api/auth.js`](cloud/api/auth.js) — User auth, session management, Telegram login
- **OTP Login Flow**: Email OTP → verify → `handleTelegramLogin()` with `__email_otp_verified__` password marker
- **Session Guard**: Blocks slash commands without auth; natural language passes through
- **Boss-Only Guard**: Only `@jpgy888` (BOSS_USERNAME) can use the bot

### 3. AI Engine
- **`askAI(message, providers, chatId)`** — Enhanced AI function with:
  - Conversation context (last 20 messages per chat)
  - ML learning via `telegramLearner.recordInteraction()`
  - Full system knowledge via `buildSystemPrompt()`
  - 4096 max_tokens, 60s timeout
- **`handleNaturalLanguageInstruction()`** — Routes messages to agents via BullMQ
- **`handleConsultant()`** — Research/analysis mode

### 4. ML-Powered Telegram Learner
- **File**: [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js)
- Records conversations, detects patterns, scores response quality
- State files:
  - `cloud/data/telegram-learner-state.json`
  - `cloud/data/telegram-conversations.jsonl`
  - `cloud/data/telegram-patterns.json`
- Key functions: `recordInteraction()`, `suggestIntent()`, `detectPatterns()`, `assessUserSatisfaction()`

### 5. Telegram Notification Agent
- **File**: [`cloud/api/telegramNotifier.js`](cloud/api/telegramNotifier.js)
- Sends real-time notifications with inline action buttons (approve/reject/diff/retry)
- **API Endpoint**: `POST /telegram/notify` (via [`cloud/api/api.js`](cloud/api/api.js))
- Notification types: `task_started`, `task_complete`, `task_failed`, `approval_request`, `deploy`, `debug_complete`, `notification`
- Callback handling: Button presses routed via `handleNotificationCallback()` in `handleUpdate()`
- State tracking: `pendingApprovals` Map tracks approval requests per chat+task

### 6. Telegram Agent
- **Location**: [`cloud/agents/telegram-agent/`](cloud/agents/telegram-agent/)
- **Safety**: Read-only (canEditFiles: false, canPublish: false, canDeploy: false)
- **Skills**: conversation-flow.md, intent-analysis.md, code-context.md, telegram-response.md
- **Workflows**: analyze-and-respond.md, route-to-agent.md, research-and-answer.md
- **Resources**: superroo-architecture.md, project-context.md

### 7. BullMQ Queue & Worker
- **Queue name**: `superroo-jobs`
- **Dead-letter queue**: `superroo-jobs-dlq` — failed jobs are moved here for inspection
- **Redis URL**: Set via `REDIS_URL` env var
- **Worker**: [`cloud/worker/worker.js`](cloud/worker/worker.js)
- **Agent Runtime**: [`cloud/agent-runtime/agentRunner.js`](cloud/agent-runtime/agentRunner.js)

#### Worker Crash Resilience Features
The worker ([`cloud/worker/worker.js`](cloud/worker/worker.js)) includes:

| Feature | Description | Config |
|---------|-------------|--------|
| **Graceful Shutdown** | Drains jobs before exit on SIGTERM/SIGINT | Built-in |
| **Redis Circuit Breaker** | Pauses worker after 5 consecutive Redis failures | `WORKER_MAX_REDIS_FAILURES` (default: 5) |
| **Health Check Logging** | Periodic health status every 30s | `WORKER_HEALTH_CHECK_INTERVAL_MS` (default: 30000) |
| **Stalled Job Handling** | BullMQ built-in retry for stalled jobs (up to 3 times) | Built-in |
| **Telegram Notifications** | Sends job lifecycle events (completed/failed) to Telegram | Only for Telegram-originated jobs (`job.data.telegram.chatId`) |
| **Job Timeout** | Prevents hanging jobs with lock duration | `JOB_TIMEOUT_MS` (default: 600000ms = 10min) |
| **Dead-Letter Queue (DLQ)** | Failed jobs moved to `superroo-jobs-dlq` with original data, error, and stack trace | Automatic |
| **Auto-Recovery** | If worker is paused >5 minutes, forces Redis disconnect/reconnect cycle | `WORKER_MAX_PAUSE_DURATION_MS` (default: 300000ms) |
| **PM2 Auto-Restart** | PM2 restarts worker with exponential backoff on crash | Configured in `ecosystem.config.js` |

#### Worker Environment Variables
| Variable | Description |
|----------|-------------|
| `BOSS_TELEGRAM_CHAT_ID` | Boss chat ID for notifications (`8485794779`) |
| `API_BASE_URL` | Internal API URL (`http://127.0.0.1:8787`) |
| `WORKER_CONCURRENCY` | Number of concurrent jobs (default: 2) |
| `WORKER_MAX_REDIS_FAILURES` | Max Redis failures before pausing (default: 5) |
| `WORKER_HEALTH_CHECK_INTERVAL_MS` | Health check interval (default: 30000) |
| `JOB_TIMEOUT_MS` | Max job runtime before timeout (default: 600000) |
| `WORKER_MAX_PAUSE_DURATION_MS` | Max pause before forced reconnect (default: 300000) |

### 8. VSCode Extension Bot (TypeScript)
- **File**: [`src/telegram/bot.ts`](src/telegram/bot.ts) — TypeScript bot for VSCode extension
- **Tests**: [`src/telegram/__tests__/bot.test.ts`](src/telegram/__tests__/bot.test.ts)
- Uses polling instead of webhook

## Group Chat Behavior

### Current Rules
1. **No tagging required**: Bot responds to ALL messages in group chats conversationally
2. **@mention still works**: `@superroo_bot` can be used for explicit commands
3. **Boss-only**: Only `@jpgy888` can use the bot (others get "Access Restricted" message)
4. **Group binding**: `/specify <workspace>` binds a group to a project
5. **Auto workspace**: If group is bound, bot auto-selects the workspace for coding tasks
6. **Add restriction**: Only `@jpgy888` can add bot to groups; unauthorized adders cause bot to leave

### Group Chat Flow in `handleUpdate()` (lines 2495-2755)
1. Check `my_chat_member` for bot add/remove events
2. Check `callback_query` for inline keyboard presses (project selection + notification buttons)
3. Extract message text and entities
4. If group: strip `@superroo_bot` mention if present (but don't require it)
5. Parse command and arguments
6. If group and no slash command → treat as `/ask` (conversational)
7. Session guard: block slash commands without auth
8. Boss-only guard: block non-`@jpgy888` users
9. Route to command handler or natural language processor

### Known Group Chat Fixes (v1.10.0 — v1.11.0)

#### Fix 1: `/login` Markdown Parsing Error
- **Problem**: Group chat `/login` showed `Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 70`
- **Root Cause**: Telegram's markdown parser fails when `@superroo_bot` appears inside markdown text without escaping
- **Fix**: Escaped `@` as `\@` in the inline keyboard message at [`telegramBot.js:1465`](cloud/api/telegramBot.js:1465)
- **Before**: `"Tap below to open a private chat with @" + BOT_USERNAME + " and log in there."`
- **After**: `"Tap below to open a private chat with \\@" + BOT_USERNAME + " and log in there."`

#### Fix 2: Auth Session Not Shared Between Private Chat and Group Chat
- **Problem**: User logged in via private DM (chatId: `8485794779`) but group chat (chatId: `-1003861448169`) didn't recognize the session
- **Root Cause**: `checkAuthSession()` in [`telegramBot.js:483`](cloud/api/telegramBot.js:483) only matched exact `chatId`, but private chat and group chat have different IDs
- **Fix**: Added fallback in `checkAuthSession()` that tries without `chatId` when exact match fails. Refactored `handleTelegramSessionCheck()` in [`auth.js:444`](cloud/api/auth.js:444) to handle missing `telegramChatId` — sorts sessions by recency when no `chatId` provided
- **Flow**: First tries exact `chatId` match → if fails, tries without `chatId` → returns most recent active session

#### Fix 3: Messages Not Routed Through BullMQ from Group Chat
- **Problem**: Group chat messages like "how do i set project" were treated as AI queries (`/ask`) instead of being routed through BullMQ worker
- **Root Cause**: `handleNaturalLanguageInstruction()` checked for active project, and if none found, silently returned `false` → fell through to `handleAsk`
- **Fix**: Added helpful "No Active Project" message at [`telegramBot.js:2333`](cloud/api/telegramBot.js:2333) instead of silently falling through
- **Behavior**: Now shows clear guidance: "Please select a project first so I know which workspace to work on. Use `/projects` to view and select your projects."

#### Fix 4: Session Expiry & Session Guard Order (v1.11.0)
- **Problem**: Group chat still asked for login even after Fix 2 was deployed. Natural language messages like "hello" or "what's up" triggered "Authentication Required" instead of being answered conversationally.
- **Root Cause**: Two issues:
  1. **Session TTL too short**: `TELEGRAM_SESSION_TIMEOUT_MS` was 30 minutes. The session expired between uses, and since the user only interacts via group chat (not the private DM where the session was created), the session never got refreshed.
  2. **Session guard ran AFTER group chat `/ask` conversion**: At [`telegramBot.js:2604`](cloud/api/telegramBot.js:2604), group chat natural language messages were converted to `command = "/ask"` BEFORE the session guard at line 2633. Since `/ask` is not in `PUBLIC_COMMANDS`, the guard blocked it with "Authentication Required".
- **Fix**:
  1. [`auth.js:46`](cloud/api/auth.js:46): Increased `TELEGRAM_SESSION_TIMEOUT_MS` from `30 * 60 * 1000` (30 min) to `24 * 60 * 60 * 1000` (24 hours)
  2. [`telegramBot.js:2622`](cloud/api/telegramBot.js:2622): Moved the session guard BEFORE the group chat `/ask` conversion, so natural language messages (which don't start with `/`) bypass the guard entirely
  3. [`telegramBot.js:2636`](cloud/api/telegramBot.js:2636): Added group-specific hint to the "Authentication Required" message: "You can still chat with me naturally in this group without logging in"
- **Behavior**: Natural language messages in group chat now bypass auth entirely. Slash commands like `/projects`, `/code`, `/session` still require auth. Session lasts 24 hours after login.
- **Problem**: Group chat messages like "how do i set project" were treated as AI queries (`/ask`) instead of being routed through BullMQ worker
- **Root Cause**: `handleNaturalLanguageInstruction()` checked for active project, and if none found, silently returned `false` → fell through to `handleAsk`
- **Fix**: Added helpful "No Active Project" message at [`telegramBot.js:2333`](cloud/api/telegramBot.js:2333) instead of silently falling through
- **Behavior**: Now shows clear guidance: "Please select a project first so I know which workspace to work on. Use `/projects` to view and select your projects."

## Notification System

### How Notifications Work
1. **Task Created**: `handleCode()` or `handleNaturalLanguageInstruction()` calls `telegramNotifier.sendTaskStarted()` with inline "Check Status" button
2. **Task Complete**: Agents call `POST /telegram/notify` with `type: "task_complete"` to send notification with "View Diff", "Approve", "Reject" buttons
3. **Approval Request**: Agents call `POST /telegram/notify` with `type: "approval_request"` — user can approve/reject directly from Telegram
4. **Deploy**: Agents call `POST /telegram/notify` with `type: "deploy"` — shows deploy status with "Open Dashboard" button
5. **Debug Complete**: Agents call `POST /telegram/notify` with `type: "debug_complete"` — shows root cause and fix summary

### Notification API
```json
POST /telegram/notify
{
  "chatId": 8485794779,
  "type": "task_complete",
  "taskId": "TG-ABC123",
  "instruction": "Fix login bug",
  "result": {
    "changedFiles": 3,
    "linesAdded": 42,
    "outputSummary": "Fixed the timeout issue"
  }
}
```

### Callback Button Actions
| Button | Callback Data | Action |
|--------|--------------|--------|
| ✅ Approve | `notify:approve:<taskId>` | Marks approved, updates message |
| ❌ Reject | `notify:reject:<taskId>` | Marks rejected, updates message |
| 📄 View Diff | `notify:diff:<taskId>` | Shows diff instructions |
| 📊 Status | `notify:status:<taskId>` | Shows status instructions |
| 📋 Logs | `notify:logs:<taskId>` | Shows log instructions |
| 🔄 Retry | `notify:retry:<taskId>` | Re-queues the task |
| 🧪 Run Tests | `notify:test:<taskId>` | Runs tests |
| 💬 Comment | `notify:comment:<taskId>` | Opens comment flow |
| 🔙 Back | `notify:back:<taskId>` | Returns to main notification |

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot authentication token (`8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ`) |
| `BOSS_USERNAME` | Authorized user (default: `jpgy888`) |
| `BOT_USERNAME` | Bot username (default: `superroo_bot`) |
| `REDIS_URL` | Redis connection string for BullMQ |
| `SMTP_HOST` | SMTP server for email OTP |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From email address |

## Key Functions Reference

### telegramBot.js

| Function | Line | Purpose |
|----------|------|---------|
| `sendMessage()` | 202 | Send text message to chat |
| `sendInlineKeyboard()` | 278 | Send message with inline buttons |
| `editMessageText()` | 326 | Edit existing message |
| `setWebhook()` | 353 | Set Telegram webhook URL |
| `getWebhookInfo()` | 381 | Get current webhook status |
| `getSession()` | 416 | Get local session |
| `checkAuthSession()` | 482 | Check cloud auth session |
| `getConversationContext()` | 540 | Get conversation history |
| `addToConversationContext()` | 556 | Add message to history |
| `buildSystemPrompt()` | 577 | Build AI system prompt |
| `askAI()` | 726 | Enhanced AI with context |
| `handleAsk()` | 826 | Handle /ask command |
| `handleConsultant()` | 865 | Handle consultant/research |
| `handleCode()` | 1023 | Create coding task (now sends notification) |
| `handleNaturalLanguageInstruction()` | 2257 | Route NL to agents (now sends notification) |
| `detectIntent()` | 2137 | Detect message intent |
| `handleUpdate()` | 2495 | Main update handler |
| `handleEmailOtpLogin()` | 1500 | Email OTP login flow |
| `handleVerifyEmailOtp()` | 1570 | Verify OTP code |

### telegramNotifier.js

| Function | Purpose |
|----------|---------|
| `sendTaskStarted()` | Send task started notification with status button |
| `sendTaskComplete()` | Send task complete with diff/approve/reject buttons |
| `sendTaskFailed()` | Send task failed with retry/logs buttons |
| `sendApprovalRequest()` | Send approval request with approve/reject/diff/comment buttons |
| `sendDeployNotification()` | Send deploy status with dashboard/logs buttons |
| `sendDebugComplete()` | Send debug complete with approve/diff/test buttons |
| `sendNotification()` | Send generic notification with custom buttons |
| `handleNotificationCallback()` | Handle button press callbacks |
| `getApprovalStatus()` | Get pending approval status |

### telegramLearner.js

| Function | Purpose |
|----------|---------|
| `recordInteraction()` | Record conversation interaction |
| `recordConversation()` | Increment conversation counter |
| `assessUserSatisfaction()` | Analyze follow-up for satisfaction |
| `detectPatterns()` | Find common keywords per intent |
| `suggestIntent()` | Return sorted intent suggestions |
| `updateIntentAccuracy()` | Track intent classification accuracy |
| `getStats()` | Return learning statistics |
| `startPeriodicTraining()` | Run periodic pattern detection |

## Testing

- **E2E Tests**: [`cloud/test-e2e-deploy.js`](cloud/test-e2e-deploy.js) — 45 tests covering OTP, Telegram Learner, intent detection, bot exports, askAI, NL routing, agent files
- **VSCode Bot Tests**: [`src/telegram/__tests__/bot.test.ts`](src/telegram/__tests__/bot.test.ts) — Tests for TypeScript bot
- Run tests: `cd cloud && node test-e2e-deploy.js`

## Deployment

1. SCP modified files to VPS:
   ```
   scp cloud/api/telegramBot.js root@104.248.225.250:/opt/superroo2/cloud/api/
   scp cloud/api/telegramNotifier.js root@104.248.225.250:/opt/superroo2/cloud/api/
   scp cloud/api/api.js root@104.248.225.250:/opt/superroo2/cloud/api/
   scp cloud/api/telegramLearner.js root@104.248.225.250:/opt/superroo2/cloud/api/
   ```
2. Restart PM2: `pm2 restart superroo-api`
3. Check logs: `pm2 logs superroo-api --lines 50`
4. Verify webhook: `curl -s 'https://api.telegram.org/bot8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ/getWebhookInfo'`
5. Test notification: `curl -s -X POST 'http://localhost:8787/telegram/notify' -H 'Content-Type: application/json' -d '{"chatId":8485794779,"type":"notification","taskId":"test","result":{"title":"Test","message":"Hello!"}}'`
