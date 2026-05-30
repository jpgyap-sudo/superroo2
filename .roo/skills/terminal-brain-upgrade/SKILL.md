---
name: terminal-brain-upgrade
description: Upgrades the cloud IDE terminal (Dashboard or Mini IDE) with smart features — autocomplete, AI assistance, block output, and UX improvements. Invoke when asked to improve terminal intelligence.
---

# Terminal Brain Upgrade Skill

## When To Use

Use this skill when the user asks to:

- Improve the cloud IDE terminal experience (Dashboard or Mini IDE)
- Make the Telegram Mini IDE "zero friction" for coding
- Research and apply smart terminal features (autocomplete, AI, block output, etc.)
- Upgrade terminal intelligence, rendering, or UX
- Compare SuperRoo terminals against best-in-class terminals (Warp, Kitty, VS Code, etc.)

## Prerequisites

Before using this skill, read these reference documents:

- [`docs/resources/smart-terminal-research.md`](../../docs/resources/smart-terminal-research.md) — Comprehensive research on smart terminals
- [`docs/resources/terminal-brain-architecture.md`](../../docs/resources/terminal-brain-architecture.md) — Current and target architecture
- [`docs/resources/working-tree.md`](../../docs/resources/working-tree.md) — Product architecture overview

## Goal

Transform the SuperRoo Cloud IDE terminal (both Dashboard and Telegram Mini IDE) into the smartest cloud IDE terminal available — surpassing VS Code's built-in terminal in intelligence, while making Telegram coding feel like natural conversation.

## Core Principles

### 1. Zero Friction in Telegram

Telegram coding should feel like talking to a normal person:

- **NL-first**: Natural language is the primary input mode, commands are secondary
- **Conversational**: The terminal should understand context from the conversation
- **Proactive**: Suggest next steps, don't wait for commands
- **Forgiving**: Auto-correct typos, suggest alternatives, never show raw errors
- **Fast**: Sub-second response for common operations

### 2. Intelligence Over Features

Every feature must answer: "Does this make the user faster or smarter?"

- If a feature adds UI complexity without reducing cognitive load, skip it
- If AI can replace a manual workflow, automate it
- If the user does something twice, make it a one-click action

### 3. Cloud-Native Advantage

Unlike desktop terminals, the Cloud IDE has:

- **Server-side processing**: Run heavy AI analysis on the server
- **Persistence**: Sessions survive browser/Telegram reloads
- **Multi-device**: Same terminal state on phone, tablet, desktop
- **Shared context**: Terminal shares context with chat, files, and agents

## Inspection Checklist

Before making changes, inspect these areas:

### Terminal Core

- [ ] What terminal emulator is used? (xterm.js, custom, etc.)
- [ ] Is GPU acceleration enabled? (WebGL addon?)
- [ ] How is output rendered? (continuous scroll, blocks?)
- [ ] Is there a multi-line input editor?
- [ ] Are keyboard shortcuts documented and configurable?

### AI Intelligence

- [ ] Is there NL-to-command translation?
- [ ] Are errors detected and explained?
- [ ] Are fix suggestions generated?
- [ ] Is there smart autocomplete (files, git, docker, npm)?
- [ ] Is there command correction ("did you mean?")?
- [ ] Does the AI learn from user corrections?

### Project Awareness

- [ ] Does the terminal know the project structure?
- [ ] Does it detect package managers, frameworks, dependencies?
- [ ] Does it understand git state?
- [ ] Does it auto-detect available tasks (npm scripts, make, etc.)?

### Session Management

- [ ] Are sessions persisted across reloads?
- [ ] Can sessions be restored?
- [ ] Is there command history with search?
- [ ] Are there workflow templates?

### Telegram-Specific (Mini IDE)

- [ ] Can the user code entirely via natural language?
- [ ] Are responses formatted for mobile (Telegram message limits)?
- [ ] Is there inline command execution without leaving chat?
- [ ] Are there quick action buttons for common tasks?
- [ ] Does the bot remember conversation context?

## Improvement Workflow

### Step 1: Analyze Current State

