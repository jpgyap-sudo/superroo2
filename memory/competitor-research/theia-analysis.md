# Eclipse Theia — Deep Analysis for SuperRoo IDE Improvement

**Date**: 2026-05-20
**Source**: https://github.com/eclipse-theia/theia (commit analyzed from cloned repo)
**Focus**: Architecture patterns, AI agent system, MCP integration, collaboration, skill system, and innovative gaps for SuperRoo adoption

---

## 1. Overview

Eclipse Theia is a **Cloud & Desktop IDE Framework** — not an AI coding agent like SuperRoo, but a full IDE platform that has been extended with a comprehensive AI ecosystem. It uses a Lerna monorepo with **77 packages**, TypeScript ~5.9.3, React 18.2.0, Monaco Editor, and InversifyJS for dependency injection.

Theia's relevance to SuperRoo is **complementary**: SuperRoo is an AI coding agent that could benefit from Theia's IDE platform patterns, while Theia lacks SuperRoo's autonomous agent capabilities.

---

## 2. Architecture Patterns

### 2.1 Monorepo Structure

| Directory | Purpose |
|-----------|---------|
| `packages/` | Runtime packages (77 total) |
| `dev-packages/` | Tooling packages |
| `examples/` | Sample applications |

**Platform-specific code organization** (per package):
- `src/common/` — Shared types and interfaces
- `src/browser/` — Frontend (browser) code
- `src/node/` — Backend (Node.js) code
- `src/electron-browser/` — Electron-specific frontend
- `src/electron-main/` — Electron main process

### 2.2 Dependency Injection via InversifyJS

Theia uses **InversifyJS** with the **Contribution Points** pattern — a service registry where modules register themselves via `@injectable()` decorators and are discovered through `@inject()` and `@named()` annotations.

**Key pattern**:
```typescript
@injectable()
export class SomeServiceImpl implements SomeService {
    @inject(SomeDependency) protected readonly dep: SomeDependency;
    // ...
}
```

### 2.3 Extension Types

Theia supports three extension types:
1. **Theia Extensions** — Build-time extensions (npm packages with `@theia/` scope)
2. **VS Code Extensions** — Runtime extensions via `plugin-ext-vscode` package
3. **Theia Plugins** — Runtime plugins via `plugin-ext` package

---

## 3. AI Agent System

### 3.1 Agent Interface (`packages/ai-core/src/common/agent.ts`)

Theia defines a clean, typed `Agent` interface:

```typescript
export interface Agent {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly variables: string[];
    readonly prompts: PromptVariantSet[];
    readonly languageModelRequirements: LanguageModelRequirement[];
    readonly tags?: string[];
    readonly agentSpecificVariables: AgentSpecificVariables[];
    readonly functions: string[];
}
```

**Key insight**: The `languageModelRequirements` array allows an agent to declare which models it needs and for what purpose. The `PromptVariantSet` enables multiple prompt variants per agent.

### 3.2 Prompt Variant System (`PromptVariantSet`)

```typescript
export interface PromptVariantSet {
    id: string;
    defaultVariant: BasePromptFragment;
    variants?: BasePromptFragment[];
}
```

Each agent can have multiple prompt variants (e.g., Edit Mode, Agent Mode, Agent Mode Next) with a default variant and optional alternatives. The `PromptService` resolves which variant is active based on user settings.

### 3.3 CoderAgent (`packages/ai-ide/src/browser/coder-agent.ts`)

The CoderAgent extends `AbstractModeAwareChatAgent` and defines **three modes**:

| Mode ID | Name | Purpose |
|---------|------|---------|
| `CODER_EDIT_TEMPLATE_ID` | Edit Mode | Direct file editing |
| `CODER_AGENT_MODE_TEMPLATE_ID` | Agent Mode | Autonomous agent mode |
| `CODER_AGENT_MODE_NEXT_TEMPLATE_ID` | Agent Mode (Next) | Next-gen agent mode |

