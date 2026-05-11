# Route to Agent Workflow

When the user's intent requires a specialized agent (coder, debugger, deployer, tester), use this workflow.

## Steps

### Step 1: Identify Target Agent
Based on intent analysis:
- **coder**: For implementing features, writing code, refactoring
- **debugger**: For fixing bugs, investigating errors
- **deployer**: For deploying to production
- **tester**: For running test suites

### Step 2: Prepare Task Payload
```json
{
  "task": "The user's instruction text",
  "agentId": "superroo-coder-agent|superroo-debugger-agent|superroo-deployer-agent|superroo-tester-agent",
  "commands": [],
  "network": "none",
  "telegram": {
    "chatId": "<chat_id>",
    "taskId": "<generated_task_id>",
    "branchName": "tg/<task_id>"
  }
}
```

### Step 3: Add to BullMQ Queue
The task is added to the `superroo-jobs` queue in Redis.
The worker picks it up and runs it in a Docker sandbox.

### Step 4: Notify User
Send a confirmation message:
"*Coding task created!* 🚀
*Project:* <project_name>
*Task:* <task_id>
*Instruction:* <user_message>
*Status:* Queued

I'll notify you when it's done!"

### Step 5: Monitor Completion
The worker will process the job and the result will be sent back to the Telegram chat via the bot API.
