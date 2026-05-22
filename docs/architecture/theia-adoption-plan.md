# Eclipse Theia Adoption Plan — Supercharging SuperRoo

**Date**: 2026-05-20
**Status**: Draft — Phase 0 (Problem Definition)
**Source Analysis**: [`memory/competitor-research/theia-analysis.md`](memory/competitor-research/theia-analysis.md)

---

## Phase 0: Problem Definition

### What is the symptom?

SuperRoo has powerful autonomous agent capabilities (learning layer, sandbox, debug team, deployment) but its **IDE platform architecture is ad-hoc** compared to Eclipse Theia. Specifically:

1. **Agent interface** ([`src/super-roo/types/index.ts:471`](src/super-roo/types/index.ts:471)) is minimal — only `name`, `description`, `requiredCapabilities`, and `run()`. No prompt variants, no language model requirements, no tags, no mode definitions.
2. **Prompt system** is flat — agents have a single `systemPromptPreamble` option ([`src/super-roo/agents/CoderAgent.ts:37`](src/super-roo/agents/CoderAgent.ts:37)) instead of variant sets with user customization.
3. **MCP integration** is script-based ([`scripts/mcp-codex-bridge.mjs`](scripts/mcp-codex-bridge.mjs)) — no server lifecycle management, no status notifications, no resource protocol.
4. **Provider configuration** is monolithic ([`cloud/api/api.js:1691`](cloud/api/api.js:1691)) — all 6 providers hard-coded in a single array instead of modular packages.
5. **Reasoning support** is not abstracted — each provider handles reasoning differently with no common `ReasoningLevel` type.
6. **No collaboration** — SuperRoo has zero real-time pair programming or workspace sharing.
7. **No slash commands** — agents can't register agent-specific slash commands.
8. **Skill system** lacks tool restrictions — no `allowedTools` equivalent for security sandboxing.

### What is the expected behavior?

SuperRoo should have:
- A **typed Agent interface** with `PromptVariantSet[]`, `LanguageModelRequirement[]`, `tags`, `modeDefinitions`
- **Mode-aware agents** (CoderAgent: Edit/Agent/Agent Next; ArchitectAgent: Plan/Simple/Plan Next)
- **MCP server lifecycle management** with start/stop/callTool/status notifications
- **Provider-agnostic reasoning abstraction** (`ReasoningLevel` mapped per-provider)
- **Prompt variant system** with user customization and slash commands
- **Skill tool restrictions** for security sandboxing
- **Real-time collaboration** for pair programming
- **Modular provider packages** for maintainability

### What is the scope?

| In Scope | Out of Scope |
|----------|-------------|
| Agent interface refactor (src/super-roo/types/) | Full Theia fork or embedding |
| CoderAgent/ArchitectAgent mode definitions | Monaco Editor integration |
| MCP server manager (cloud/orchestrator/mcp/) | VS Code extension protocol |
| Reasoning abstraction (src/super-roo/providers/) | Dev container support |
| Prompt variant system (src/super-roo/prompts/) | SCM integration |
| Skill tool restrictions (.roo/skills/) | Debug adapter protocol |
| Slash command system (src/super-roo/chat/) | Electron desktop app |
| Collaboration foundation (cloud/collaboration/) | Full Theia plugin system |
| Modular provider extraction | |

### What is NOT the problem?

- SuperRoo's autonomous agent capabilities (learning layer, sandbox, debug team, deployment) are **superior** to Theia's — these should NOT be replaced
- Theia's InversifyJS DI pattern is NOT being adopted — SuperRoo's manual wiring is fine for its scale
- This is NOT a fork or embedding of Theia — it's an **architecture pattern adoption**

---

## Phase 1: Information Gathering — Current State Assessment

### Current SuperRoo Architecture

