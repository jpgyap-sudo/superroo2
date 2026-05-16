# Phase 3 Prompt — Debugger Agent

Build the Debugger Agent.

Requirements:
- Parse stack traces
- Read log files
- Classify error type
- Generate bug report JSON
- Recommend likely files to inspect
- Produce a focused task for Coder Agent

Error classes:
- dependency
- syntax
- type_error
- api_key_config
- network
- database
- auth
- frontend_runtime
- deployment
- unknown

Folder target:
`src/super-roo/debugger/`

Create:
- `log-reader.ts`
- `stacktrace-parser.ts`
- `api-error-analyzer.ts`
- `browser-error-analyzer.ts`
- `root-cause-engine.ts`
- `bug-report-writer.ts`
- `debugger.agent.ts`

Bug report format:
```json
{
  "title": "",
  "severity": "low|medium|high|critical",
  "status": "open|investigating|fixed|blocked",
  "symptoms": [],
  "logs": [],
  "suspectedRootCause": "",
  "filesLikelyInvolved": [],
  "reproductionSteps": [],
  "recommendedFix": "",
  "testsToRun": [],
  "deploymentRisk": "low|medium|high"
}
```

Add unit tests using sample logs.