The agent uses `PromptVariantSet` with `CODER_SYSTEM_PROMPT_ID` as the variant set, containing all three mode variants. Mode switching is handled via `updateSelectedVariantId()`.

**Agent Mode Confirmation**: Before entering Agent Mode, the user must acknowledge via `AgentModeConfirmationService`. If declined, it falls back to Edit Mode.

### 3.4 ArchitectAgent (`packages/ai-ide/src/browser/architect-agent.ts`)

The ArchitectAgent also extends `AbstractModeAwareChatAgent` with **three modes**:

| Mode ID | Name | Purpose |
|---------|------|---------|
| `ARCHITECT_PLANNING_PROMPT_ID` | Plan Mode | Architecture planning |
| `ARCHITECT_SIMPLE_PROMPT_ID` | Simple Mode | Quick answers |
| `ARCHITECT_PLANNING_NEXT_PROMPT_ID` | Plan Mode (Next) | Next-gen planning |

**Cannot modify files** — the description explicitly states "It cannot modify files." It has a `suggest()` method that offers "Execute plan with Coder" suggestions via `AI_EXECUTE_PLAN_WITH_CODER` command.

### 3.5 AbstractModeAwareChatAgent (Base Class)

Both CoderAgent and ArchitectAgent extend this base class which provides:
- Mode definitions (`modeDefinitions`)
- Mode-aware prompt resolution
- System prompt ID management
- Language model requirement handling

---

## 4. MCP Integration (`packages/ai-mcp/`)

### 4.1 MCPServerManagerImpl

Full MCP server lifecycle management:

```typescript
class MCPServerManagerImpl implements MCPServerManager {
    protected servers: Map<string, MCPServer> = new Map();
    protected clients: Array<MCPFrontendNotificationService> = [];

    async startServer(serverName: string): Promise<void>;
    async stopServer(serverName: string): Promise<void>;
    callTool(serverName: string, toolName: string, arg_string: string): Promise<CallToolResult>;
    getRunningServers(): Promise<string[]>;
    getServerDescription(name: string): Promise<MCPServerDescription | undefined>;
    getTools(serverName: string): Promise<...>;
    readResource(serverName: string, resourceId: string): Promise<ReadResourceResult>;
    getResources(serverName: string): Promise<ListResourcesResult>;
    addOrUpdateServer(description: MCPServerDescription): void;
    removeServer(name: string): void;
    setWorkspaceRoots(roots: string[] | undefined): void;
}
```

**Key features**:
- **Server resolution**: Before starting, `startServer()` calls `description.resolve()` to resolve dynamic configuration (e.g., environment variables)
- **Status notifications**: `onDidUpdateStatus` listener notifies all frontend clients via `notifyClients()`
- **Resource support**: Full `readResource`/`getResources` implementation for MCP resource protocol
- **Workspace roots**: `setWorkspaceRoots()` propagates to all servers

### 4.2 MCP UI Package (`packages/ai-mcp-ui/`)

Separate UI package for MCP server management in the frontend — indicates a clean separation between MCP logic and UI.

---

## 5. Skill System (`packages/ai-core/src/common/skill.ts`)

### 5.1 SkillDescription Interface

```typescript
export interface SkillDescription {
    name: string;           // lowercase kebab-case, must match directory name
    description: string;    // max 1024 characters
    license?: string;       // SPDX identifier
    compatibility?: string; // version constraint
    metadata?: Record<string, string>;
    allowedTools?: string[]; // experimental: tool restriction per skill
}
```

### 5.2 SKILL.md File Format

Skills are defined in `SKILL.md` files with YAML frontmatter:

```markdown
---
name: my-skill
description: Does something useful
license: MIT
compatibility: ">=1.0.0"
metadata:
  author: me
allowedTools:
  - read_file
  - search_files
---
# Skill Content

Markdown content follows the frontmatter.
```

### 5.3 Key Differences from SuperRoo's Skill System

