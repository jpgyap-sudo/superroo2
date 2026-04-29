# Phase 5 Prompt — Testing System

Build the Super Roo testing system.

Requirements:
- Run npm scripts if present:
  - lint
  - typecheck
  - test
  - build
- Run Playwright if installed
- Capture stdout/stderr
- Return structured test results
- Mark task as pass/fail

Folder target:
`src/super-roo/tester/`

Create:
- `command-runner.ts`
- `test-runner.ts`
- `lint-runner.ts`
- `typecheck-runner.ts`
- `playwright-runner.ts`
- `health-check-runner.ts`
- `tester.agent.ts`

Test result format:
```json
{
  "command": "",
  "passed": true,
  "exitCode": 0,
  "stdout": "",
  "stderr": "",
  "durationMs": 0
}
```

Add tests by mocking child_process.