| Component | Current State | Theia Target |
|-----------|--------------|--------------|
| [`Agent`](src/super-roo/types/index.ts:471) | `{ name, description, requiredCapabilities, run() }` | `{ id, name, description, variables, prompts: PromptVariantSet[], languageModelRequirements, tags, functions }` |
| [`CoderAgent`](src/super-roo/agents/CoderAgent.ts:58) | Single mode, flat system prompt | 3 modes (Edit/Agent/Agent Next) via PromptVariantSet |
| [`ArchitectAgent`](src/super-roo/agents/DebuggerAgent.ts:46) | Single mode, no plan→coder handoff | 3 modes (Plan/Simple/Plan Next) + "Execute with Coder" |
| [`AgentRegistry`](src/super-roo/orchestrator/AgentRegistry.ts:12) | Simple Map<string, Agent> | Typed registry with prompt variant resolution |
| [MCP Bridge](scripts/mcp-codex-bridge.mjs) | CLI script, no lifecycle | `MCPServerManager` with start/stop/callTool/notify |
| [Providers](cloud/api/api.js:1691) | Monolithic array in api.js | Modular packages per provider |
| [Reasoning](cloud/api/api.js:1707) | `capabilities: ["reasoning"]` string | `ReasoningLevel` typed enum with per-provider mapping |
| [Prompts](src/super-roo/agents/CoderAgent.ts:37) | `systemPromptPreamble?: string` | `PromptVariantSet` with `defaultVariant` + `variants[]` |
| [Skills](.roo/skills/) | SKILL.md with YAML frontmatter | Same + `allowedTools` for tool restriction |
| [Collaboration](cloud/) | None | Real-time file system provider + workspace service |
| [Slash Commands](src/super-roo/) | None | `CommandPromptFragmentMetadata` with agent-specific routing |
| [Agent Variables](src/super-roo/types/index.ts) | None | `AgentSpecificVariables` with `name, description, usedInPrompt` |

### Key Files to Modify

| File | Change Type | Complexity |
|------|-------------|------------|
| `src/super-roo/types/index.ts` | Refactor Agent interface | Medium |
| `src/super-roo/agents/CoderAgent.ts` | Add modes + PromptVariantSet | Medium |
| `src/super-roo/agents/DebuggerAgent.ts` | Add modes + Architect-like planning | Medium |
| `src/super-roo/orchestrator/AgentRegistry.ts` | Add variant resolution | Low |
| `src/super-roo/core/types.ts` | Align SuperRooAgent with Agent | Low |
| `cloud/orchestrator/mcp/` (new) | MCP server manager | High |
| `src/super-roo/providers/` (new) | Provider abstraction layer | High |
| `src/super-roo/prompts/` (new) | Prompt variant system | High |
| `src/super-roo/chat/` (new) | Slash command system | Medium |
| `.roo/skills/validation.ts` (new) | Skill tool restriction validation | Low |
| `cloud/collaboration/` (new) | Collaboration foundation | Very High |

---

## Phase 2: Hypothesis Formation — Adoption Strategy

### Hypothesis 1: Incremental adoption via typed interfaces

**If** we first refactor the `Agent` interface to match Theia's typed contract, **then** all downstream changes (modes, prompts, variables) become natural extensions rather than breaking changes.

**Evidence**: Theia's `Agent` interface is the foundation that all other features build on. The `PromptVariantSet`, `LanguageModelRequirement`, and `tags` are all properties of the Agent interface.

**Test**: Create the new `Agent` interface alongside the old one, implement it in CoderAgent, verify AgentRegistry still works.

### Hypothesis 2: MCP server manager as a standalone module

**If** we build the MCP server manager as a standalone module in `cloud/orchestrator/mcp/`, **then** it can be used by both the cloud API and the VS Code extension without coupling.

**Evidence**: Theia's `MCPServerManagerImpl` is a single injectable class with no dependencies on the rest of Theia's AI system.

**Test**: Build a standalone `MCPServerManager` that can start/stop/callTool MCP servers, verify it works with existing DeepSeek and Ollama MCP configs.

### Hypothesis 3: Provider abstraction as a bridge layer

**If** we create a provider abstraction layer with `ReasoningLevel` mapping, **then** the monolithic provider config in api.js can be gradually extracted without breaking existing functionality.

**Evidence**: Theia's `LanguageModelRegistry` and `ReasoningSupport` are clean abstractions that don't require rewriting existing provider code.

**Test**: Create the `ReasoningLevel` type and a mapper for DeepSeek/OpenAI/Anthropic, verify existing chat completion still works.

---

## Phase 3: Solution Design — Phased Implementation Plan

### Phase 1: Foundation — Typed Agent Interface & Mode Definitions (Week 1-2)

**Goal**: Refactor the Agent interface to match Theia's typed contract, add mode definitions to CoderAgent and DebuggerAgent.

#### Step 1.1: Refactor Agent Interface

**File**: [`src/super-roo/types/index.ts`](src/super-roo/types/index.ts)

