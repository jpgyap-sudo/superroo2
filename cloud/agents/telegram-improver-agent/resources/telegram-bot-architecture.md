# Telegram Bot Architecture Reference

## Core Files

| File | Purpose |
|------|---------|
| `cloud/api/telegramBot.js` | Main bot logic (~2900 lines) |
| `cloud/api/auth.js` | Authentication, session management, Telegram login |
| `cloud/api/telegramLearner.js` | ML-powered conversation learning |
| `cloud/api/telegramNotifier.js` | Real-time notifications with inline buttons |
| `cloud/api/api.js` | HTTP API server, provider management, job queue |
| `cloud/worker/worker.js` | BullMQ worker for processing agent jobs |

## Agent Directory

| Agent | Purpose |
|-------|---------|
| `cloud/agents/telegram-agent/` | The Telegram AI Agent (conversational) |
| `cloud/agents/telegram-improver-agent/` | This agent — monitors and improves the bot |
| `cloud/agents/skill-generator-agent/` | General skill generation from failed runs |
| `cloud/agents/superroo-debugger-agent/` | Debugging specialist |
| `cloud/agents/superroo-deployer-agent/` | Deployment specialist |
| `cloud/agents/superroo-tester-agent/` | Testing specialist |

## Data Files

| File | Purpose |
|------|---------|
| `cloud/data/chat-logs/YYYY-MM-DD.jsonl` | Daily chat logs (JSONL format) |
| `cloud/data/conversation-history.json` | Persistent conversation history |
| `cloud/data/group-workspaces.json` | Group-to-workspace bindings |
| `cloud/data/telegram-learner-state.json` | ML learner state |
| `cloud/data/telegram-conversations.jsonl` | ML conversation records |
| `cloud/data/telegram-patterns.json` | Detected conversation patterns |

## Key Functions in telegramBot.js

| Function | Line | Purpose |
|----------|------|---------|
| `handleUpdate()` | ~2650 | Main webhook handler — routes all updates |
| `askAI()` | ~898 | Enhanced AI with conversation context |
| `handleNaturalLanguageInstruction()` | ~2420 | Routes messages to specialist agents |
| `handleConsultant()` | ~1037 | Research/analysis mode |
| `handleLogin()` | ~1562 | Email OTP login flow |
| `handleVerifyEmailOtp()` | ~1687 | Verify OTP code |
| `getConversationContext()` | ~571 | Get recent conversation history |
| `addToConversationContext()` | ~588 | Add message to conversation history |
| `buildConversationSummary()` | ~670 | Build summary for BullMQ workers |
| `logChatExchange()` | ~710 | Log exchange to daily chat log |
| `detectIntent()` | ~2254 | Detect user intent from message text |
| `buildSystemPrompt()` | ~740 | Build AI system prompt |

## Key Functions in auth.js

| Function | Line | Purpose |
|----------|------|---------|
| `handleTelegramLogin()` | 357 | Login via Telegram with email OTP |
| `handleTelegramSessionCheck()` | 444 | Check if Telegram user has active session |
| `handleTelegramProjects()` | 534 | List projects for Telegram user |
| `handleTelegramProjectSelect()` | 568 | Select active project |
