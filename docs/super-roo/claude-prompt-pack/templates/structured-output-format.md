# Required Claude Output Format

```text
PHASE SUMMARY
- What this phase adds:
- Files created:
- Files modified:
- Tests added:
- How to run:
- Risks:

FILE: src/example/path.ts
```ts
// full file content
```

FILE: src/example/path.test.ts
```ts
// full test content
```
```

Rules:
- Always include full file content.
- Never say "same as above".
- Never omit imports.
- Include exact commands to run tests.
- Mention integration risks.
