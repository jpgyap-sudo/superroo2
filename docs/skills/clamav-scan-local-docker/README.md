# clamav-scan-local-docker

A SuperRoo **skill** that performs malware scanning using **ClamAV running as a local Docker container on the VPS**.

This skill is designed to be used by a **Security Agent** (global + cross-extension). It supports scanning:

- **Mode A (recommended):** scan a specific filesystem path on the VPS (or a directory mounted/exported to the VPS).
- **Mode B (laptop-as-a-whole):** scan the laptop export/workspace provided by your coding extension environment (or a mapped/mirrored directory on the VPS). This is only as complete as what the extension uploads/mounts.

> Security note: ClamAV Docker runs **locally on the VPS**. The agent should never exfiltrate files off-VPS.

## When to use
- Before accepting new code/workspace changes for deployment.
- When the extension detects suspicious downloads/artifacts.
- For periodic “at rest” scanning of workspace exports.

## Inputs
All inputs are provided by the calling agent.

### Required
- `targetPath` (string): Absolute path on the VPS filesystem to scan.

### Optional
- `mode` ("path" | "laptop-export" | "auto"): determines scanning semantics.
  - `path` => trust `targetPath` as the scan root.
  - `laptop-export` => treat `targetPath` as the extension-provided laptop export root.
  - `auto` => use `mode` hints if present.
- `recursive` (boolean, default: true): recurse into subdirectories.
- `maxFiles` (number | null): safety bound to prevent extremely large scans.
- `maxSizeMB` (number | null): skip files larger than this.
- `quarantine` (boolean, default: false): if true and your policy allows, move infected files to a quarantine folder.
- `quarantineDir` (string): quarantine directory on VPS.
- `infectedOnly` (boolean, default: true): if true, only return infected file paths.
- `databaseUpdated` (boolean | null): if caller knows signatures are fresh, can skip signature update.

## Execution flow (high level)
1. Ensure (or refresh) ClamAV signatures using `freshclam` (optional depending on `databaseUpdated`).
2. Run `clamscan` against `targetPath`.
3. Parse output into a structured result.
4. Write a markdown summary file to the agent’s job outputs folder.

## Output schema
The skill should return:

- `summary` (string): human-readable scan summary.
- `stats` (object):
  - `filesScanned` (number)
  - `infectedCount` (number)
  - `warnings` (string[])
- `infectedFiles` (array of objects):
  - `path` (string)
  - `signature` (string)
  - `foundAt` (string, ISO time)
- `clamav` (object):
  - `dbVersion` (string | null)
  - `command` (string)
- `raw` (string): raw clamscan stdout/stderr for auditing.

## Output formatting for the Security Agent
The calling Security Agent should include:

- A short executive summary (infected files + counts)
- The `targetPath` and scan mode
- A list of infected file paths (redacted if needed)
- A reference to the job summary markdown artifact

## Global + cross-extension wiring
To make this skill available globally:
- Create a **Security Agent** that references this skill as a `skills` entry.
- Configure the extension to call the Security Agent via the VPS API:
  - `POST /agents/security-agent/run` (or your chosen agent id)
- Ensure the extension sets `targetPath` to:
  - Mode A: the path the extension already uploaded/mirrored to VPS
  - Mode B: the path of the laptop export root that the extension provides

## Safety / policy rules
- Never scan secrets using patterns (AWS keys, .env, browser profiles) unless explicitly authorized.
- For huge directories, require `maxFiles` and enforce a timeout.
- Prefer scanning **exports** (extension-provided mirror directory) over raw laptop mounts.

