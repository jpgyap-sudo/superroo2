# Telegram Bot Reply Analysis

## Overview

This document analyzes how the SuperRoo Telegram bot constructs and sends replies, identifies common patterns and issues, and proposes concrete fixes and upgrades.

## How the Bot Replies

### 1. Message Flow Architecture

```
User Message
    │
    ▼
Telegram Webhook ──► api.js (POST /telegram/webhook)
    │
    ▼
telegramBot.handleUpdate()
    │
    ├── Message? ──► detectIntent() ──► Command Router
    │                                      │
    │                                      ├── /ask ──► askAI()
    │                                      ├── /code ──► handleCode() ──► BullMQ
    │                                      ├── /deploy ──► handleDeploy()
    │                                      ├── /status ──► handleStatus()
    │                                      ├── /help ──► handleHelp()
    │                                      ├── /brain ──► handleBrain()
    │                                      ├── /consultant ──► handleConsultant()
    │                                      ├── NLP fallback ──► handleNaturalLanguageInstruction()
    │                                      └── Unknown ──► suggestCommandCorrection()
    │
    ├── Callback Query? ──► Callback Router
    │                          │
    │                          ├── menu_* ──► telegramMenu.handleMenuCallback()
    │                          ├── browser_* ──► telegramProjectBrowser
    │                          ├── taskboard_* ──► telegramTaskBoard
    │                          ├── agentmgr_* ──► telegramAgentManager
    │                          ├── preview_plan ──► handlePreviewPlan()
    │                          ├── approve_plan ──► handleApprovePlan()
    │                          ├── view_diff ──► handleViewDiff()
    │                          ├── deploy_staging ──► handleDeployStaging()
    │                          ├── deploy_production ──► handleDeployProduction()
    │                          ├── rollback_* ──► handleRollbackCallback()
    │                          ├── brain_* ──► Terminal Brain handlers
    │                          └── notif_* ──► telegramNotifier.handleNotificationCallback()
    │
    └── Other (poll answer, etc.) ──► ignored
```

### 2. Reply Methods Used

| Method                  | Function                 | Used For                             |
| ----------------------- | ------------------------ | ------------------------------------ |
| `sendMessage()`         | Direct text reply        | Command responses, errors            |
| `sendInlineKeyboard()`  | Text + buttons           | Approval requests, menus             |
| `editMessageText()`     | Update existing message  | Progress updates, callback responses |
| `answerCallbackQuery()` | Brief toast notification | Button click acknowledgments         |
| `sendChatAction()`      | "typing..." indicator    | Long-running operations              |

### 3. Key Reply Generation Points

#### a. `askAI()` (line 1146-1367)

- Builds system prompt from `buildSystemPrompt()` (961-1116)
- Includes conversation context, user preferences, frustration state
- Calls AI provider via fetch to OpenAI-compatible API
- Records interaction in `telegramLearner.recordInteraction()`
- Extracts lessons via `HermesClawAdapter.extractLessons()`
- **Issue**: No timeout on AI call — can hang indefinitely

#### b. `handleConsultant()` (line 1409-1586)

- Takes a question, calls AI, returns formatted answer
- Falls back to template response if AI fails
- **Issue**: Template fallback is generic and not helpful

#### c. `handleNaturalLanguageInstruction()` (line 3906-4259)

- Routes NLP input to appropriate agent
- Creates task, enqueues to BullMQ
- Sends confirmation message with task ID
- **Issue**: No estimated completion time in response

#### d. Command handlers (handleCode, handleDeploy, handleStatus, etc.)

- Each handler sends immediate acknowledgment
- Then processes asynchronously (BullMQ or direct)
- **Issue**: No follow-up notification when async task completes (relies on telegramNotifier)

#### e. Callback handlers (handleApprovePlan, handleDeployStaging, etc.)

- Edit the original message to show updated state
- Use `editMessageText()` with updated inline keyboards
- **Issue**: Some callbacks don't call `answerCallbackQuery()` — user sees no feedback

## Common Reply Problems

### Problem 1: No Timeout on AI Calls

**Location**: `askAI()` line 1216-1229
**Impact**: If AI provider is slow or down, bot appears unresponsive for minutes
**Fix**: Add AbortController timeout (30s default)

