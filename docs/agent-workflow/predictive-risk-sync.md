# Predictive Risk Sync

SuperRoo agents share one predictive risk surface through Codex Brain:

- CLI: `superroo-risk-assess "<task>" --files "path1,path2"`
- MCP: `risk_assess`, `risk_record_pattern`, `risk_stats`
- Store: `~/.superroo/memory/predictive-risk`

## Agent Rule

Codex, Kilo Code, Claude, and future extensions must run `risk_assess` before coding, config edits, database migrations, deletes, restarts, deploys, and other project-changing work.

High or critical risk means:

1. Route through `smart_code` or `code_pro_verified`.
2. Write a concrete verification and rollback plan.
3. Record any newly discovered reusable failure cause with `risk_record_pattern`.

## What The Engine Scores

The shared engine is dependency-free and works without PostgreSQL, so it can run locally, inside extension MCP clients, or on the VPS.

Signals include:

- Action type: code, config change, refactor, database migration, Docker, deploy, delete, restart
- Sensitive files: auth, secrets, environment config, payments, migrations, deploy pipelines, dependencies
- Logs: timeouts, crashes, OOM, auth failures, connection failures, rate limits
- Commands: destructive deletes, disk writes, recursive permission changes, publish, reboot
- Blast radius: number of files touched
- Verification signal: tests, specs, verify commands, or test files
- Historical patterns recorded in the shared risk store

## Integration Points

- `scripts/shared-risk-engine.mjs` is the canonical risk kernel.
- `scripts/codex-brain.mjs smart` uses the risk score to escalate routing.
- `scripts/codex-brain-mcp.mjs` exposes risk tools to MCP-aware extensions.
- `scripts/install-global-codex-brain.mjs` installs wrappers and configures the shared risk directory.
- Global Codex, Kilo Code, and Claude configs point at the same `SUPERROO_RISK_DIR`.
