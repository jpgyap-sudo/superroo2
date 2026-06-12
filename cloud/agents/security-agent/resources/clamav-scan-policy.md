# Resource: clamav-scan-policy

## Purpose
Policy and guardrails for Security Agent malware scanning.

## Allowed scan targets
- Explicit operator-provided paths
- Extension-managed laptop export/mirror paths on VPS

## Disallowed defaults
- Root `/` scans without explicit approval
- Sensitive OS paths unless explicitly requested and approved

## Safety limits
- Enforce scan timeout
- Enforce max files / max size when provided
- Never exfiltrate scanned file contents outside VPS without explicit permission

## Reporting
Always provide:
- target path
- scan mode
- infected count
- list of infected files (if any)
- command and timestamp
- recommendation (quarantine/manual review/clean)
