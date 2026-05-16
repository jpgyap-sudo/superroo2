# Analyze and Respond Workflow

This is the primary workflow for handling Telegram messages.

## Steps

### Step 1: Receive Message
- Input: Raw message text from Telegram user
- Metadata: chatId, userId, conversation history, active project

### Step 2: Analyze Intent
Use the Intent Analysis skill to classify the message:
1. Check for explicit commands (/code, /ask, /deploy, etc.)
2. If no command, analyze natural language for intent
3. Consider conversation context (previous messages may change intent)

### Step 3: Determine Response Strategy

| Intent | Strategy |
|--------|----------|
| question | Answer directly with knowledge |
| coding | Route to coder agent via BullMQ |
| debugging | Route to debugger agent via BullMQ |
| deployment | Route to deployer agent via BullMQ |
| testing | Route to tester agent via BullMQ |
| consultation | Provide thorough analysis |
| status | Check and report project status |
| casual | Respond conversationally |

### Step 4: Generate Response
- For direct answers: Use your knowledge + project context
- For agent routing: Create BullMQ job with the user's instruction
- Format response per Telegram Response skill

### Step 5: Log for Learning
- Record the interaction as a training sample
- Input text, detected intent, response, outcome
- This feeds the ML engine's learning loop

### Step 6: Send Response
- Send message back to Telegram chat
- If routing to agent, notify user of task creation
