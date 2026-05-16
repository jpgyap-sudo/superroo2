# Phase 8 Prompt — Autonomous Loop

Build the full autonomous loop controller for Super Roo.

Requirements:
- Load product feature registry
- Pick highest priority task
- Ask Security Agent for scope approval
- Ask Coder Agent to implement
- Ask Tester Agent to test
- If test fails, ask Debugger Agent to diagnose
- Repeat until success or max iterations
- Commit on success
- Optional deploy if enabled
- Store result in memory
- Generate final report

Folder target:
`src/super-roo/runtime/`

Create:
- `autonomous-loop.ts`
- `autonomous-run-report.ts`
- `autonomous-config.ts`

Config:
```json
{
  "maxIterations": 5,
  "allowFileEdits": true,
  "allowCommit": true,
  "allowStagingDeploy": false,
  "allowProductionDeploy": false,
  "permissionLevel": 2
}
```

Final report must include:
- goal
- files changed
- tests run
- bugs found
- bugs fixed
- remaining issues
- deployment status
- rollback status
- next recommended action
