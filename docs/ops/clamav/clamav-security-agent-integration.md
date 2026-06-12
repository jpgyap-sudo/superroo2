# Ops — ClamAV Security Agent integration

## Overview
This runbook documents how to integrate a **Security Agent** with ClamAV running as **local Docker on the VPS**.

## Architecture (high level)
- **Coding extension** → calls → **Security Agent** (via SuperRoo agent runner API)
- **Security Agent** → triggers → **clamav scan** using local ClamAV docker
- **Security Agent** → returns markdown artifacts + structured results

## Scan scope
You can support two operational scan scopes:

### Mode A: scan a specific VPS path
- Extension uploads/mirrors selected folders/files to a known VPS directory.
- Security Agent scans that directory.

### Mode B: scan “laptop as a whole”
- Extension exports the laptop into a mirror on VPS.
- Security Agent scans the export root.

> Important: “whole laptop” is only as safe as your export/mirror strategy.

## Required deployment pieces
1. ClamAV docker container running on VPS with persistent DB.
2. Security Agent definition under `cloud/agents/security-agent/`.
3. Skill/resource docs referenced by the agent `agent.json`.
4. Extension wiring so it passes the correct `targetPath`.

## Safety controls
- Hard limits: `maxFiles`, `maxSizeMB`, and scan timeout.
- Approved roots list: only allow scanning within specific VPS directories.
- Quarantine is optional and should be gated by policy.

## Operational checks
- Verify ClamAV container is healthy.
- Verify signature DB volume is writable.
- Run a test scan against a known EICAR-like benign test file (only if you have an allowed test pattern).

## Troubleshooting
- If scans always fail: check docker permissions and mounted path readability.
- If no infections are reported: check signatures freshness (freshclam).
- If scans are slow: ensure you set `recursive` only where needed; apply max-file limits.