```typescript
// New types to add
export interface PromptVariantSet {
    id: string;
    defaultVariant: BasePromptFragment;
    variants?: BasePromptFragment[];
}

export interface LanguageModelRequirement {
    purpose: string;
    identifier: string;
}

export interface AgentSpecificVariables {
    name: string;
    description: string;
    usedInPrompt: boolean;
}

// Enhanced Agent interface
export interface Agent {
    readonly name: string;
    readonly description: string;
    readonly requiredCapabilities: Capability[];
    readonly prompts?: PromptVariantSet[];
    readonly languageModelRequirements?: LanguageModelRequirement[];
    readonly tags?: string[];
    readonly variables?: string[];
    readonly functions?: string[];
    readonly agentSpecificVariables?: AgentSpecificVariables[];
    run(ctx: AgentRunContext): Promise<AgentRunResult>;
}
```

**Migration**: Keep old interface working via optional fields. Agents that don't use new fields continue to work unchanged.

#### Step 1.2: Add Mode Definitions to CoderAgent

**File**: [`src/super-roo/agents/CoderAgent.ts`](src/super-roo/agents/CoderAgent.ts)

```typescript
// Add mode definitions
const CODER_EDIT_MODE = 'edit';
const CODER_AGENT_MODE = 'agent';
const CODER_AGENT_MODE_NEXT = 'agent-next';

export class CoderAgent implements Agent {
    readonly name = "coder";
    readonly prompts: PromptVariantSet[] = [{
        id: 'coder-system-prompt',
        defaultVariant: { id: CODER_AGENT_MODE, template: getAgentModePrompt() },
        variants: [
            { id: CODER_EDIT_MODE, template: getEditModePrompt() },
            { id: CODER_AGENT_MODE_NEXT, template: getAgentModeNextPrompt() },
        ]
    }];
    // ... existing code
}
```

#### Step 1.3: Add Mode Definitions to DebuggerAgent (Architect-like)

**File**: [`src/super-roo/agents/DebuggerAgent.ts`](src/super-roo/agents/DebuggerAgent.ts)

```typescript
const DEBUG_PLAN_MODE = 'plan';
const DEBUG_SIMPLE_MODE = 'simple';
const DEBUG_DEEP_MODE = 'deep';

export class DebuggerAgent implements Agent {
    readonly name = "debugger";
    readonly prompts: PromptVariantSet[] = [{
        id: 'debugger-system-prompt',
        defaultVariant: { id: DEBUG_PLAN_MODE, template: getDebugPlanPrompt() },
        variants: [
            { id: DEBUG_SIMPLE_MODE, template: getDebugSimplePrompt() },
            { id: DEBUG_DEEP_MODE, template: getDebugDeepPrompt() },
        ]
    }];
    // ... existing code
}
```

**Deliverables**:
- [ ] New types in `src/super-roo/types/index.ts`
- [ ] CoderAgent with 3 modes
- [ ] DebuggerAgent with 3 modes
- [ ] AgentRegistry variant resolution
- [ ] Tests pass

---

### Phase 2: Prompt System — Variants & Slash Commands (Week 3-4)

**Goal**: Build the prompt variant system with user customization and slash commands.

#### Step 2.1: Prompt Fragment Types

**New file**: [`src/super-roo/prompts/types.ts`](src/super-roo/prompts/types.ts)

```typescript
export interface BasePromptFragment {
    id: string;
    template: string;
    name?: string;
    description?: string;
    isCommand?: boolean;
    commandName?: string;
    commandDescription?: string;
    commandArgumentHint?: string;
    commandAgents?: string[];
}

export interface CustomizedPromptFragment extends BasePromptFragment {
    customizationId: string;
    priority: number;
}

export type PromptFragment = BasePromptFragment | CustomizedPromptFragment;

export interface ResolvedPromptFragment {
    id: string;
    text: string;
    variables?: ResolvedAIVariable[];
}
```

#### Step 2.2: Prompt Service

**New file**: [`src/super-roo/prompts/PromptService.ts`](src/super-roo/prompts/PromptService.ts)

