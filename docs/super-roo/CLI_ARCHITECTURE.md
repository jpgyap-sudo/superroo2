# SuperRoo CLI Architecture

## Purpose

The CLI and daemon let SuperRoo run when the VS Code UI is closed.

```text
VS Code Extension -> human dashboard
CLI Runner        -> local automation worker
Core Engine       -> shared brain and task contract
Daemon            -> always-on VPS runtime
Telegram Bot      -> remote trigger
GitHub/CI         -> safety gate
```

## Folder Design

```text
src/
  extension.ts                 VS Code extension entry
  cli/index.ts                 CLI command entry
  core/SuperRooTask.ts         shared command envelope
  core/SuperRooCore.ts         reusable CLI services
  core/runAutonomous.ts        shared autonomous entry
  core/commands/               CLI command handlers
  core/utils/                  shell and logging helpers
  super-roo-daemon/index.ts    VPS daemon
  telegram/bot.ts              Telegram-to-daemon bridge
```

## Commands

```bash
superroo autonomous
superroo task "fix failing tests"
superroo deploy
superroo check-vps
superroo debug-api
superroo status
```

When `SUPERROO_DAEMON_URL` is set, `superroo task` and `superroo autonomous` submit tasks to the daemon. Without it, the CLI runs locally.

## Rule

Automation logic belongs in `src/core`, not in the VS Code UI or Telegram bot. UI surfaces should create `SuperRooTask` commands and hand them to the core engine or daemon.
