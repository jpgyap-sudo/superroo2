# Claude Code VS Code Auth / 403 Debug Log

Purpose: keep an append-only elimination record for Claude Code and the Claude VS Code extension when sign-in is not detected or requests return 403. Use this before repeating fixes.

Canonical global record:

```text
C:/Users/user/.superroo/resources/claude-code-auth-debug.md
```

This repo-local file mirrors the global record for project visibility. Append new cross-extension evidence to the global record first.

## Current Working Theory

As of 2026-06-07, the SuperRoo MCP side is healthy after restart, but Claude Code itself is not logged in. The latest evidence points to first-party Claude auth/session state, not a SuperRoo MCP configuration failure.

## Known References

- Official Claude VS Code troubleshooting: https://code.claude.com/docs/en/vs-code#troubleshooting
- Canonical local repair skill: `C:/Users/user/.superroo/skills/claude-code-repair/SKILL.md`
- Canonical local repair resource: `C:/Users/user/.superroo/resources/claude-code-troubleshooting.md`

## Elimination Matrix

| Hypothesis | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Claude Code CLI missing or old | Eliminated | `where.exe claude` found `C:\Users\user\nodejs\claude` and `claude --version` returned `2.1.162 (Claude Code)`. | Re-check only after CLI upgrade/reinstall. |
| Stale persistent `CLAUDE_CODE_OAUTH_TOKEN` env var | Eliminated for 2026-06-07 run | User, Machine, and Process env checks showed no Claude/Anthropic token or API key variables set. | Re-check if 403 returns after future env changes. |
| SuperRoo HTTP MCP server is down | Fixed / separated | Initial `/health` and `/tools` failed on `127.0.0.1:3419`; after starting `npx tsx server/src/memory/McpMemoryServer.ts`, both returned HTTP 200. | Keep MCP running; do not treat remaining auth failure as MCP until CLI auth passes. |
| Claude VS Code stale IDE lock files | Fixed | Found 17 stale `.claude/ide/*.lock` files pointing at dead PIDs; removed only those stale files. | If extension fails after login, inspect new lock files and alive PIDs. |
| Claude Code first-party login missing | Confirmed | `claude auth status` returned `loggedIn: false`, `authMethod: none`, `apiProvider: firstParty`. CLI smoke test returned `Not logged in - Please run /login`. | Complete `claude auth login --claudeai` interactively, then reload VS Code. |
| VS Code extension not inheriting shell env | Not primary in this run | No persistent API key/token env was set, so inheritance does not explain the failure. | If using API-key auth later, launch VS Code from terminal with `code .`. |
| Account/subscription/policy limit or credits issue | Still possible | `.claude.json` had cached `out_of_credits` / forbidden-style state, and logs showed `Request not allowed`; this cannot be fully tested until login completes. | After successful login, run CLI smoke test. If 403 remains, treat as account/plan/policy issue. |
| Claude remote MCP connector missing scope | Possible secondary issue | Older debug logs included missing `user:mcp_servers` scope with scopes limited to `user:inference`. This may affect Claude.ai MCP connectors, not local SuperRoo MCP. | Re-test only after primary Claude login succeeds. |

## 2026-06-07 Attempt - Codex

Agent/model: Codex / GPT-5

### User Symptom

Claude VS Code extension does not detect sign-in or returns error 403.

### Evidence Collected

- Official Claude VS Code docs say first panel use requires browser sign-in; if the sign-in screen does not reappear, run **Developer: Reload Window**.
- `claude --version` returned `2.1.162 (Claude Code)`.
- Token/API-key env check showed no values set for:
  - `CLAUDE_CODE_OAUTH_TOKEN`
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_AUTH_TOKEN`
  - `HTTPS_PROXY`
  - `HTTP_PROXY`
- `claude auth status` returned:
  - `loggedIn: false`
  - `authMethod: none`
  - `apiProvider: firstParty`
- Latest VS Code Claude logs showed repeated `No authentication found`.
- Latest VS Code Claude logs showed `claude_authenticate flow ended: AxiosError: Request failed with status code 403`.
- Latest VS Code Claude logs showed telemetry export 403s. These are not sufficient by themselves to diagnose MCP failure.
- Initial SuperRoo MCP HTTP checks failed:
  - `http://127.0.0.1:3419/health`
  - `http://127.0.0.1:3419/tools`
- After restart, both SuperRoo MCP checks returned HTTP 200.
- `node scripts/test-claude-mcp-workflow.mjs --verbose` exited successfully.
- `.claude/ide` had 17 stale lock files pointing at dead PIDs.

### Fixes Applied

- Removed only stale dead-PID files from `C:/Users/user/.claude/ide`.
- Restarted SuperRoo HTTP MCP memory server with `npx tsx server/src/memory/McpMemoryServer.ts`.
- Verified `http://127.0.0.1:3419/health` returned HTTP 200.
- Verified `http://127.0.0.1:3419/tools` returned HTTP 200.
- Opened an interactive PowerShell login flow:

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN=$null
cd C:\Users\user\Documents\superroo2
claude auth login --claudeai
```

### Result

Partial. Local MCP and stale IDE state were repaired, but Claude auth remains blocked on interactive OAuth completion. Final CLI smoke test still returns:

```text
Not logged in - Please run /login
```

### Required Next Checks

Run after completing the browser login flow:

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN=$null
claude auth status
claude -p "Reply exactly CLAUDE_AUTH_SMOKE_OK"
```

Expected pass state:

```text
CLAUDE_AUTH_SMOKE_OK
```

Then reload VS Code:

```text
Command Palette -> Developer: Reload Window
```

### If Still 403 After Login

Use this order:

1. Confirm `claude auth status` is logged in.
2. Run the CLI smoke test outside VS Code.
3. If CLI smoke test fails with 403, treat it as Anthropic account, plan, credits, subscription, or policy state.
4. If CLI smoke test passes but VS Code fails, reload VS Code and inspect new `Claude VSCode.log`.
5. If VS Code still fails, compare the extension-bundled native binary version with the terminal CLI version.
6. Only then inspect or reset Claude local auth/cache files, and back them up first.

## Append Template

```markdown
## YYYY-MM-DD Attempt - Agent

Agent/model:

### Symptom

### Evidence Collected

### Eliminated

### Fixes Applied

### Result

### Next Action
```