### Problem 2: Missing answerCallbackQuery

**Location**: Several callback handlers (handleDeployStaging, handleDeployProduction, handleRollbackCallback)
**Impact**: User clicks button, sees loading spinner forever, no feedback
**Fix**: Always call `answerCallbackQuery()` at the start of every callback handler

### Problem 3: Generic Error Messages

**Location**: `handleUpdate()` catch blocks, `handleNaturalLanguageInstruction()` error handler
**Impact**: User sees "An error occurred" without actionable information
**Fix**: Include error type, suggested next action, and support contact

### Problem 4: No Typing Indicator for Long Operations

**Location**: `handleCode()`, `handleDeploy()`, `handleConsultant()`
**Impact**: User thinks bot is not responding during AI calls
**Fix**: Call `sendChatAction(botToken, chatId, "typing")` before long operations

### Problem 5: Message Too Long

**Location**: `handleStatus()` builds long status messages, `handleHelp()` lists all commands
**Impact**: Telegram has 4096 character limit — messages get truncated
**Fix**: Use `splitLongMessage()` consistently and send multiple messages

### Problem 6: No Rate Limit Feedback

**Location**: No rate limiting exists
**Impact**: Users can spam commands, overwhelming the bot and API
**Fix**: Implement rate limiter and return friendly "please wait" messages

### Problem 7: Conversation Context Bloat

**Location**: `getConversationContext()` returns up to 50 messages
**Impact**: Token usage grows unbounded, AI responses become slow and expensive
**Fix**: Implement context windowing (last 10 messages + summary)

### Problem 8: No Retry Logic for Telegram API Calls

**Location**: `sendMessage()`, `editMessageText()`, etc.
**Impact**: Transient network failures cause message loss
**Fix**: Add exponential backoff retry (3 attempts)

## Proposed Fixes

### Fix 1: Add AbortController Timeout to AI Calls

```javascript
// In askAI(), wrap fetch with timeout
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 30000)
try {
    const res = await fetch(url, {
        method: "POST",
        headers: { ... },
        body: JSON.stringify({ ... }),
        signal: controller.signal,
    })
    // ... process response
} catch (err) {
    if (err.name === "AbortError") {
        return "I'm sorry, the AI provider took too long to respond. Please try again."
    }
    throw err
} finally {
    clearTimeout(timeoutId)
}
```

### Fix 2: Always answerCallbackQuery

```javascript
// Add to the START of every callback handler
await answerCallbackQuery(botToken, callbackQueryId, "Processing...")
```

### Fix 3: Structured Error Responses

```javascript
function formatError(error, command) {
	const errorType = error.code || "unknown"
	const suggestions = {
		timeout: "Try again with a simpler request",
		rate_limit: "Please wait a moment before trying again",
		auth: "Please /login first",
		not_found: "Check that the resource exists",
	}
	return [
		"⚠️ *Error processing " + command + "*",
		"",
		"Type: " + errorType,
		"Message: " + error.message,
		"",
		"💡 " + (suggestions[errorType] || "Try /help for available commands"),
	].join("\n")
}
```

### Fix 4: Typing Indicator Before Long Ops

```javascript
// Add to handleConsultant, handleCode, handleDeploy
sendChatAction(botToken, chatId, "typing").catch(() => {})
// Then start the actual processing
```

### Fix 5: Consistent Message Splitting

```javascript
// Use splitLongMessage for ALL long responses
const chunks = splitLongMessage(responseText, 4000)
for (const chunk of chunks) {
	await sendMessage(botToken, chatId, chunk)
}
```

### Fix 6: Rate Limit Feedback

```javascript
// In handleUpdate(), before processing
const rateCheck = rateLimiter.checkCommand(chatId)
if (!rateCheck.allowed) {
	const waitSeconds = Math.ceil(rateCheck.resetMs / 1000)
	await sendMessage(
		botToken,
		chatId,
		"⏳ *Please slow down!*\n\n" +
			"You've sent too many commands. " +
			"Please wait " +
			waitSeconds +
			" seconds before trying again.",
	)
	return
}
```

### Fix 7: Context Windowing

