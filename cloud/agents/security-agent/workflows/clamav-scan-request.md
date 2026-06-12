# Workflow: clamav-scan-request

## Goal
Process a security scan request from any extension (global + cross-extension) and run ClamAV local Docker scan on VPS.

## Inputs
- `targetPath` (required)
- `mode` (`path | laptop-export | auto`)
- `recursive` (default true)
- `infectedOnly` (default true)

## Steps
1. Validate `targetPath` exists and is within allowed roots.
2. Build scan command for local ClamAV Docker.
3. Execute scan command in sandbox job.
4. Parse scan result:
   - `exitCode = 0` => clean
   - `exitCode = 1` => infected files found
   - other => scan error
5. Write summary markdown to `outputs/<jobId>.summary.md`.
6. Return structured result payload to caller.

## Command template
```bash
if [ ! -e "${TARGET_PATH}" ]; then
  echo "Target path not found: ${TARGET_PATH}"
  exit 2
fi

docker run --rm \
  -v "${TARGET_PATH}:/scan:ro" \
  clamav/clamav:latest \
  clamscan -r --infected /scan
```

## Output contract
- `status`: `clean | infected | error`
- `infectedCount`
- `infectedFiles[]`
- `logPath`
- `summary`