| Feature | Theia | SuperRoo |
|---------|-------|----------|
| File format | SKILL.md with YAML frontmatter | SKILL.md with YAML frontmatter |
| Name validation | Lowercase kebab-case, must match dir | Similar |
| Tool restriction | `allowedTools` (experimental) | Not present |
| Directory priority | Workspace > configured > default | Similar |
| Validation | `validateSkillDescription()` | Not centralized |
| TypeScript types | Full typed interfaces | Not typed |

**Innovative gap**: Theia's `allowedTools` field is experimental but powerful — it allows restricting which tools a skill can use. SuperRoo could adopt this for security sandboxing of skills.

---

## 6. Prompt System (`packages/ai-core/src/common/prompt-service.ts`)

### 6.1 Prompt Fragment Types

```typescript
interface BasePromptFragment extends CommandPromptFragmentMetadata {
    id: string;
    template: string;  // may contain variables and function references
}

interface CustomizedPromptFragment extends BasePromptFragment {
    customizationId: string;
    priority: number;
}
```

### 6.2 Command Prompt Fragments (Slash Commands)

```typescript
interface CommandPromptFragmentMetadata {
    name?: string;
    description?: string;
    isCommand?: boolean;
    commandName?: string;
    commandDescription?: string;
    commandArgumentHint?: string;
    commandAgents?: string[];  // which agents can use this command
}
```

**Key insight**: Prompt fragments can be registered as **slash commands** with agent-specific availability. The `commandAgents` array allows restricting commands to specific agents.

### 6.3 Prompt Variant Resolution

The `PromptServiceImpl` (1224 lines) handles:
- **Variant selection**: `getEffectiveVariantId()` resolves which variant is active
- **Customization**: Users can customize built-in prompts via `createCustomization()`
- **Variable resolution**: `resolveVariablesAndArgs()` replaces `{{variable}}` references
- **Function resolution**: `getResolvedPromptFragment()` resolves function references in templates
- **Front matter**: `enrichWithFrontMatter()` adds YAML front matter to fragments

---

## 7. Language Model System (`packages/ai-core/src/common/language-model.ts`)

### 7.1 Message Types

```typescript
type LanguageModelMessage = TextMessage | ThinkingMessage | ToolUseMessage | ToolResultMessage | ImageMessage;
```

**ThinkingMessage** is notable — it supports `thinking` and `signature` fields for models that output reasoning traces (like DeepSeek R1).

### 7.2 Reasoning Support

```typescript
type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'auto';
type ReasoningApi = 'effort' | 'budget';

interface ReasoningSupport {
    readonly supportedLevels: ReadonlyArray<ReasoningLevel>;
    readonly defaultLevel?: ReasoningLevel;
}

interface ReasoningSettings {
    level: ReasoningLevel;
}
```

**Key insight**: Theia has a provider-agnostic reasoning abstraction. Each provider maps `ReasoningLevel` to its native API (e.g., OpenAI maps `'high'` to `reasoning_effort: 'high'`, Anthropic maps it to `thinking: { budget_tokens: X }`).

### 7.3 LanguageModelRegistry

```typescript
interface LanguageModelRegistry {
    addLanguageModels(models: LanguageModel[]): void;
    getLanguageModels(): Promise<LanguageModel[]>;
    getLanguageModel(id: string): Promise<LanguageModel | undefined>;
    removeLanguageModels(ids: string[]): void;
    selectLanguageModels(request: LanguageModelSelector): Promise<LanguageModel[] | undefined>;
    selectLanguageModel(request: LanguageModelSelector): Promise<LanguageModel | undefined>;
    patchLanguageModel<T>(id: string, patch: Partial<T>): Promise<void>;
}
```

---

## 8. Collaboration System (`packages/collaboration/`)

Theia has a dedicated collaboration package with:

| File | Purpose |
|------|---------|
| `collaboration-file-system-provider.ts` | Shared file system for collaborative editing |
| `collaboration-workspace-service.ts` | Workspace sharing across collaborators |
| `collaboration-instance.ts` | Collaboration session management |
| `collaboration-color-service.ts` | Per-user cursor/selection colors |
| `collaboration-frontend-contribution.ts` | UI contributions for collaboration |

