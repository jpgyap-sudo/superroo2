# clamav-docker-local

## Goal
Run ClamAV as **local Docker on the VPS** and expose scanning results to SuperRoo agents.

## Recommended docker-compose (VPS-local)
Place a ClamAV service alongside your VPS runtime.

### Environment variables
- `CLAMAV_DATA_DIR` (host path): persistent location for ClamAV DB and scan state
- `CLAMAV_QUARANTINE_DIR` (host path): quarantine destination

### Service container (concept)
- image: `clamav/clamav:latest`
- mount:
  - `CLAMAV_DATA_DIR` → `/var/lib/clamav`
  - scan target path(s) → `/scan` (read-only)

### Signature updates
- Use `freshclam` periodically.
- If you cannot guarantee fresh signatures, always run `freshclam` before scanning.

## How scanning should be invoked
The agent should:
1. Pick `targetPath` on VPS.
2. Mount it read-only into the ClamAV container.
3. Execute:
   - `clamscan -r --infected --no-summary /scan` (recursive)
   - or a non-recursive variant when requested
4. Parse output.

## Scan output parsing guidance
`clamscan` typical infected lines look like:

`/scan/path/to/file: <signature>`

A final summary line indicates:
- number scanned
- number infected

Your parser should:
- treat lines containing `FOUND` or `Infected` depending on flags
- detect exit code: commonly `0` = no infection, `1` = infection found

## Quarantine behavior
If `quarantine=true`:
- move infected files to `quarantineDir` on VPS
- do not automatically delete unless policy allows

