#!/usr/bin/env node
/**
 * sync-repair-runs.mjs
 *
 * Reads cloud/orchestrator/data/repair-runs.jsonl and upserts each record
 * into the Supabase `repair_runs` table via the REST API.
 *
 * Tracks last-synced byte offset in .repair-runs-sync-state.json so re-runs
 * only upload new records (never re-upload already-synced rows).
 *
 * Schema: cloud/sql/repair_runs.sql
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... node scripts/sync-repair-runs.mjs
 *   node scripts/sync-repair-runs.mjs --dry-run     # print records, no upload
 *   node scripts/sync-repair-runs.mjs --reset       # clear sync state, re-upload all
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const REPAIR_RUNS_PATH = path.join(ROOT, "cloud/orchestrator/data/repair-runs.jsonl")
const SYNC_STATE_PATH = path.join(ROOT, "cloud/orchestrator/data/.repair-runs-sync-state.json")

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

const DRY_RUN = process.argv.includes("--dry-run")
const RESET = process.argv.includes("--reset")

// ── State persistence ─────────────────────────────────────────────────────────

function loadSyncState() {
  if (RESET) return { lastByteOffset: 0, syncedCount: 0 }
  try {
    return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, "utf8"))
  } catch {
    return { lastByteOffset: 0, syncedCount: 0 }
  }
}

function saveSyncState(state) {
  if (DRY_RUN) return
  fs.mkdirSync(path.dirname(SYNC_STATE_PATH), { recursive: true })
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2))
}

// ── JSONL reader ──────────────────────────────────────────────────────────────

function readNewRecords(fromByteOffset) {
  if (!fs.existsSync(REPAIR_RUNS_PATH)) return { records: [], newByteOffset: 0 }

  const stat = fs.statSync(REPAIR_RUNS_PATH)
  if (stat.size <= fromByteOffset) return { records: [], newByteOffset: fromByteOffset }

  const fd = fs.openSync(REPAIR_RUNS_PATH, "r")
  const buffer = Buffer.alloc(stat.size - fromByteOffset)
  fs.readSync(fd, buffer, 0, buffer.length, fromByteOffset)
  fs.closeSync(fd)

  const records = []
  for (const line of buffer.toString("utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // skip malformed lines
    }
  }

  return { records, newByteOffset: stat.size }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertBatch(records) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. " +
        "Export them before running:\n" +
        "  export SUPABASE_URL=https://xxx.supabase.co\n" +
        "  export SUPABASE_SERVICE_KEY=your-service-role-key"
    )
  }

  // Map JSONL schema → Supabase table columns
  const rows = records.map((r) => ({
    incident_id: r.incidentId ?? r.incident_id ?? null,
    failure_signature: r.fingerprint ?? r.failure_signature ?? null,
    title: r.title ?? null,
    source: r.source ?? null,
    severity: normalizeSeverity(r.severity),
    attempts_count: r.attemptsCount ?? r.attempts_count ?? 0,
    final_status: normalizeFinalStatus(r.finalStatus ?? r.final_status),
    fix_applied: r.fixApplied ?? r.fix_applied ?? null,
    escalated_at: r.escalatedAt ?? r.escalated_at ?? null,
    cycle_count: r.cycleCount ?? r.cycle_count ?? 0,
    triggered_at: r.triggeredAt ?? r.triggered_at ?? new Date().toISOString(),
    metadata: r.metadata ?? {},
  }))

  const endpoint = `${SUPABASE_URL}/rest/v1/repair_runs`
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)")
    throw new Error(`Supabase upsert failed: ${res.status} ${res.statusText}\n${body}`)
  }

  return rows.length
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeSeverity(v) {
  const allowed = ["low", "medium", "high", "critical"]
  const s = String(v || "").toLowerCase()
  return allowed.includes(s) ? s : null
}

function normalizeFinalStatus(v) {
  const allowed = ["fixed", "escalated", "failed", "in_progress"]
  const s = String(v || "").toLowerCase()
  return allowed.includes(s) ? s : "in_progress"
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const state = loadSyncState()

  const { records, newByteOffset } = readNewRecords(state.lastByteOffset)

  if (records.length === 0) {
    console.log("✓ No new repair-run records to sync.")
    return
  }

  console.log(`Found ${records.length} new record(s) since byte ${state.lastByteOffset}.`)

  if (DRY_RUN) {
    console.log("Dry-run mode — records that would be upserted:")
    for (const r of records) console.log("  →", JSON.stringify(r))
    return
  }

  const synced = await upsertBatch(records)
  const newState = {
    lastByteOffset: newByteOffset,
    syncedCount: (state.syncedCount || 0) + synced,
    lastSyncedAt: new Date().toISOString(),
  }
  saveSyncState(newState)

  console.log(`✓ Synced ${synced} record(s) to Supabase repair_runs. Total synced: ${newState.syncedCount}.`)
}

main().catch((err) => {
  console.error("sync-repair-runs failed:", err.message)
  process.exit(1)
})