```typescript
export class PromptService {
    private builtInFragments: Map<string, PromptFragment[]> = new Map();
    private customFragments: Map<string, CustomizedPromptFragment[]> = new Map();
    private variantSets: Map<string, { defaultVariant: string; variants: string[] }> = new Map();

    getResolvedPromptFragment(id: string, variables?: Record<string, unknown>): Promise<ResolvedPromptFragment | undefined>;
    getCommands(agentId?: string): PromptFragment[];
    updateSelectedVariant(agentId: string, variantSetId: string, variantId: string): Promise<void>;
    createCustomization(fragmentId: string): Promise<void>;
    editCustomization(fragmentId: string, customizationId: string): Promise<void>;
    removeCustomization(fragmentId: string, customizationId: string): Promise<void>;
}
```

#### Step 2.3: Slash Command Integration

**New file**: [`src/super-roo/chat/SlashCommandHandler.ts`](src/super-roo/chat/SlashCommandHandler.ts)

```typescript
export class SlashCommandHandler {
    private commands: Map<string, PromptFragment> = new Map();

    registerCommand(fragment: PromptFragment): void;
    getCommandsForAgent(agentId: string): PromptFragment[];
    handleCommand(input: string, agentId: string): Promise<string>;
}
```

**Deliverables**:
- [ ] Prompt fragment types
- [ ] PromptService with variant resolution
- [ ] SlashCommandHandler
- [ ] Integration with existing chat system
- [ ] Tests pass

---

### Phase 3: MCP Server Manager (Week 5-6)

**Goal**: Build a production-grade MCP server manager with lifecycle management.

#### Step 3.1: MCP Server Manager

**New directory**: [`cloud/orchestrator/mcp/`](cloud/orchestrator/mcp/)

```
cloud/orchestrator/mcp/
├── MCPServerManager.js    # Main manager class
├── MCPServer.js           # Individual server wrapper
├── types.js               # Type definitions
└── index.js               # Module exports
```

**Key features**:
- `startServer(name)` — resolves config, starts server process, notifies clients
- `stopServer(name)` — gracefully stops server, cleans up resources
- `callTool(name, tool, args)` — calls a tool on a running server
- `getRunningServers()` — returns list of active servers
- `getServerDescription(name)` — returns server metadata
- `getTools(name)` — returns available tools for a server
- `readResource(name, resourceId)` — MCP resource protocol support
- `addOrUpdateServer(description)` — register or update a server config
- `removeServer(name)` — unregister and stop a server
- `setWorkspaceRoots(roots)` — propagate workspace roots to all servers

#### Step 3.2: MCP API Endpoints

**File**: [`cloud/api/api.js`](cloud/api/api.js)

```javascript
// New endpoints
GET  /api/mcp/servers          — List all configured servers
POST /api/mcp/servers/start    — Start a server
POST /api/mcp/servers/stop     — Stop a server
POST /api/mcp/servers/call     — Call a tool
GET  /api/mcp/servers/:name/tools  — List tools for a server
GET  /api/mcp/servers/running  — List running servers
```

#### Step 3.3: Dashboard MCP View

**File**: [`cloud/dashboard/src/components/views/mcp.tsx`](cloud/dashboard/src/components/views/mcp.tsx) (new)

- Server list with status indicators (running/stopped/error)
- Start/Stop buttons per server
- Tool list per server
- Real-time status updates via WebSocket

**Deliverables**:
- [ ] MCPServerManager with full lifecycle
- [ ] MCP API endpoints
- [ ] Dashboard MCP view
- [ ] Integration with existing DeepSeek/Ollama MCP configs
- [ ] Tests pass

---

### Phase 4: Provider Abstraction & Reasoning (Week 7-8)

**Goal**: Create a provider-agnostic reasoning abstraction and modular provider system.

#### Step 4.1: Reasoning Types

**New file**: [`src/super-roo/providers/types.ts`](src/super-roo/providers/types.ts)

```typescript
export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'auto';
export type ReasoningApi = 'effort' | 'budget';

export interface ReasoningSettings {
    level: ReasoningLevel;
}

export interface ReasoningSupport {
    supportedLevels: ReadonlyArray<ReasoningLevel>;
    defaultLevel?: ReasoningLevel;
}

export interface LanguageModelProvider {
    id: string;
    name: string;
    capabilities: string[];
    reasoning?: ReasoningSupport;
    chat(messages: LanguageModelMessage[], options?: ChatOptions): Promise<ChatResponse>;
}
```

#### Step 4.2: Provider Mappers

**New file**: [`src/super-roo/providers/reasoning-mappers.ts`](src/super-roo/providers/reasoning-mappers.ts)

