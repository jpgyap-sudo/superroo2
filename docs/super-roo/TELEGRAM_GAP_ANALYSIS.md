# Telegram Bot Gap Analysis

**Date:** 2026-05-20
**Author:** SuperRoo Code Agent
**Scope:** [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js), [`cloud/api/telegramNotifier.js`](cloud/api/telegramNotifier.js), [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js), [`cloud/api/telegramClassifier.js`](cloud/api/telegramClassifier.js), [`cloud/api/telegramPolicy.js`](cloud/api/telegramPolicy.js), [`cloud/api/telegramEngineer.js`](cloud/api/telegramEngineer.js), [`cloud/api/tgEndpoints.js`](cloud/api/tgEndpoints.js), [`cloud/api/auth.js`](cloud/api/auth.js), [`cloud/api/api.js`](cloud/api/api.js)

---

## Table of Contents

1. [Past Issues & Fixes — Lessons Learned](#1-past-issues--fixes--lessons-learned)
2. [Context Summary & Intelligence Gaps](#2-context-summary--intelligence-gaps)
3. [Architecture & Reliability Gaps](#3-architecture--reliability-gaps)
4. [UX & Workflow Gaps](#4-ux--workflow-gaps)
5. [Telegram Learner Gaps](#5-telegram-learner-gaps)
6. [Security & Auth Gaps](#6-security--auth-gaps)
7. [Monitoring & Observability Gaps](#7-monitoring--observability-gaps)
8. [Priority Matrix](#8-priority-matrix)
9. [Recommended Implementation Order](#9-recommended-implementation-order)

---

## 1. Past Issues & Fixes — Lessons Learned

### 1.1 PM2 `env_file` Not Loading (May 2026)

**Root Cause:** [`cloud/ecosystem.config.js`](cloud/ecosystem.config.js) used `env_file: "/opt/superroo2/cloud/.env"` but PM2 v7.0.1 does NOT support the `env_file` directive. The `TELEGRAM_BOT_TOKEN` was never in the API process, so every incoming webhook returned `{"ok":false,"error":"TELEGRAM_BOT_TOKEN not configured"}`.

**Fix:** Moved `TELEGRAM_BOT_TOKEN` and `BOSS_TELEGRAM_CHAT_ID` directly into the `env` block. Required `pm2 delete` + `pm2 start` (not `pm2 restart`, which reuses old env).

**Gap Status:** ✅ Fixed. But no automated test detects this regression. If someone re-adds `env_file`, the bot silently breaks again.

### 1.2 Auto-Mode Race Condition (Previous Session)

**Root Cause:** Auto mode chained phases (plan→code→apply→commit→deploy) in the worker BUT still sent approval buttons to the user in Telegram. User could click "Reject" after code was already applied.

**Fix:** Auto mode now skips approval buttons entirely. Manual mode still sends them.

**Gap Status:** ✅ Fixed.

### 1.3 Typing Indicator Leaks

**Root Cause:** `startAutoTypingInterval` had no timeout guard. If a worker crashed mid-task, the typing indicator kept running forever.

**Fix:** Added `setTimeout` cleanup in `stopAutoTypingInterval`.

**Gap Status:** ✅ Fixed.

### 1.4 Callback Button Duplication

**Root Cause:** New callback buttons (e.g., coder workflow) were handled in `telegramNotifier.handleCoderCallback` but NOT in `telegramBot.js` callback routing, causing "callback not handled" warnings.

**Fix:** Added handler registration in both files.

**Gap Status:** ✅ Fixed. But there's still no centralized callback registry — each new button type requires manual wiring in two places.

### 1.5 E2E Test Assertion Drift

**Root Cause:** E2E tests had hardcoded expected values that no longer matched actual code after refactoring (e.g., `keywordFallback("What is the architecture?")` returned `"feature_query"` not `"chat"`).

**Fix:** Updated test assertions.

**Gap Status:** ✅ Fixed. But no automated test suite runs on deploy.

---

## 2. Context Summary & Intelligence Gaps

### 2.1 Conversation Summary — No Semantic Compression

**Current State:** [`buildConversationSummary()`](cloud/api/telegramBot.js:1239) builds a summary from smart context + learned patterns + last N messages. It concatenates raw messages with no semantic compression — it just joins them with newlines.

**Gap:** When conversation history exceeds 10 messages, the summary is just a dump of the last N messages. There's no LLM-based summarization, no extraction of key decisions, no deduplication of repeated questions.

**Impact:** Context window fills with redundant history. AI responses become less relevant as history grows.

**Fix Suggestion:** Add an LLM-based summarization step when history > 15 messages. Use Ollama (free) to generate a 3-sentence compressed summary of key decisions and open questions. Store the summary instead of raw messages.

### 2.2 Smart Context — No Cross-Session Memory

**Current State:** [`getSmartContext()`](cloud/api/telegramBot.js:4206) tracks per-chatId state: `lastCommand`, `lastError`, `lastProject`, `lastIntent`, `messageCount`, `lastBrainResult`, `lastCommandOutput`, `lastFixApplied`, `workflowHistory`. This is in-memory only — lost on process restart.

**Gap:** If the API process restarts (PM2 auto-restart, deploy), ALL smart context is lost. The user has to re-establish context from scratch.

**Impact:** After any deploy or crash, the bot has no memory of what the user was working on, what errors occurred, or what the last command was.

**Fix Suggestion:** Persist smart context to [`cloud/data/telegram-bot-state.json`](cloud/data/telegram-bot-state.json) alongside conversation history. Load on startup. Add a TTL (e.g., 24h) to avoid stale context.

### 2.3 No Cross-Chat Context Sharing

**Current State:** Smart context is per-chatId. Group chat and private chat with the same user have separate contexts.

**Gap:** If a user starts a conversation in private chat, then continues in a group, the bot has no memory of the private conversation.

**Impact:** User must repeat themselves when switching between private and group chat.

**Fix Suggestion:** Add a user-level context store keyed by `telegramUserId` (not `chatId`). When a message arrives, merge user-level context with chat-level context.

### 2.4 No Intent Confidence Scoring

**Current State:** [`detectIntent()`](cloud/api/telegramBot.js:5272) uses keyword matching with hardcoded lists. [`handleNaturalLanguageInstruction()`](cloud/api/telegramBot.js:5628) uses LLM classifier via `telegramClassifier.classifyIntent()` with keyword fallback.

**Gap:** There's no confidence score attached to intent detection. If the classifier is unsure (e.g., "fix the deploy" could be `/fix` or `/deploy`), it picks one without indicating uncertainty.

**Impact:** Wrong routing happens silently. User gets a confusing response from the wrong agent.

**Fix Suggestion:** Add a confidence threshold (e.g., 0.7). Below threshold, send a disambiguation message: "Did you mean: /fix the deploy or /deploy the fix?"

### 2.5 No Conversation Topic Detection

**Current State:** The bot tracks `lastIntent` but not the conversation topic. It doesn't know if the user is discussing "deployment issues", "feature development", or "bug fixing" as a theme.

**Gap:** The system prompt is static — it doesn't adapt to the conversation's domain.

**Impact:** AI responses are generic rather than domain-tailored.

**Fix Suggestion:** Add topic detection (via LLM or keyword clustering) after every 3 messages. Store the detected topic in smart context. Inject topic into system prompt.

---

## 3. Architecture & Reliability Gaps

### 3.1 No Centralized Callback Registry

**Current State:** Callback query handling is spread across:
- [`handleUpdate()`](cloud/api/telegramBot.js:6751) — inline keyboard routing (lines 6800-8107)
- [`telegramNotifier.handleCoderCallback()`](cloud/api/telegramNotifier.js:896) — coder workflow callbacks
- [`telegramNotifier.handleNotificationCallback()`](cloud/api/telegramNotifier.js:1135) — notification approval/reject/diff/retry/logs/comment

**Gap:** Adding a new callback type requires modifying code in at least 2 files. There's no single registry of all callback data prefixes and their handlers.

**Impact:** High maintenance burden. Easy to miss a handler when adding new features.

**Fix Suggestion:** Create a centralized `CallbackRegistry` that maps callback data prefixes to handler functions. Both `telegramBot.js` and `telegramNotifier.js` register their handlers. The `handleUpdate` function dispatches to the registry.

### 3.2 No Webhook Secret Verification

**Current State:** The webhook endpoint at [`api.js:10530`](cloud/api/api.js:10530) accepts POSTs from any source. There's no `TELEGRAM_WEBHOOK_SECRET` verification.

**Gap:** Anyone who knows the webhook URL can send fake updates to the bot. Telegram supports `secret_token` in webhook setup for verification.

**Impact:** Potential for spoofed Telegram updates, though mitigated by the boss-only guard.

**Fix Suggestion:** Set `secret_token` when calling `setWebhook()`. Verify the `X-Telegram-Bot-Api-Secret-Token` header on every incoming webhook.

### 3.3 No Webhook Update Deduplication

**Current State:** Telegram may send the same update multiple times (at-least-once delivery). The bot processes every update unconditionally.

**Gap:** No deduplication by `update_id`. If Telegram retransmits an update, the bot processes it twice.

**Impact:** Duplicate command execution (e.g., double deploy, double code apply).

**Fix Suggestion:** Track processed `update_id`s in a bounded set (last 1000). Skip updates that have already been processed.

### 3.4 No Graceful Degradation for Provider Failures

**Current State:** [`askAI()`](cloud/api/telegramBot.js:1541) tries Ollama → cloud providers → Ollama with RAG → error message. If ALL providers fail, it returns a generic error.

**Gap:** There's no cached response mechanism. If the user asks the same question that was answered before a provider outage, the bot can't serve it.

**Impact:** Complete silence during provider outages.

**Fix Suggestion:** Add a response cache keyed by message hash + chat context. Serve cached responses when all providers are down. Include a "This is a cached response from [time]" disclaimer.

### 3.5 No Message Queue Persistence

**Current State:** BullMQ queue (`superroo-jobs`) is Redis-backed. If Redis goes down, all pending jobs are lost.

**Gap:** No Redis replication or persistence configuration visible in the codebase.

**Impact:** Job loss during Redis restart or crash.

**Fix Suggestion:** Enable Redis AOF persistence or configure Redis Sentinel for high availability.

---

## 4. UX & Workflow Gaps

### 4.1 No Progress Bar for Long Operations

**Current State:** [`sendCoderAutoProgress()`](cloud/api/telegramNotifier.js:821) sends phase transition messages ("Planning...", "Coding...", etc.) but there's no visual progress indicator.

**Gap:** Users don't know how much of a multi-phase task is complete or how long it will take.

**Impact:** Users may think the bot is stuck and send duplicate commands.

**Fix Suggestion:** Add estimated phase durations and a progress percentage. Use `editMessageText` to update a single progress message rather than sending new messages for each phase.

### 4.2 No Command History Navigation

**Current State:** The bot has `/again` to repeat the last command, but no way to browse or re-run earlier commands.

**Gap:** Users can't easily re-run a command from 10 messages ago without retyping it.

**Impact:** Frustration when needing to repeat complex commands.

**Fix Suggestion:** Add `/history` command that shows the last 10 commands as inline buttons. Clicking one re-runs it.

### 4.3 No Multi-Message Editing

**Current State:** The bot sends new messages for status updates. It doesn't edit previous bot messages to reduce clutter.

**Gap:** Long conversations become cluttered with bot status messages.

**Impact:** Users have to scroll through many bot messages to find the actual conversation.

**Fix Suggestion:** For status updates (progress, phase changes), edit the last bot message instead of sending a new one. Only send new messages for actual responses.

### 4.4 No Scheduled / Reminder Commands

**Current State:** The bot is purely reactive — it only responds to user messages.

**Gap:** No way to schedule a command (e.g., "/deploy at 3pm" or "remind me to check logs in 1 hour").

**Impact:** Users must remember to run commands manually.

**Fix Suggestion:** Add a simple scheduler using BullMQ delayed jobs. Parse natural language time expressions ("in 1 hour", "at 3pm") and schedule the command.

### 4.5 No Multi-Select in Inline Keyboards

**Current State:** Inline keyboards use single-select buttons. For example, project selection shows one project per button.

**Gap:** Users can't select multiple projects at once (e.g., "deploy to both staging and production").

**Impact:** Multi-target operations require multiple command invocations.

**Fix Suggestion:** Add multi-select mode with checkboxes. Use a "Done" button to confirm selection.

---

## 5. Telegram Learner Gaps

### 5.1 No Active Learning — Only Passive Recording

**Current State:** [`telegramLearner.recordInteraction()`](cloud/api/telegramLearner.js:116) records every interaction to a conversation buffer. [`detectPatterns()`](cloud/api/telegramLearner.js:263) runs periodically to find patterns. [`assessUserSatisfaction()`](cloud/api/telegramLearner.js:203) checks follow-up messages for positive/negative words.

**Gap:** The learner is purely passive — it records and analyzes, but never proactively asks for feedback or clarification. It never says "Did that answer help?" or "Would you like me to explain differently?"

**Impact:** The learner collects data but doesn't actively improve the interaction quality in real-time.

**Fix Suggestion:** Add proactive feedback requests after every 5th interaction. Use the satisfaction score to adjust response style (more detail vs. more concise).

### 5.2 No Pattern-Based Response Optimization

**Current State:** [`getUserPatterns()`](cloud/api/telegramLearner.js:375) returns detected patterns (frequent commands, common errors, peak hours, preferred agents). These are injected into `buildSmartContextPrompt()`.

**Gap:** The patterns are injected but there's no logic to actually optimize responses based on them. For example, if the user always runs `/deploy` after `/test`, the bot doesn't proactively suggest `/deploy` after a successful test.

**Impact:** Patterns are collected but not acted upon.

**Fix Suggestion:** Add a `getSuggestedNextActions()` function (already partially exists at line 437) that uses detected patterns to proactively suggest the next logical command. Wire it into the response flow.

### 5.3 No Response Quality Scoring

**Current State:** [`assessUserSatisfaction()`](cloud/api/telegramLearner.js:203) uses simple keyword matching (positive words like "thanks", "great" vs. negative words like "wrong", "error").

**Gap:** Keyword matching is brittle. "That's not what I meant" has no negative keywords. "Thanks for nothing" has a positive keyword. Sarcasm is undetected.

**Impact:** Satisfaction scores are unreliable.

**Fix Suggestion:** Use an LLM to assess satisfaction from the follow-up message. Ask: "On a scale of 1-5, how satisfied is the user with the previous response?" Store the score.

### 5.4 No Intent Accuracy Tracking

**Current State:** [`updateIntentAccuracy()`](cloud/api/telegramLearner.js:477) exists but is never called from the main message flow.

**Gap:** The bot never verifies if its intent classification was correct. It doesn't learn from misclassifications.

**Impact:** The same misclassification happens repeatedly.

**Fix Suggestion:** After routing a message to an agent, check if the user's follow-up indicates wrong routing (e.g., user says "no, I meant deploy not code"). Call `updateIntentAccuracy()` with the correction.

### 5.5 No Cross-User Pattern Learning

**Current State:** All pattern detection is per-user. Patterns from user A are never shared with user B.

**Gap:** If user A discovers a useful workflow (e.g., "always run tests before deploy"), user B can't benefit from that knowledge.

**Impact:** Each user's learning starts from scratch.

**Fix Suggestion:** Add an aggregated pattern store that anonymizes and merges patterns across users. Surface common workflows to new users.

---

## 6. Security & Auth Gaps

### 6.1 Session State Not Fully Persisted

**Current State:** [`scheduleStatePersist()`](cloud/api/telegramBot.js:1219) debounces persistence of `pendingEmailOtps`, `userTasks`, `sessions`, `callbackCommandTokens`. But some transient state (rate limit counters, typing intervals) is not persisted.

**Gap:** On process restart, rate limit counters reset (allowing burst attacks) and typing intervals leak.

**Impact:** Rate limiting is ineffective after restart. Typing indicators may never stop.

**Fix Suggestion:** Persist rate limit counters with a short TTL. Add a startup cleanup for any stale typing intervals.

### 6.2 No Command Rate Limit Per User Type

**Current State:** [`checkRateLimit()`](cloud/api/telegramBot.js:120) applies 10 commands/minute per chat uniformly.

**Gap:** Boss user (@jpgy888) has the same rate limit as everyone else. No distinction between interactive commands (need fast response) and heavy commands (deploy, code).

**Impact:** Boss user gets rate-limited during heavy usage. Heavy commands consume rate limit slots the same as simple queries.

**Fix Suggestion:** Implement tiered rate limiting: boss user = 30/min, authenticated users = 15/min, unauthenticated = 5/min. Separate rate limit buckets for light commands (/ask, /status) vs. heavy commands (/deploy, /code).

### 6.3 No Webhook IP Whitelist

**Current State:** The webhook endpoint accepts POSTs from any IP.

**Gap:** Telegram webhook requests come from known IP ranges (`91.108.4.0/22`, `91.108.56.0/22`, etc.). Any IP can send webhook requests.

**Impact:** Potential for DDoS or spoofed updates.

**Fix Suggestion:** Add IP whitelist check for Telegram's known IP ranges. Reject requests from other IPs with 403.

---

## 7. Monitoring & Observability Gaps

### 7.1 No Webhook Health Dashboard

**Current State:** Webhook health is checked manually via `/telegram/webhook-info` endpoint or SSH.

**Gap:** No automated monitoring of webhook latency, error rate, or pending update count.

**Impact:** Bot can be silently broken for hours (as happened with the PM2 env_file issue) without anyone noticing.

**Fix Suggestion:** Add a periodic health check that verifies:
- Webhook is set correctly
- `pending_update_count` is 0
- Last error date is recent
- Bot can send a test message to the boss user

Alert via the existing notification system if any check fails.

### 7.2 No Command Latency Tracking

**Current State:** [`logTelegramUsage()`](cloud/api/telegramBot.js:186) logs command usage but doesn't track latency.

**Gap:** No visibility into slow commands. A provider slowdown affects all users silently.

**Impact:** Degraded UX without detection.

**Fix Suggestion:** Add latency tracking to `logTelegramUsage()`. Alert if any command takes >30s. Track p50/p95/p99 latency per command type.

### 7.3 No Provider Fallback Metrics

**Current State:** [`askAI()`](cloud/api/telegramBot.js:1541) tries providers in order but doesn't log which provider was used or how many fallbacks occurred.

**Gap:** No visibility into provider reliability. If Ollama is always failing and falling back to DeepSeek, that's invisible.

**Impact:** Can't optimize provider routing without data.

**Fix Suggestion:** Log the provider chain result (which provider succeeded, how many fallbacks, latency per provider). Surface in a dashboard.

---

## 8. Priority Matrix

| # | Gap | Impact | Effort | Priority |
|---|-----|--------|--------|----------|
| 1 | Webhook secret verification (3.2) | Security — spoofed updates | Low | 🔴 Critical |
| 2 | Webhook update deduplication (3.3) | Reliability — duplicate commands | Low | 🔴 Critical |
| 3 | Smart context persistence (2.2) | UX — context loss on restart | Medium | 🔴 Critical |
| 4 | No webhook health dashboard (7.1) | Monitoring — silent failures | Medium | 🔴 Critical |
| 5 | No centralized callback registry (3.1) | Maintainability — high burden | Medium | 🟡 High |
| 6 | No intent confidence scoring (2.4) | UX — wrong routing | Medium | 🟡 High |
| 7 | No command latency tracking (7.2) | Observability — slow commands | Low | 🟡 High |
| 8 | No provider fallback metrics (7.3) | Observability — provider issues | Low | 🟡 High |
| 9 | No cross-session memory (2.3) | UX — context fragmentation | Medium | 🟡 High |
| 10 | No progress bar for long ops (4.1) | UX — perceived stuck | Low | 🟢 Medium |
| 11 | No pattern-based optimization (5.2) | Intelligence — unused patterns | Medium | 🟢 Medium |
| 12 | No response quality scoring (5.3) | Intelligence — unreliable metrics | Medium | 🟢 Medium |
| 13 | No intent accuracy tracking (5.4) | Intelligence — no learning | Medium | 🟢 Medium |
| 14 | No conversation topic detection (2.5) | Intelligence — generic responses | Medium | 🟢 Medium |
| 15 | No LLM-based summary compression (2.1) | Intelligence — context waste | Medium | 🟢 Medium |
| 16 | No active learning (5.1) | Intelligence — passive only | Medium | 🟢 Medium |
| 17 | Tiered rate limiting (6.2) | UX — boss rate limited | Low | 🟢 Medium |
| 18 | No command history navigation (4.2) | UX — can't re-run | Low | 🟢 Medium |
| 19 | No multi-message editing (4.3) | UX — clutter | Low | 🟢 Medium |
| 20 | No scheduled commands (4.4) | Feature — missing capability | Medium | 🔵 Low |
| 21 | No cross-user patterns (5.5) | Intelligence — isolated learning | High | 🔵 Low |
| 22 | No multi-select keyboards (4.5) | UX — single-select only | Medium | 🔵 Low |
| 23 | No webhook IP whitelist (6.3) | Security — DDoS mitigation | Low | 🔵 Low |
| 24 | No response cache (3.4) | Reliability — provider outage | High | 🔵 Low |
| 25 | No Redis persistence (3.5) | Reliability — job loss | High | 🔵 Low |
| 26 | No automated regression test (1.1) | Reliability — silent regression | Medium | 🔵 Low |

---

## 9. Recommended Implementation Order

### Phase 1 — Critical Fixes (Week 1)

1. **Webhook secret verification** — Set `secret_token` on webhook, verify `X-Telegram-Bot-Api-Secret-Token` header
2. **Webhook update deduplication** — Track processed `update_id`s, skip duplicates
3. **Smart context persistence** — Save/load smart context to/from `cloud/data/telegram-bot-state.json`
4. **Webhook health dashboard** — Add periodic health check with alerting

### Phase 2 — Intelligence & UX (Week 2)

5. **Centralized callback registry** — Create `CallbackRegistry` to eliminate dual-file wiring
6. **Intent confidence scoring** — Add confidence threshold + disambiguation
7. **Command latency tracking** — Add latency to usage logs
8. **Provider fallback metrics** — Log provider chain results
9. **Cross-session memory** — Add user-level context store

### Phase 3 — Learner Enhancement (Week 3)

10. **LLM-based summary compression** — Replace raw message dump with compressed summary
11. **Conversation topic detection** — Add topic tracking + adaptive system prompt
12. **Response quality scoring** — Replace keyword matching with LLM assessment
13. **Intent accuracy tracking** — Wire `updateIntentAccuracy()` into message flow
14. **Pattern-based response optimization** — Act on detected patterns proactively

### Phase 4 — Polish & Scale (Week 4)

15. **Progress bar for long operations** — Edit single message with progress updates
16. **Command history navigation** — `/history` command with inline buttons
17. **Multi-message editing** — Edit instead of send for status updates
18. **Tiered rate limiting** — Different limits per user type and command type
19. **Active learning** — Proactive feedback requests

### Phase 5 — Nice-to-Have (Future)

20. **Scheduled commands** — BullMQ delayed jobs for `/schedule`
21. **Cross-user patterns** — Aggregated pattern store
22. **Multi-select keyboards** — Checkbox mode for inline keyboards
23. **Webhook IP whitelist** — Telegram IP range filtering
24. **Response cache** — Serve cached responses during provider outages
25. **Redis persistence** — AOF persistence or Sentinel
26. **Automated regression test** — E2E test suite for Telegram

---

## Appendix: Key Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Webhook handler | [`cloud/api/api.js`](cloud/api/api.js) | 10530-10587 |
| Message routing | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 6751-8107 |
| AI response pipeline | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 1541-1814 |
| Smart context | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 4206-4276 |
| Conversation summary | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 1239-1292 |
| Intent detection | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 5272-5383 |
| NLP routing | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 5628-6318 |
| Rate limiting | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 120-136 |
| Session management | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 854-950 |
| Message sending | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 569-632 |
| Callback query routing | [`cloud/api/telegramBot.js`](cloud/api/telegramBot.js) | 6800-8107 |
| Coder callbacks | [`cloud/api/telegramNotifier.js`](cloud/api/telegramNotifier.js) | 896-1113 |
| Notification callbacks | [`cloud/api/telegramNotifier.js`](cloud/api/telegramNotifier.js) | 1135-1333 |
| Learner recording | [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js) | 116-170 |
| Pattern detection | [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js) | 263-313 |
| User patterns | [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js) | 375-428 |
| Satisfaction assessment | [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js) | 203-257 |
| Intent accuracy | [`cloud/api/telegramLearner.js`](cloud/api/telegramLearner.js) | 477-486 |
| PM2 config | [`cloud/ecosystem.config.js`](cloud/ecosystem.config.js) | 48-98 |
