# Workflow: Code Upgrade Trigger

## Purpose
When chat log analysis reveals a code-level issue that cannot be fixed with skill/workflow/resource updates, trigger a code upgrade via the coder agent.

## Steps

### 1. Confirm It's a Code Issue
Verify the issue is NOT fixable by skill/workflow/resource updates:
- Is it a bug in the bot's logic? → Code issue
- Is it a missing API integration? → Code issue
- Is it a performance/crash issue? → Code issue
- Is it a missing command or feature? → Code issue
- Is it just missing knowledge? → Skill issue (handle yourself)
- Is it poor response formatting? → Workflow issue (handle yourself)

### 2. Gather Evidence
- Collect 3+ examples from chat logs showing the issue
- Note the exact bot behavior vs expected behavior
- Identify the relevant code section (file + function + line if possible)
- Check if there are any error logs that correlate

### 3. Create Upgrade Request
- Use the [code-upgrade-request.md](../skills/code-upgrade-request.md) template
- Save to `outputs/code-upgrade-request-{YYYY-MM-DD}.md`
- Be specific about what needs to change

### 4. Route to Coder Agent
- The coder agent will implement the fix
- Provide the upgrade request as context
- Include relevant chat log excerpts as evidence

### 5. Verify the Fix
- After the coder agent completes, check if the fix was deployed
- Monitor chat logs for the same issue pattern
- If the issue recurs, refine the upgrade request
- If resolved, log in `memory/improvement-log.md`