```typescript
// Maps ReasoningLevel to each provider's native API
const REASONING_MAPPERS: Record<string, (level: ReasoningLevel) => Record<string, unknown>> = {
    deepseek: (level) => ({
        // DeepSeek R1 uses thinking budget
        thinking: level === 'off' ? undefined : { budget_tokens: REASONING_TOKENS[level] }
    }),
    openai: (level) => ({
        // OpenAI o-series uses reasoning_effort
        reasoning_effort: level === 'off' ? undefined : level
    }),
    anthropic: (level) => ({
        // Anthropic Claude uses extended thinking
        thinking: level === 'off' ? undefined : { type: 'enabled', budget_tokens: REASONING_TOKENS[level] }
    }),
};
```

#### Step 4.3: Provider Registry

**New file**: [`src/super-roo/providers/ProviderRegistry.ts`](src/super-roo/providers/ProviderRegistry.ts)

```typescript
export class ProviderRegistry {
    private providers: Map<string, LanguageModelProvider> = new Map();

    register(provider: LanguageModelProvider): void;
    getProvider(id: string): LanguageModelProvider | undefined;
    getProviders(): LanguageModelProvider[];
    selectProvider(request: ProviderSelector): LanguageModelProvider | undefined;
    getSupportedReasoningLevels(providerId: string): ReasoningLevel[];
}
```

**Deliverables**:
- [ ] Reasoning types and mappers
- [ ] ProviderRegistry
- [ ] Integration with existing api.js provider config
- [ ] Dashboard reasoning level selector
- [ ] Tests pass

---

### Phase 5: Skill Tool Restrictions (Week 9)

**Goal**: Add `allowedTools` security sandboxing to the skill system.

#### Step 5.1: Skill Validation

**New file**: [`.roo/skills/validation.ts`](.roo/skills/validation.ts)