**Innovative gap**: SuperRoo currently has **no collaboration features**. Theia's collaboration system enables real-time pair programming, which could be a significant differentiator.

---

## 9. AI Provider Ecosystem

Theia has **20+ AI provider packages**:

| Package | Provider |
|---------|----------|
| `ai-openai` | OpenAI (GPT-4, GPT-4o, o1, o3) |
| `ai-anthropic` | Anthropic (Claude) |
| `ai-ollama` | Ollama (local models) |
| `ai-google` | Google (Gemini) |
| `ai-hugging-face` | Hugging Face |
| `ai-llamafile` | Llamafile |
| `ai-vercel-ai` | Vercel AI SDK |
| `ai-claude-code` | Claude Code CLI integration |
| `ai-copilot` | GitHub Copilot |
| `ai-code-completion` | Code completion provider |
| `ai-codex` | Codex integration |
| `ai-scanoss` | SCANOSS (license scanning) |
| `ai-mcp` | MCP server management |
| `ai-mcp-server` | MCP server implementation |
| `ai-terminal` | AI terminal assistant |

Each provider is a **separate npm package** with its own `package.json`, allowing users to install only the providers they need.

---

## 10. Innovative Gaps & Integration Opportunities for SuperRoo

### 10.1 HIGH PRIORITY — Directly Adoptable

| # | Gap | Theia Pattern | SuperRoo Action |
|---|-----|---------------|-----------------|
| 1 | **Typed Agent Interface** | `Agent` interface with `PromptVariantSet`, `LanguageModelRequirement`, `tags` | Refactor SuperRoo's agent system to use a typed interface matching Theia's `Agent` contract |
| 2 | **Mode-Aware Agents** | CoderAgent has 3 modes (Edit/Agent/Agent Next), ArchitectAgent has 3 modes (Plan/Simple/Plan Next) | Add mode definitions to SuperRoo's Coder and Architect agents with mode-specific prompts |
| 3 | **Prompt Variant System** | `PromptVariantSet` with `defaultVariant` + `variants[]` | Replace SuperRoo's flat prompt templates with variant sets that support user customization |
| 4 | **Slash Command System** | `CommandPromptFragmentMetadata` with `isCommand`, `commandName`, `commandAgents` | Add slash command support to SuperRoo's chat with agent-specific command routing |
| 5 | **MCP Server Lifecycle** | `MCPServerManagerImpl` with `startServer`/`stopServer`/`callTool`/`getRunningServers` | Enhance SuperRoo's MCP bridge with Theia's server manager pattern (start/stop/status notifications) |
| 6 | **Reasoning Abstraction** | `ReasoningLevel` + `ReasoningApi` with provider-agnostic mapping | Add reasoning configuration to SuperRoo's model router with per-provider mapping |

### 10.2 MEDIUM PRIORITY — Architecture Improvements

| # | Gap | Theia Pattern | SuperRoo Action |
|---|-----|---------------|-----------------|
| 7 | **Skill Tool Restrictions** | `allowedTools` field on `SkillDescription` | Add tool whitelist/blacklist per skill for security sandboxing |
| 8 | **Provider as Packages** | Each AI provider is a separate npm package | Extract SuperRoo's providers into installable packages (optional, for modularity) |
| 9 | **Custom Agent Descriptions** | `CustomAgentDescription` with `id`, `name`, `description`, `prompt`, `defaultLLM`, `showInChat` | Allow users to create custom agents via config files |
| 10 | **Prompt Customization UI** | `PromptFragmentCustomizationService` with `createCustomization()`/`editCustomization()` | Add prompt editing UI to SuperRoo's settings panel |
| 11 | **Agent-Specific Variables** | `AgentSpecificVariables` with `name`, `description`, `usedInPrompt` | Add per-agent variable documentation in SuperRoo's agent config |
| 12 | **Thinking Message Support** | `ThinkingMessage` type with `thinking` + `signature` fields | Add thinking message handling to SuperRoo's chat for DeepSeek R1 traces |

### 10.3 LOW PRIORITY — Long-Term Vision

