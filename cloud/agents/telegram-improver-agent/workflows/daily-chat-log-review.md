# Workflow: Daily Chat Log Review

## Schedule
Run once per day (recommended: 00:00 UTC or low-traffic period).

## Steps

### 1. Load Today's Chat Log
- Read the latest chat log file from `cloud/data/chat-logs/`
- If today's file is empty or doesn't exist, check yesterday's file
- Load the conversation history from `cloud/data/conversation-history.json` for additional context

### 2. Analyze Conversations
- Group log entries by `chatId` to reconstruct conversation threads
- For each conversation thread:
  - Identify the user's goal/intent
  - Evaluate the bot's responses
  - Note any failures, misunderstandings, or user frustration
  - Check if context was maintained across messages

### 3. Identify Improvement Opportunities
- Use the [chat-log-analysis.md](../skills/chat-log-analysis.md) skill to systematically evaluate
- Categorize each issue:
  - **Skill gap**: Bot lacks knowledge → create/update skill file
  - **Workflow gap**: Bot doesn't handle scenario → create/update workflow
  - **Resource gap**: Bot has outdated info → update resource
  - **Code bug**: Bot logic is broken → create code upgrade request

### 4. Generate Report
- Save analysis report to `outputs/daily-review-{YYYY-MM-DD}.md`
- Include:
  - Summary of conversations analyzed
  - Top issues found (with evidence)
  - Recommended actions
  - Priority scores

### 5. Take Action
- For skill/workflow/resource gaps: Create or update files immediately
- For code bugs: Follow the [code-upgrade-request.md](../skills/code-upgrade-request.md) workflow
- For critical issues: Flag for immediate attention

### 6. Track Improvements
- Record what was improved in `memory/improvement-log.md`
- Note which chat log patterns triggered the improvement
- Track if the same issue recurs after the fix
