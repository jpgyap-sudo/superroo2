# Skill: Chat Log Analysis

## Purpose
Analyze daily Telegram chat log files to identify patterns, failures, misunderstandings, and improvement opportunities.

## Log Format
Chat logs are stored as JSONL files at `cloud/data/chat-logs/YYYY-MM-DD.jsonl`.
Each line is a JSON object with:
- `t`: timestamp (epoch ms)
- `c`: chatId
- `r`: role ("user" | "assistant" | "system")
- `msg`: message content (truncated to 2000 chars)
- `m`: metadata object (may include intent, taskId, agentId, provider, error)

## Analysis Checklist

### 1. User Frustration Signals
- Repeated similar questions from the same user
- Messages containing: "wrong", "incorrect", "not what I asked", "again", "still", "fix this"
- Users correcting the bot's previous response
- Abandoned conversations (user stops responding after bot reply)

### 2. Bot Failure Patterns
- Error messages in assistant responses (e.g., "Sorry, I couldn't reach...")
- Bot asking for clarification on the same topic multiple times
- Bot giving incorrect or irrelevant answers
- Bot failing to understand intent (user asks for code, bot gives text response)
- Bot not maintaining context (user refers to previous message, bot doesn't understand)

### 3. Missing Capabilities
- Users asking for features the bot doesn't support
- Commands that don't exist but users try to use
- Questions about topics the bot has no knowledge of

### 4. Conversation Flow Issues
- Bot restarting conversation from scratch
- Bot not referencing previous messages
- Bot giving generic responses when context-specific answers are needed
- Long conversations where context is lost

## Output
For each analysis session, produce a structured report with:
1. Top 3 issues found (with evidence from logs)
2. Severity (critical/major/minor)
3. Suggested improvement type (skill update / code change / agent config change)
4. Priority score (1-10)