| # | Gap | Theia Pattern | SuperRoo Action |
|---|-----|---------------|-----------------|
| 13 | **Real-Time Collaboration** | `collaboration/` package with file system provider, workspace service, color service | Add pair programming mode with shared workspace and real-time cursor sync |
| 14 | **VS Code Extension Protocol** | `plugin-ext-vscode` package for VS Code extension compatibility | Allow SuperRoo to load VS Code extensions for language support |
| 15 | **Dev Container Support** | `dev-container` package for containerized development environments | Add dev container support to SuperRoo's sandbox system |
| 16 | **SCM Integration** | `scm/` and `scm-extra/` packages for source control | Add git integration directly in SuperRoo's chat |
| 17 | **Debug Integration** | `debug/` package for VS Code debug protocol | Add debug adapter protocol support to SuperRoo's debug team |
| 18 | **Task System** | `task/` package for task automation | Enhance SuperRoo's task queue with IDE task integration |

---

## 11. Comparison: Theia vs SuperRoo

| Dimension | Theia | SuperRoo |
|-----------|-------|----------|
| **Primary purpose** | Cloud/Desktop IDE Framework | AI Coding Agent |
| **Agent system** | Typed `Agent` interface with modes | Agent routing via config |
| **Prompt system** | `PromptVariantSet` with customization | Flat prompt templates |
| **MCP integration** | Full lifecycle management | MCP bridge via scripts |
| **Skill system** | SKILL.md with YAML frontmatter + `allowedTools` | SKILL.md with YAML frontmatter |
| **AI providers** | 20+ separate packages | 6 providers in api.js |
| **Collaboration** | Real-time collaborative editing | None |
| **Reasoning** | Provider-agnostic `ReasoningLevel` | Not abstracted |
| **DI framework** | InversifyJS | None (manual wiring) |
| **Extension system** | 3 types (Theia, VS Code, Plugin) | Skill system only |
| **Sandbox** | Dev containers | Docker-based sandbox |
| **Autonomous agents** | Limited (Agent Mode) | Full autonomous loop |
| **Learning layer** | None | Comprehensive lesson system |
| **Deployment** | Electron + Browser | VPS + Docker |

---

## 12. Recommended Integration Roadmap

### Phase 1 (Immediate — 1-2 weeks)
1. Adopt Theia's **typed Agent interface** for SuperRoo's agent system
2. Add **mode definitions** to CoderAgent and ArchitectAgent
3. Implement **PromptVariantSet** for prompt customization
4. Add **reasoning abstraction** to SuperRoo's model router

### Phase 2 (Short-term — 2-4 weeks)
5. Enhance **MCP server manager** with Theia's lifecycle pattern
6. Add **slash command system** with agent-specific routing
7. Implement **skill tool restrictions** (`allowedTools`)
8. Add **thinking message** support for reasoning model traces

### Phase 3 (Medium-term — 1-2 months)
9. Build **prompt customization UI** in settings panel
10. Add **custom agent descriptions** via config files
11. Extract providers into **modular packages**
12. Add **agent-specific variable documentation**

### Phase 4 (Long-term — 3-6 months)
13. Implement **real-time collaboration** for pair programming
14. Add **VS Code extension protocol** support
15. Integrate **SCM** and **debug** protocols
16. Add **dev container** support to sandbox system

---

## 13. Key Takeaways

1. **Theia is not a competitor** — it's an IDE framework that SuperRoo could integrate with or learn from
2. **Theia's AI agent system is less autonomous** but more architecturally clean than SuperRoo's
3. **Theia's MCP integration is production-grade** with full lifecycle management
4. **Theia's skill system is nearly identical** to SuperRoo's but adds `allowedTools` for security
5. **Theia's collaboration features** are a major gap in SuperRoo
6. **Theia's provider-agnostic reasoning abstraction** is something SuperRoo should adopt immediately
7. **Theia's prompt variant system** enables user customization that SuperRoo lacks
8. **Theia's 20+ AI provider packages** show a modularity pattern SuperRoo could follow
