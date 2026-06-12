# SKILL.md — clamav-scan-local-docker

This document is the canonical spec for the **ClamAV local Docker scanning** skill.

## Identity
- **Skill slug:** `clamav-scan-local-docker`

## Purpose
Provide malware scanning powered by **ClamAV running as a local Docker container** on the VPS.

## Supported scan modes
1. **path** (Mode A): scan a specific VPS directory/file path.
2. **laptop-export** (Mode B): scan the directory that represents the laptop export/mirror created by the extension.
3. **auto**: infer mode based on caller metadata.

## Required parameter contract
- `targetPath` (string, absolute path on VPS)

## Parameters
- `mode` (string): "path" | "laptop-export" | "auto" (optional)
- `recursive` (boolean, default true)
- `maxFiles` (number|null)
- `maxSizeMB` (number|null)
- `quarantine` (boolean, default false)
- `quarantineDir` (string, optional)
- `infectedOnly` (boolean, default true)
- `databaseUpdated` (boolean|null)

## Command strategy (conceptual)
- Use a local ClamAV Docker container.
- Bind-mount the `targetPath` (read-only) into the ClamAV container.
- Run `clamscan`.
- Parse output.

> Implementation detail note: the exact docker command is stored in the Security Agent resources doc.

## Output contract
Return structured JSON matching the skill README:
- `summary`
- `stats`
- `infectedFiles`
- `clamav`
- `raw`

## Integration requirements
- The calling Security Agent must write a markdown job summary into its `outputs/` directory.
- The calling extension must pass `targetPath` correctly.

## Security constraints
- Ensure quarantining is opt-in.
- Avoid scanning outside approved roots unless explicitly permitted.

