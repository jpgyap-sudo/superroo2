# Skill: clamav-scan-local-docker (Agent-local)

Use local ClamAV Docker on VPS to scan either:
1) A specific filesystem path, or
2) A full laptop export/mirror directory synced by extension.

## Input contract
- `targetPath` (required): absolute VPS path
- `mode` (optional): `path | laptop-export | auto`
- `recursive` (optional, default true)
- `infectedOnly` (optional, default true)
- `maxFiles` / `maxSizeMB` (optional safety limits)

## Execution command pattern
The agent runner should use a job command pattern like:

1. ensure target exists
2. run clamd/clamav scan via local docker
3. emit JSON + markdown summary to output dir

Example command (reference, adapt to environment):
```bash
docker run --rm \
  -v "${TARGET_PATH}:/scan:ro" \
  clamav/clamav:latest \
  clamscan -r --infected /scan
```

## Output required
- Infected file list
- Signature names
- Summary counts
- Raw stdout/stderr attached to output markdown