```bash
# Read the current terminal implementation
# Dashboard IDE
cat cloud/dashboard/src/components/views/ide-terminal.tsx

# Mini IDE
cat cloud/mini-ide/public/app.js
cat cloud/mini-ide/public/index.html
cat cloud/mini-ide/public/styles.css

# Terminal Brain API
cat cloud/api/routes/terminal-brain.js

# Telegram Bot
cat cloud/api/telegramBot.js
cat cloud/api/tgEndpoints.js
cat cloud/api/telegramEngineer.js
```

### Step 2: Identify Gaps

Compare current state against the [Gap Analysis](../../docs/resources/smart-terminal-research.md#6-gap-analysis) in the research document. Prioritize gaps by:

1. **Impact on Telegram coding experience** (zero friction = highest priority)
2. **Implementation effort** (quick wins first)
3. **User requests** (what the user explicitly asked for)

### Step 3: Implement Improvements

For each improvement:

1. **Backend changes** (server.js, api.js, terminal-brain.js)
2. **Frontend changes** (app.js, ide-terminal.tsx, index.html, styles.css)
3. **Telegram bot changes** (telegramBot.js, telegramEngineer.js, tgEndpoints.js)
4. **Test** (verify on both Dashboard and Mini IDE)

### Step 4: Validate

- [ ] Does the improvement work on both Dashboard and Mini IDE?
- [ ] Does it work on mobile (Telegram WebApp)?
- [ ] Is it fast enough? (< 500ms for suggestions, < 2s for AI analysis)
- [ ] Does it degrade gracefully? (no errors if AI is unavailable)
- [ ] Is the UX consistent across platforms?

## Telegram-Specific Patterns

### Pattern 1: NL-First Command Processing

```javascript
// In telegramBot.js — handleNaturalLanguageInstruction
// Priority: NL intent → explicit command → fallback to AI

async function handleUserMessage(botToken, chatId, text, userId) {
	// 1. Detect intent from natural language
	const intent = detectIntent(text)

	// 2. If explicit command, execute directly
	if (text.startsWith("/")) {
		return handleCommand(botToken, chatId, text, userId)
	}

	// 3. If NL intent detected, plan and execute
	if (intent.confidence > 0.7) {
		const plan = await brainPlan(text, chatId)
		await sendPlanForApproval(botToken, chatId, plan)
		return
	}

	// 4. Fallback: ask AI to interpret
	const response = await askAI(text, providers, chatId)
	await sendMessage(botToken, chatId, response)
}
```

### Pattern 2: Conversational Context

```javascript
// Maintain conversation context across messages
// The terminal should remember:
// - What project the user is working on
// - What they were doing (last command, last error)
// - Their preferences (shell, theme, editor)

const conversationContext = {
	projectId: null,
	lastCommand: null,
	lastError: null,
	sessionId: null,
	preferences: {
		shell: "bash",
		autoApprove: false,
		verbose: false,
	},
}
```

### Pattern 3: Mobile-Optimized Responses

```javascript
// Telegram has 4096 character limit per message
// Format responses for mobile reading

function formatForTelegram(text) {
	// Split long responses into multiple messages
	if (text.length > 3000) {
		return splitIntoMessages(text, 3000)
	}

	// Use markdown formatting for readability
	// Use emoji for visual cues (✅ ❌ 🔧 🚀)
	// Use inline buttons for actions
	// Keep paragraphs short (2-3 lines max)
	return text
}
```

### Pattern 4: Quick Action Buttons

```javascript
// Always provide action buttons after any response
const actionButtons = [
	[{ text: "✅ Run", callback_data: "run" }],
	[{ text: "📝 Edit", callback_data: "edit" }],
	[{ text: "🔧 Fix", callback_data: "fix" }],
	[{ text: "❓ Explain", callback_data: "explain" }],
]
```

## Dashboard-Specific Patterns

### Pattern 1: Block-Based Output

```typescript
// Group command output into blocks with action buttons
interface CommandBlock {
	id: string
	command: string
	output: string[]
	exitCode: number | null
	duration: number
	timestamp: number
	hasError: boolean
	errorAnalysis?: {
		type: string
		confidence: number
		explanation: string
		fix?: string
	}
}
```

### Pattern 2: Smart Autocomplete

```typescript
// Context-aware autocomplete suggestions
interface AutocompleteSuggestion {
	text: string
	type: "command" | "file" | "git" | "docker" | "npm" | "history"
	description?: string
	icon?: string
}

function getAutocompleteSuggestions(input: string, context: ProjectContext): AutocompleteSuggestion[] {
	const suggestions: AutocompleteSuggestion[] = []

	// File paths
	if (input.startsWith("cd ") || input.includes("/")) {
		suggestions.push(...getFileSuggestions(input, context.files))
	}

	// Git commands
	if (input.startsWith("git ")) {
		suggestions.push(...getGitSuggestions(input, context.git))
	}

	// npm scripts
	if (input.startsWith("npm run ") || input.startsWith("pnpm ")) {
		suggestions.push(...getNpmSuggestions(input, context.packageJson))
	}

	// Docker commands
	if (input.startsWith("docker ")) {
		suggestions.push(...getDockerSuggestions(input))
	}

	// Command history (fuzzy match)
	suggestions.push(...getHistorySuggestions(input, context.history))

	return suggestions
}
```

### Pattern 3: GPU-Accelerated Rendering

```typescript
// Add WebGL rendering to xterm.js
import { Terminal } from "xterm"
import { WebglAddon } from "xterm-addon-webgl"

const term = new Terminal({
	rendererType: "webgl", // Use WebGL renderer
	allowTransparency: true,
	fontSize: 14,
})

try {
	term.loadAddon(new WebglAddon())
} catch (e) {
	// Fallback to canvas renderer
	console.warn("WebGL not available, using canvas renderer", e)
}
```

## Validation Checklist

After implementing improvements, verify:

### Functional

- [ ] Commands execute correctly in both Dashboard and Mini IDE
- [ ] NL-to-command works for common operations (build, test, deploy, install)
- [ ] Errors are detected and explained with fix suggestions
- [ ] Autocomplete shows relevant suggestions
- [ ] Session persistence works (reload page → restore terminal)
- [ ] Keyboard shortcuts work

### Performance

- [ ] Terminal renders at 60fps for large output (1000+ lines)
- [ ] AI suggestions appear within 500ms
- [ ] Command execution shows real-time output via WebSocket
- [ ] No noticeable lag on mobile (Telegram WebApp)

### UX

- [ ] Telegram responses are mobile-optimized
- [ ] Action buttons are provided after every response
- [ ] Errors are explained in plain language, not raw stack traces
- [ ] The user can code entirely via natural language in Telegram
- [ ] Context is maintained across conversation turns

### Safety

- [ ] Destructive commands require approval
- [ ] Unknown commands are flagged before execution
- [ ] Command history is auditable
- [ ] Session data is encrypted at rest

## Related Files

- [`docs/resources/smart-terminal-research.md`](../../docs/resources/smart-terminal-research.md) — Research document
- [`docs/resources/terminal-brain-architecture.md`](../../docs/resources/terminal-brain-architecture.md) — Architecture document
- [`cloud/dashboard/src/components/views/ide-terminal.tsx`](../../cloud/dashboard/src/components/views/ide-terminal.tsx) — Dashboard IDE terminal
- [`cloud/mini-ide/public/app.js`](../../cloud/mini-ide/public/app.js) — Mini IDE frontend
- [`cloud/mini-ide/public/index.html`](../../cloud/mini-ide/public/index.html) — Mini IDE HTML
- [`cloud/mini-ide/public/styles.css`](../../cloud/mini-ide/public/styles.css) — Mini IDE styles
- [`cloud/mini-ide/server.js`](../../cloud/mini-ide/server.js) — Mini IDE server
- [`cloud/api/telegramBot.js`](../../cloud/api/telegramBot.js) — Telegram bot
- [`cloud/api/tgEndpoints.js`](../../cloud/api/tgEndpoints.js) — Telegram endpoints
- [`cloud/api/telegramEngineer.js`](../../cloud/api/telegramEngineer.js) — Telegram engineer formatter
- [`cloud/api/routes/terminal-brain.js`](../../cloud/api/routes/terminal-brain.js) — Terminal Brain API
