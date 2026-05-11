# Skill: Code Upgrade Request

## Purpose
When chat log analysis reveals that the Telegram bot needs code changes (not just skill/resource updates), create a clear, actionable request for the coder agent.

## When to Request Code Changes

### Triggers
1. **Bug in bot logic**: e.g., OTP verification fails, session handling broken
2. **Missing feature**: Users ask for something the bot should do but can't
3. **Performance issue**: Bot is slow, crashes, or times out
4. **Integration gap**: Bot needs to connect to a new service or API
5. **Architecture problem**: Current design causes repeated failures

### NOT Code Changes (handle yourself)
- Missing knowledge → create/update skill file
- Poor response quality → update workflow
- Outdated info → update resource file
- Wrong agent routing → update agent config

## Code Upgrade Request Format

```
## Code Upgrade Request

### Issue
[Clear description of the problem]

### Evidence
[Quotes from chat logs showing the issue]

### Expected Behavior
[What the bot should do instead]

### Suggested Change
[Specific file(s) to modify and what to change]

### Files Affected
- cloud/api/telegramBot.js (function X at line Y)
- cloud/api/auth.js (function Z at line W)

### Priority
[critical/high/medium/low]

### Test Scenario
[How to verify the fix works]
```

## Handoff Process
1. Save the upgrade request to `outputs/code-upgrade-request-{date}.md`
2. Route the request to the coder agent with full context
3. Include relevant chat log excerpts as evidence
4. After the coder agent completes, verify the fix by re-analyzing chat logs
