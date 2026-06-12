---
name: research-github-repo-scan
description: Research and design the correct workflow to scan GitHub repos via SuperRoo (URL -> local materialization -> local project context scan), and produce cross-extension instructions for VS Code/coding extensions.
modeSlugs:
  - code
  - terminal
  - architect
---

# Research: GitHub repo scanning (URL -> local -> context)

## Instructions
You are a **research skill**. Your job is to find and specify the correct end-to-end workflow so that a coding extension can provide a **GitHub repo link** and SuperRoo can scan it successfully.

### 1) Identify what “repo scanning” really means in SuperRoo
- Determine whether SuperRoo’s current “repo scanner” expects:
  - (A) a **local workspace already present** (filesystem scan), or
  - (B) it can do **GitHub-native scanning** (API-based), or
  - (C) SuperRoo does both (but only in certain modes).
- If the repo scanner is filesystem-based, document that SuperRoo requires a **local materialization step** before scanning.

### 2) Define the required end-to-end workflow (two modes)
Produce a step-by-step workflow that a coding extension can follow:

#### Mode A — URL-only scan (no local clone / no workspace materialization)
Your goal is to determine if SuperRoo (or an adapter/MCP tool) can infer ProjectContext **purely by fetching a small set of files via GitHub APIs**.

Document (and recommend) an API strategy such as:
1. Accept input: `https://github.com/OWNER/REPO` (and support common variants like `.git`, `/tree/`, `/blob/`, and SSH forms).
2. Convert link to canonical identity: `{ owner, repo }`.
3. Fetch key files via GitHub REST API (no cloning):
   - `GET /repos/{owner}/{repo}/contents/{path}?ref={ref}`
   - Start with: `package.json`, relevant lockfile(s), `Dockerfile`, `docker-compose.yml`, `tsconfig.json`, `.env.example`
   - Optionally scan `package.json` fields to infer framework and scripts (what SuperRoo’s local scanner already does).
4. Build an in-memory ProjectContext equivalent (same fields as the local ProjectContext type).
5. Return the inferred context back to the caller so SuperRoo can plan commands **without** relying on a local checkout.

Also explicitly list limitations and how to mitigate:
- large repos: avoid recursive tree traversal; prefer “fetch only what’s needed”
- rate limits: use token auth when possible; implement exponential backoff
- private repos: require token / permissions
- missing files: best-effort inference + clear “unknown” fallbacks

#### Mode B — Local materialization scan (fallback)
If URL-only inference can’t provide enough accuracy, define the fallback:
1. Materialize repo minimally (isolated temp dir).
2. Call SuperRoo’s existing local workspace context scan (e.g. `scanWorkspace`).

### 3) Research and point to the exact code/entrypoints
When possible, cite the exact SuperRoo components you found:
- the repo scanning function(s)
- the place where “workspaceRoot” is chosen
- the place where VS Code / cross-extension messages trigger context loading
- any existing GitHub utilities (URL parsing / remote extraction) and whether they are currently used for cloning/fetching vs API-only fetching

### 4) Produce the “cross-extension skill markdown”
At the end, write a short, copy/paste-ready spec section titled:

> **Cross-extension contract (what the other extension must do)**

It must include:
- Input format(s) accepted
- Output contract(s) expected (e.g., “must call SuperRoo with a workspace already materialized”)
- Safety constraints (avoid destructive git commands; avoid writing outside temp/workspace)
- Failure modes and retry guidance:
  - invalid URL
  - private repo / missing token
  - rate limiting
  - missing package.json
  - huge repos/timeouts

## Quality gates
- Prefer documenting the proven working path over proposing new APIs.
- If GitHub URL -> local materialization does not exist, clearly state what must be implemented and in which layer (extension layer vs MCP vs backend).
- Include at least one concrete example GitHub URL in your spec.
