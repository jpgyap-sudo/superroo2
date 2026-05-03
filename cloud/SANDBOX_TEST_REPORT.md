# Docker Sandbox Test Report

**Date:** 2026-05-03  
**VPS:** 165.22.110.111  
**Status:** ✅ PASSED

---

## Checklist

| Checkpoint                    | Status | Evidence                                                           |
| ----------------------------- | ------ | ------------------------------------------------------------------ |
| Job queued via API            | ✅     | `POST /job` returned `{"success":true,"jobId":"6"}`                |
| Worker received job           | ✅     | Log: `[worker] Received job 6 — task: sandbox test with fake repo` |
| Docker ran command in sandbox | ✅     | Container `superroo-sandbox-6` executed all commands               |
| Repo cloned inside sandbox    | ✅     | `test-repo/` found in `/opt/superroo2/cloud/sandbox/jobs/6/`       |
| Logs saved to disk            | ✅     | `/opt/superroo2/cloud/logs/jobs/6.log`                             |
| No host contamination         | ✅     | `OK: No test-repo in /opt/superroo2`                               |

---

## Commands Executed in Sandbox

```bash
git clone https://github.com/octocat/Hello-World.git test-repo
cd test-repo && ls -la
git status
node -v
pnpm -v
git --version
```

### Output

| Command         | Result                                                       |
| --------------- | ------------------------------------------------------------ |
| `ls -la`        | `total 16` — `.git` and `README` present                     |
| `git status`    | `On branch master` — `nothing to commit, working tree clean` |
| `node -v`       | `v20.20.2`                                                   |
| `pnpm -v`       | `10.33.2`                                                    |
| `git --version` | `git version 2.39.5`                                         |

---

## Docker Command Used

```bash
docker run --rm --network=host \
  -v /opt/superroo2/cloud/sandbox/jobs/6:/workspace \
  -w /workspace \
  --cpus=1 --memory=512m \
  --name superroo-sandbox-6 \
  superroo-sandbox:latest bash -c \
  "git clone https://github.com/octocat/Hello-World.git test-repo && \
   cd test-repo && ls -la && git status && node -v && pnpm -v && git --version"
```

---

## Infrastructure Verified

- **Docker** — `Docker version 29.1.3`
- **Redis** — Installed and running (was missing, installed during test)
- **PM2** — `superroo-api` and `superroo-worker` both online
- **Sandbox Image** — `superroo-sandbox:latest` built from `node:20`

---

## Files Changed

| File                                                                | Change      | Purpose                                         |
| ------------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| [`cloud/api/api.js`](cloud/api/api.js:1)                            | **NEW**     | HTTP API on port 8787 with `POST /job` endpoint |
| [`cloud/ecosystem.config.js`](cloud/ecosystem.config.js:1)          | **Updated** | PM2 config for API + worker                     |
| [`cloud/worker/worker.js`](cloud/worker/worker.js:33)               | **Updated** | Passes `network` field to sandbox runner        |
| [`cloud/worker/sandboxRunner.js`](cloud/worker/sandboxRunner.js:91) | **Updated** | Configurable Docker `--network` mode            |
| [`cloud/test-payload.json`](cloud/test-payload.json:1)              | **Updated** | Test payload with fake repo commands            |
| [`cloud/test-job.js`](cloud/test-job.js:1)                          | **Updated** | Standalone BullMQ publisher                     |
| [`cloud/run-test-on-vps.sh`](cloud/run-test-on-vps.sh:1)            | **NEW**     | Automated VPS test script                       |
