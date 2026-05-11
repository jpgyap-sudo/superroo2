# Workflow: Skill Improvement Loop

## Purpose
Continuously improve the Telegram bot's skills, workflows, and resources based on chat log analysis.

## Steps

### 1. Detect Gap
- Use [skill-gap-detection.md](../skills/skill-gap-detection.md) to identify what's missing
- Gather evidence from chat logs (3+ examples of the same issue)
- Determine the gap category (skill/workflow/resource)

### 2. Design Improvement
- Review existing files in the `telegram-agent/` directory
- Check if an existing file can be updated or a new file is needed
- Follow the format of existing files for consistency
- For skills: Focus on actionable guidance, not theory
- For workflows: Provide clear step-by-step instructions
- For resources: Ensure accuracy and completeness

### 3. Create/Update File
- Create new files in the appropriate directory:
  - `cloud/agents/telegram-agent/skills/` for skills
  - `cloud/agents/telegram-agent/workflows/` for workflows
  - `cloud/agents/telegram-agent/resources/` for resources
- Update the `agent.json` to reference new files in the appropriate arrays
- For `.roo/skills/` level skills, create in `.roo/skills/telegram-integration/`

### 4. Validate
- Review the new/updated file for:
  - Clarity and completeness
  - Correct markdown formatting
  - Proper cross-references to other files
  - Actionable guidance (not just theory)

### 5. Request Approval
- Present the change to the user for approval
- Explain what gap it addresses and show evidence from chat logs
- Once approved, finalize the file

### 6. Monitor
- After the improvement is deployed, monitor chat logs for the same issue
- If the issue persists, refine the improvement
- If the issue is resolved, log the success in `memory/improvement-log.md`
