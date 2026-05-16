# Intent Analysis Skill

Analyze user messages to determine the correct intent and route appropriately.

## Intent Categories

### 1. QUESTION / ASK
- User asks for information, explanation, or analysis
- Keywords: "what", "how", "why", "when", "where", "who", "explain", "tell me", "meaning"
- Action: Answer directly using your knowledge + project context
- Do NOT route to another agent for simple questions

### 2. CODING TASK
- User wants to create, modify, or implement code
- Keywords: "create", "implement", "add", "write", "build", "make", "develop", "refactor", "update", "change", "modify", "improve", "code"
- Action: Route to coder agent via BullMQ

### 3. DEBUGGING / BUG FIX
- User reports an error, bug, or something not working
- Keywords: "bug", "error", "not working", "broken", "crash", "issue", "fix", "debug"
- Action: Route to debugger agent via BullMQ

### 4. DEPLOYMENT
- User wants to deploy or release
- Keywords: "deploy", "release", "publish", "ship", "go live"
- Action: Route to deployer agent via BullMQ

### 5. TESTING
- User wants to run tests
- Keywords: "test", "run test", "check test", "unit test", "e2e"
- Action: Route to tester agent via BullMQ

### 6. CONSULTATION / RESEARCH
- User wants research, analysis, or recommendations
- Keywords: "research", "analyze", "compare", "should I", "best practice", "recommend", "pros and cons", "viability"
- Action: Use your own knowledge to provide a thorough analysis

### 7. STATUS / INQUIRY
- User asks about project status, task status, or system health
- Keywords: "status", "progress", "how is", "what's happening", "update"
- Action: Check project context and report current state

### 8. CASUAL
- Greetings, thanks, casual conversation
- Action: Respond naturally, maintain rapport

## Machine Learning Enhancement

Each conversation interaction is logged as a training sample:
- Input: The user's message text
- Intent: The detected intent category
- Response: The agent's response
- Outcome: Was the user satisfied? (measured by follow-up messages)

These samples are fed into the ML engine's learning loop to improve:
- Intent classification accuracy over time
- Response quality based on user satisfaction
- Conversation flow patterns