```javascript
function getConversationContext(chatId, maxMessages = 10) {
	const history = conversationHistory.get(chatId) || []
	if (history.length <= maxMessages + 5) return history.slice(-maxMessages)

	// Build summary of older messages
	const recent = history.slice(-maxMessages)
	const older = history.slice(0, -maxMessages)
	const summary = buildConversationSummary(older)

	return [{ role: "system", content: "Earlier conversation summary: " + summary }, ...recent]
}
```

### Fix 8: Retry Logic for Telegram API

```javascript
async function sendMessageWithRetry(botToken, chatId, text, opts, maxRetries = 3) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await sendMessage(botToken, chatId, text, opts)
		} catch (err) {
			if (attempt === maxRetries) throw err
			await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
		}
	}
}
```

## Upgrade Recommendations

### Priority 1: Add AbortController Timeout

- **Effort**: Low (1 file, ~10 lines)
- **Impact**: High — prevents bot from hanging
- **File**: `cloud/api/telegramBot.js` — `askAI()` function

### Priority 2: Add answerCallbackQuery to All Callbacks

- **Effort**: Low (add 1 line to ~8 handlers)
- **Impact**: High — eliminates spinner-on-button UX
- **Files**: `cloud/api/telegramBot.js` — callback handlers

### Priority 3: Implement Rate Limiter

- **Effort**: Medium (new file + integration)
- **Impact**: High — prevents abuse, improves stability
- **Files**: `cloud/api/telegramRateLimiter.js` (new) + `cloud/api/telegramBot.js` (integration)

### Priority 4: Add Typing Indicators

- **Effort**: Low (add 1 line to ~5 handlers)
- **Impact**: Medium — improves perceived responsiveness
- **File**: `cloud/api/telegramBot.js` — long-running handlers

### Priority 5: Structured Error Responses

- **Effort**: Low (new helper function)
- **Impact**: Medium — better user experience on errors
- **File**: `cloud/api/telegramBot.js`

### Priority 6: Context Windowing

- **Effort**: Medium (modify `getConversationContext()`)
- **Impact**: Medium — reduces token usage, improves response quality
- **File**: `cloud/api/telegramBot.js`

### Priority 7: Retry Logic for Telegram API

- **Effort**: Low (wrap existing send functions)
- **Impact**: Medium — reduces message loss
- **File**: `cloud/api/telegramBot.js`

### Priority 8: Message Splitting for All Long Responses

- **Effort**: Low (use existing `splitLongMessage()`)
- **Impact**: Low — prevents truncation
- **File**: `cloud/api/telegramBot.js` — status, help, log handlers

## Bot Reply Examples (Current vs Fixed)

### Scenario: User sends `/deploy production`

**Current behavior:**

1. Bot processes synchronously (no typing indicator)
2. If AI provider is slow, bot appears frozen for 60+ seconds
3. If error occurs: "An error occurred" (no details)
4. No callback acknowledgment on button clicks

**Fixed behavior:**

1. Bot immediately shows "typing..." indicator
2. Bot sends "Processing your deploy request..."
3. If AI is slow, AbortController times out at 30s with friendly message
4. On error: "⚠️ Error processing deploy\nType: timeout\nMessage: ...\n💡 Try again with a simpler request"
5. All buttons show "Processing..." toast on click

### Scenario: User sends `/status`

**Current behavior:**

1. Bot builds long status message (>4096 chars)
2. Message gets truncated by Telegram
3. User sees incomplete information

**Fixed behavior:**

1. Bot splits status into multiple messages (4000 chars each)
2. Each section is clearly labeled
3. User sees complete information across multiple messages

## Monitoring & Logging

To track reply quality, add the following metrics:

```javascript
// In telegramBot.js
const replyMetrics = {
	totalReplies: 0,
	failedReplies: 0,
	averageResponseTime: 0,
	timeouts: 0,
	rateLimited: 0,
}

function trackReply(success, responseTimeMs) {
	replyMetrics.totalReplies++
	if (!success) replyMetrics.failedReplies++
	replyMetrics.averageResponseTime =
		(replyMetrics.averageResponseTime * (replyMetrics.totalReplies - 1) + responseTimeMs) /
		replyMetrics.totalReplies
}
```

Export these metrics via the `/api/telegram/stats` endpoint for dashboard visibility.