```typescript
export interface SkillToolPolicy {
    allowedTools?: string[];
    deniedTools?: string[];
}

export function validateSkillToolUse(
    skill: SkillDescription,
    toolName: string
): { allowed: boolean; reason?: string } {
    if (skill.allowedTools && !skill.allowedTools.includes(toolName)) {
        return { allowed: false, reason: `Tool "${toolName}" not in skill's allowedTools` };
    }
    return { allowed: true };
}
```

#### Step 5.2: Runtime Enforcement

**File**: [`src/super-roo/safety/SafetyManager.ts`](src/super-roo/safety/SafetyManager.ts) (modify)

- Add skill tool policy check before tool execution
- Log denied tool attempts for audit
- Return clear error messages when a skill tries to use a disallowed tool

**Deliverables**:
- [ ] SkillToolPolicy types
- [ ] validateSkillToolUse function
- [ ] SafetyManager integration
- [ ] Tests pass

---

### Phase 6: Collaboration Foundation (Week 10-12)

**Goal**: Build the foundation for real-time collaborative editing.

#### Step 6.1: Collaboration Service

**New directory**: [`cloud/collaboration/`](cloud/collaboration/)

```
cloud/collaboration/
├── CollaborationService.js    # Main service
├── WorkspaceProvider.js       # Shared workspace management
├── CursorSync.js              # Real-time cursor/selection sync
├── FileSync.js                # File change propagation
└── index.js                   # Module exports
```

#### Step 6.2: WebSocket Protocol

Extend existing WebSocket infrastructure for collaboration events:

```javascript
// Collaboration events
{
    type: 'collab:join',
    sessionId: string,
    userId: string,
    workspaceId: string
}
{
    type: 'collab:cursor',
    sessionId: string,
    userId: string,
    position: { line: number, column: number },
    selection?: { start: Position, end: Position }
}
{
    type: 'collab:file-change',
    sessionId: string,
    userId: string,
    filePath: string,
    changes: TextChange[]
}
```

#### Step 6.3: Dashboard Collaboration UI

**File**: [`cloud/dashboard/src/components/views/collaboration.tsx`](cloud/dashboard/src/components/views/collaboration.tsx) (new)

- Session list with active collaborators
- Cursor position indicators
- File change notifications
- Join/Leave controls

**Deliverables**:
- [ ] CollaborationService with WebSocket protocol
- [ ] WorkspaceProvider for shared workspaces
- [ ] CursorSync for real-time cursor sharing
- [ ] Dashboard collaboration UI
- [ ] Tests pass

---

### Phase 7: Modular Provider Extraction (Week 13-14)

**Goal**: Extract providers from monolithic api.js into modular packages.

#### Step 7.1: Provider Package Structure

```
cloud/providers/
├── deepseek/
│   ├── package.json
│   ├── index.js
│   └── README.md
├── openai/
│   ├── package.json
│   ├── index.js
│   └── README.md
├── anthropic/
│   ├── package.json
│   ├── index.js
│   └── README.md
├── ollama/
│   ├── package.json
│   ├── index.js
│   └── README.md
├── kimi/
│   ├── package.json
│   ├── index.js
│   └── README.md
├── openrouter/
│   ├── package.json
│   ├── index.js
│   └── README.md
├── groq/
│   ├── package.json
│   ├── index.js
│   └── README.md
└── registry.js              # Auto-discovers installed providers
```

#### Step 7.2: Provider Registry

**New file**: [`cloud/providers/registry.js`](cloud/providers/registry.js)

```javascript
class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }

    async discover() {
        // Auto-discover installed provider packages
        const providerDirs = await fs.readdir(path.join(__dirname));
        for (const dir of providerDirs) {
            const pkgPath = path.join(__dirname, dir, 'package.json');
            if (fs.existsSync(pkgPath)) {
                const provider = require(path.join(__dirname, dir));
                this.providers.set(provider.id, provider);
            }
        }
    }

    getProvider(id) { return this.providers.get(id); }
    getProviders() { return Array.from(this.providers.values()); }
}
```

**Deliverables**:
- [ ] Provider packages extracted
- [ ] ProviderRegistry with auto-discovery
- [ ] Backward-compatible api.js integration
- [ ] Tests pass

---

## Phase 4: Implementation — Execution Plan

### Week 1-2: Phase 1 — Foundation
```
Day 1-2:  Refactor Agent interface in src/super-roo/types/index.ts
Day 3-5:  Add mode definitions to CoderAgent
Day 6-7:  Add mode definitions to DebuggerAgent
Day 8-10: Update AgentRegistry for variant resolution
Day 11-14: Tests and bug fixes
```

### Week 3-4: Phase 2 — Prompt System
```
Day 1-3:  Create prompt fragment types
Day 4-7:  Build PromptService
Day 8-10: Build SlashCommandHandler
Day 11-14: Integration and tests
```

### Week 5-6: Phase 3 — MCP Server Manager
```
Day 1-3:  Build MCPServer and MCPServerManager
Day 4-6:  Add MCP API endpoints
Day 7-9:  Build dashboard MCP view
Day 10-12: Integration with existing MCP configs
Day 13-14: Tests and bug fixes
```

### Week 7-8: Phase 4 — Provider Abstraction
```
Day 1-3:  Create reasoning types and mappers
Day 4-7:  Build ProviderRegistry
Day 8-10: Integrate with api.js
Day 11-14: Dashboard reasoning selector + tests
```

### Week 9: Phase 5 — Skill Tool Restrictions
```
Day 1-2:  Create SkillToolPolicy types
Day 3-4:  Build validateSkillToolUse
Day 5:    Integrate with SafetyManager
Day 6-7:  Tests
```

### Week 10-12: Phase 6 — Collaboration
```
Day 1-5:  Build CollaborationService + WebSocket protocol
Day 6-10: Build WorkspaceProvider + CursorSync
Day 11-15: Build dashboard collaboration UI
Day 16-21: Integration tests and bug fixes
```

### Week 13-14: Phase 7 — Modular Providers
```
Day 1-5:  Extract deepseek, openai, anthropic providers
Day 6-8:  Extract ollama, kimi, openrouter, groq providers
Day 9-11: Build ProviderRegistry with auto-discovery
Day 12-14: Integration tests and backward compatibility
```

---

## Phase 5: Systemic Improvement — Guardrails & Testing

### Test Strategy

| Phase | Test Type | Coverage Target |
|-------|-----------|-----------------|
| 1 | Unit tests for Agent interface + modes | 90% |
| 2 | Unit tests for PromptService + SlashCommandHandler | 90% |
| 3 | Integration tests for MCP lifecycle | 85% |
| 4 | Unit tests for reasoning mappers | 95% |
| 5 | Unit tests for skill validation | 100% |
| 6 | Integration tests for collaboration WebSocket | 80% |
| 7 | Integration tests for provider discovery | 90% |

### Migration Guardrails

1. **Backward compatibility**: All new interfaces use optional fields — existing agents continue to work unchanged
2. **Feature flags**: Each phase introduces a feature flag (`SUPERROO_THEIA_AGENT`, `SUPERROO_THEIA_MCP`, etc.) for gradual rollout
3. **No breaking changes to api.js**: Provider extraction preserves existing endpoints
4. **Graceful degradation**: If MCP server manager fails, fall back to existing script-based bridge
5. **Documentation**: Each phase updates [`docs/resources/working-tree.md`](docs/resources/working-tree.md) and [`AGENTS.md`](AGENTS.md)

### Monitoring

- MCP server health metrics (uptime, tool call latency, error rate)
- Provider usage statistics (which providers, models, reasoning levels)
- Collaboration session metrics (active sessions, file changes, users)
- Skill tool policy violation logs

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent interface refactor breaks existing agents | Medium | High | Use optional fields, comprehensive test suite |
| MCP server manager has race conditions | Medium | Medium | Use locking, test with concurrent tool calls |
| Provider extraction breaks existing API | Low | High | Preserve existing endpoints, feature flag |
| Collaboration WebSocket conflicts with existing protocol | Medium | Medium | Namespace collaboration events separately |
| Skill tool restrictions break existing skills | Low | Medium | Default allow when `allowedTools` is undefined |
| Scope creep into full Theia integration | Medium | High | Strict phase boundaries, out-of-scope list |

---

## Success Criteria

1. **All 7 phases complete** with tests passing
2. **Zero breaking changes** to existing agent functionality
3. **MCP server manager** handles 10+ concurrent tool calls
4. **Reasoning abstraction** works across DeepSeek, OpenAI, Anthropic
5. **Prompt variant system** supports user customization via settings UI
6. **Slash commands** work in chat with agent-specific routing
7. **Skill tool restrictions** block unauthorized tool use
8. **Collaboration** supports 5+ concurrent users in a workspace
9. **Modular providers** auto-discover without manual registration
10. **All existing tests pass** after each phase

---

## Appendix: Key File Map

| New/Modified File | Phase | Purpose |
|------------------|-------|---------|
| `src/super-roo/types/index.ts` | 1 | Enhanced Agent interface |
| `src/super-roo/agents/CoderAgent.ts` | 1 | Mode definitions + PromptVariantSet |
| `src/super-roo/agents/DebuggerAgent.ts` | 1 | Mode definitions + PromptVariantSet |
| `src/super-roo/orchestrator/AgentRegistry.ts` | 1 | Variant resolution |
| `src/super-roo/prompts/types.ts` | 2 | Prompt fragment types |
| `src/super-roo/prompts/PromptService.ts` | 2 | Prompt variant resolution |
| `src/super-roo/chat/SlashCommandHandler.ts` | 2 | Slash command system |
| `cloud/orchestrator/mcp/MCPServerManager.js` | 3 | MCP lifecycle management |
| `cloud/orchestrator/mcp/MCPServer.js` | 3 | Individual server wrapper |
| `cloud/api/api.js` | 3 | MCP API endpoints |
| `cloud/dashboard/src/components/views/mcp.tsx` | 3 | Dashboard MCP view |
| `src/super-roo/providers/types.ts` | 4 | Reasoning types |
| `src/super-roo/providers/reasoning-mappers.ts` | 4 | Per-provider reasoning mapping |
| `src/super-roo/providers/ProviderRegistry.ts` | 4 | Provider registry |
| `.roo/skills/validation.ts` | 5 | Skill tool restriction validation |
| `src/super-roo/safety/SafetyManager.ts` | 5 | Runtime enforcement |
| `cloud/collaboration/CollaborationService.js` | 6 | Collaboration service |
| `cloud/collaboration/WorkspaceProvider.js` | 6 | Shared workspace |
| `cloud/collaboration/CursorSync.js` | 6 | Real-time cursor sync |
| `cloud/dashboard/src/components/views/collaboration.tsx` | 6 | Dashboard collaboration UI |
| `cloud/providers/deepseek/index.js` | 7 | Modular DeepSeek provider |
| `cloud/providers/openai/index.js` | 7 | Modular OpenAI provider |
| `cloud/providers/anthropic/index.js` | 7 | Modular Anthropic provider |
| `cloud/providers/registry.js` | 7 | Auto-discovery registry |
