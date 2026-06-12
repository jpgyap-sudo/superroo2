# Resources — ClamAV integration

This folder contains documentation resources used by the **Security Agent** and related skills for malware scanning via **ClamAV local Docker**.

## Resource contents
- `clamav-docker-local.md` — how ClamAV Docker is run on the VPS (volumes/ports/policy)

## Expected agent usage
- The Security Agent should reference these resources in its `agent.json`.
- The extension should not call ClamAV directly; it should call the Security Agent.

