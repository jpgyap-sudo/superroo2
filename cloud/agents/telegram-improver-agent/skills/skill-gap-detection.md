# Skill: Skill Gap Detection

## Purpose
Identify gaps in the Telegram bot's skills, workflows, and resources that could improve its performance.

## Detection Methods

### 1. Conversation Pattern Analysis
- Look for repeated user questions that the bot answers poorly
- Identify topics where the bot lacks domain knowledge
- Detect scenarios where the bot's response quality degrades

### 2. Error Pattern Analysis
- Review bot error logs for recurring failures
- Identify commands or intents that consistently fail
- Map errors to missing skills or workflows

### 3. User Correction Analysis
- When users correct the bot, note what was corrected
- Identify knowledge gaps that led to the correction
- Determine if a new skill file or resource would prevent the error

## Skill File Types

### Skills (`.md` files in `skills/`)
- `conversation-flow.md` — How to maintain natural conversation
- `intent-analysis.md` — How to detect user intent
- `code-context.md` — How to understand code context
- `telegram-response.md` — How to format Telegram responses

### Workflows (`.md` files in `workflows/`)
- `analyze-and-respond.md` — Standard Q&A flow
- `route-to-agent.md` — How to route tasks to specialist agents
- `research-and-answer.md` — Deep research flow

### Resources (`.md` files in `resources/`)
- `superroo-architecture.md` — System architecture reference
- `project-context.md` — Project-specific context

## Gap Categories
1. **Missing Skill**: Bot lacks knowledge on a topic users frequently ask about
2. **Incomplete Workflow**: Existing workflow doesn't handle edge cases
3. **Outdated Resource**: Reference material is stale or incorrect
4. **Missing Agent Config**: Need a new agent or updated agent configuration
5. **Code Gap**: Bot logic needs modification (requires coder agent)

## Output
For each gap found, produce:
1. Gap description
2. Evidence from chat logs
3. Recommended fix type (skill/workflow/resource/code)
4. Suggested file path for the new/updated file
5. Priority (high/medium/low)
