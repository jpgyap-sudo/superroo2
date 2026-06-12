#!/usr/bin/env node
/**
 * Sync Local Lessons to Central Brain
 *
 * Reads all locally-stored lessons from memory/lesson-index.jsonl and
 * batch-pushes them to the cloud API (/api/lessons/sync), which stores
 * them in PostgreSQL via BugKnowledgeStore. Tracks synced IDs in
 * memory/.sync-state.json to avoid duplicates.
 *
 * The cloud API is used instead of direct MCP because the MCP server
 * (port 3419) and Central Brain (port 3417) are bound to 127.0.0.1
 * on the VPS and are not reachable from the dev machine.
 *
 * Usage:
 *   node scripts/sync-lessons-to-central-brain.mjs              # Sync all unsynced
 *   node scripts/sync-lessons-to-central-brain.mjs --force      # Re-sync ALL
 *   node scripts/sync-lessons-to-central-brain.mjs --dry-run    # Show what would sync
 *   node scripts/sync-lessons-to-central-brain.mjs --status     # Show sync status
 *   node scripts/sync-lessons-to-central-brain.mjs --local-only # Skip VPS sync entirely
 *
 * Environment:
 *   SUPERROO_API_URL       Cloud API base URL (default: https://dev.abcx124.xyz/api)
 *   SUPERROO_DAEMON_TOKEN  Optional bearer token for protected APIs
 *   SUPERROO_API_KEY       Optional bearer token fallback
 *   SUPERROO_CLOUD_TOKEN   Optional bearer token fallback
 *   SUPERROO_SYNC_TIMEOUT  Per-batch timeout ms (default: 30000)
 *   SUPERROO_BATCH_SIZE    Lessons per batch (default: 50)
 */

import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { accessSync } from "fs"

import os from "os"
import crypto from "crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const PROJECT_ID = process.env.PROJECT_ID || path.basename(ROOT)

// Load shared credentials from ~/.superroo/credentials.env — lives OUTSIDE any
// git repo so it can never be committed. Real env vars take precedence.
try {
  const credFile = path.join(os.homedir(), ".superroo", "credentials.env")
  if (fsSync.existsSync(credFile)) {
    for (const line of fsSync.readFileSync(credFile, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
} catch {}

// Default to the Tailscale path — the public hostname resolves to the old
// droplet IP and Node fetch times out on it (2026-06-12).
const API_URL = process.env.SUPERROO_API_URL || "http://100.64.175.88:8787/api"
const SYNC_URL = `${API_URL}/lessons/sync`
const API_TOKEN = process.env.SUPERROO_DAEMON_TOKEN
  || process.env.SUPERROO_API_KEY
  || process.env.SUPERROO_CLOUD_TOKEN
const SYNC_TIMEOUT = parseInt(process.env.SUPERROO_SYNC_TIMEOUT || "30000", 10)
const BATCH_SIZE = parseInt(process.env.SUPERROO_BATCH_SIZE || "50", 10)

const MEMORY_DIR = process.env.MEMORY_DIR || path.join(ROOT, "memory")
const INDEX_FILE = path.join(MEMORY_DIR, "lesson-index.jsonl")
// Sync state is global so it survives project moves
const SYNC_STATE_FILE = process.env.SYNC_STATE_PATH
  || path.join(os.homedir(), ".superroo", "sync-state", `${PROJECT_ID}-lessons.json`)
const VPS_SYNC_QUEUE_FILE = path.join(os.homedir(), ".superroo", "sync-state", `${PROJECT_ID}-vps-queue.json`)

// ── VPS Sync Queue ──

async function loadVpsQueue() {
  try {
    const raw = await fs.readFile(VPS_SYNC_QUEUE_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    return { queued: [], failed: [], lastAttempt: null }
  }
}

async function saveVpsQueue(queue) {
  await fs.mkdir(path.dirname(VPS_SYNC_QUEUE_FILE), { recursive: true })
  await fs.writeFile(VPS_SYNC_QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8")
}

async function enqueueForVpsSync(lessons, error) {
  const queue = await loadVpsQueue()
  const queuedIds = lessons.map(l => l.id)
  queue.queued.push({
    ids: queuedIds,
    attempts: 1,
    firstFailed: new Date().toISOString(),
    error: String(error).slice(0, 500),
    lessons,
  })
  queue.lastAttempt = new Date().toISOString()
  await saveVpsQueue(queue)
  console.error(`   Queued ${queuedIds.length} lessons for retry after VPS failure`)
}

// Exponential backoff: 2s base, doubles, capped at 60s
function getBackoffDelay(attempts) {
  return Math.min(2000 * Math.pow(2, attempts - 1), 60000)
}

async function processVpsQueue() {
  const queue = await loadVpsQueue()
  if (queue.queued.length === 0) return

  const now = Date.now()
  const ready = queue.queued.filter(item => {
    const lastAttempt = item.lastAttemptAt ? new Date(item.lastAttemptAt).getTime() : 0
    return now - lastAttempt >= getBackoffDelay(item.attempts || 1)
  })

  if (ready.length === 0) return

  console.error("🔄 Processing VPS sync retry queue...")
  for (const item of ready) {
    const result = await syncBatch(item.lessons)
    if (result.synced > 0) {
      queue.queued = queue.queued.filter(i => i !== item)
      console.error(`   Recovered ${result.synced} lessons from queue`)
    } else {
      item.attempts = (item.attempts || 1) + 1
      item.lastAttemptAt = new Date().toISOString()
      if (item.attempts >= 5) {
        queue.failed.push({ ...item })
        queue.queued = queue.queued.filter(i => i !== item)
      }
    }
  }
  await saveVpsQueue(queue)
}

// ── Sync State ──

async function readSyncState() {
  try {
    const raw = await fs.readFile(SYNC_STATE_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    return { syncedIds: [], lastSync: null, totalSynced: 0 }
  }
}

async function writeSyncState(state) {
  await fs.mkdir(path.dirname(SYNC_STATE_FILE), { recursive: true })
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), "utf-8")
}

// ── Lesson Loading ──

async function loadAllLessons() {
  try {
    accessSync(INDEX_FILE)
  } catch {
    console.error("❌ No lesson index found at:", INDEX_FILE)
    return []
  }

  const content = await fs.readFile(INDEX_FILE, "utf-8")
  const lines = content.split("\n").filter((l) => l.trim())

  return lines.map((line, i) => {
    try {
      return JSON.parse(line)
    } catch {
      console.error(`⚠️  Skipping malformed JSON at line ${i + 1}`)
      return null
    }
  }).filter(Boolean)
}

// ── Batch API Sync ──

async function syncBatch(lessons, forQueue = false) {
  if (!API_TOKEN) {
    console.error("   Missing VPS API token. Set SUPERROO_DAEMON_TOKEN, SUPERROO_API_KEY, or SUPERROO_CLOUD_TOKEN.")
    return { synced: 0, failed: lessons.length, results: [] }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT)

  try {
    const response = await fetch(SYNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      },
      body: JSON.stringify(lessons),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      console.error(`   API error ${response.status}: ${text.slice(0, 200)}`)
      return { synced: 0, failed: lessons.length, results: [] }
    }

    const json = await response.json()
    return {
      synced: json.synced || 0,
      failed: json.failed || 0,
      results: json.results || [],
    }
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === "AbortError") {
      console.error(`   Batch timed out after ${SYNC_TIMEOUT}ms`)
    } else {
      console.error(`   Batch failed: ${err.message}`)
    }
    return { synced: 0, failed: lessons.length, results: [] }
  }
}

// ── Main ──

export async function syncLocalLessonsToCentralBrain(options = {}) {
  const { force = false, dryRun = false, statusOnly = false, localOnly = false } = options

  console.error("📚 Syncing local lessons to Central Brain...")
  console.error(`   API: ${SYNC_URL}`)
  console.error(`   Batch size: ${BATCH_SIZE}`)
  console.error(`   Local only: ${localOnly}`)
  console.error("")

  // Process any pending VPS queue items
  if (!localOnly && !dryRun && !statusOnly) {
    await processVpsQueue()
  }

  const lessons = await loadAllLessons()
  if (lessons.length === 0) {
    console.error("📭 No lessons found to sync.")
    return { synced: 0, skipped: 0, failed: 0, total: 0 }
  }

  const state = await readSyncState()
  const toSync = force ? lessons : lessons.filter((l) => !state.syncedIds.includes(l.id))

  if (statusOnly) {
    console.error(`📊 Sync Status:`)
    console.error(`   Total lessons:   ${lessons.length}`)
    console.error(`   Already synced:  ${state.syncedIds.length}`)
    console.error(`   Pending sync:    ${toSync.length}`)
    console.error(`   Last sync:       ${state.lastSync || "never"}`)
    console.error(`   Total synced:    ${state.totalSynced}`)

    const queue = await loadVpsQueue()
    console.error(`   VPS queue:       ${queue.queued.length} pending, ${queue.failed.length} failed`)
    return { total: lessons.length, synced: state.syncedIds.length, pending: toSync.length }
  }

  if (toSync.length === 0) {
    console.error(`✅ All ${lessons.length} lessons already synced. Last: ${state.lastSync || "never"}`)
    return { synced: 0, skipped: lessons.length, failed: 0, total: lessons.length }
  }

  if (dryRun) {
    console.error(`🔍 Dry run — would sync ${toSync.length} lesson(s):`)
    for (const lesson of toSync) {
      console.error(`   • [${lesson.id}] ${lesson.title?.slice(0, 70)}`)
    }
    return { synced: 0, skipped: 0, failed: 0, total: lessons.length, wouldSync: toSync.length }
  }

  if (localOnly) {
    console.error(`📝 Local-only mode — skipping VPS sync, ${toSync.length} lessons ready`)
    return { synced: 0, skipped: toSync.length, failed: 0, total: lessons.length, localOnly: true }
  }

  if (!API_TOKEN) {
    console.error("🔐 Missing VPS API token. Set SUPERROO_DAEMON_TOKEN, SUPERROO_API_KEY, or SUPERROO_CLOUD_TOKEN to sync.")
    return { synced: 0, skipped: lessons.length - toSync.length, failed: toSync.length, total: lessons.length }
  }

  // Batch sync
  let totalSynced = 0
  let totalFailed = 0
  const syncedIds = []

  const batches = []
  for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
    batches.push(toSync.slice(i, i + BATCH_SIZE))
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    console.error(`   Batch ${b + 1}/${batches.length} (${batch.length} lessons)...`)
    const result = await syncBatch(batch)

    totalSynced += result.synced
    totalFailed += result.failed

    // Track which lessons were successfully synced
    for (const r of result.results) {
      if (r.success && r.id) syncedIds.push(r.id)
    }
    // If all in batch succeeded (e.g. API returned synced count but no per-item results)
    if (result.synced === batch.length && syncedIds.length === 0) {
      for (const lesson of batch) syncedIds.push(lesson.id)
    }

    console.error(`     → synced: ${result.synced}, failed: ${result.failed}`)
  }

  // Persist state
  const newSyncedIds = [...new Set([...state.syncedIds, ...syncedIds])]
  await writeSyncState({
    syncedIds: newSyncedIds,
    lastSync: new Date().toISOString(),
    totalSynced: (state.totalSynced || 0) + totalSynced,
  })

  console.error("")
  console.error(`📊 Sync Complete:`)
  console.error(`   Synced:  ${totalSynced}`)
  console.error(`   Failed:  ${totalFailed}`)
  console.error(`   Skipped: ${lessons.length - toSync.length}`)
  console.error(`   Total:   ${lessons.length}`)

  // Queue failed items for retry
  if (totalFailed > 0) {
    const failedLessons = toSync.filter(l => !syncedIds.includes(l.id))
    await enqueueForVpsSync(failedLessons, "Batch sync failures")
  }

  return { synced: totalSynced, failed: totalFailed, skipped: lessons.length - toSync.length, total: lessons.length }
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2)
  const options = {
    force: args.includes("--force") || args.includes("-f"),
    dryRun: args.includes("--dry-run") || args.includes("-n"),
    statusOnly: args.includes("--status") || args.includes("-s"),
    localOnly: args.includes("--local-only"),
  }
  await syncLocalLessonsToCentralBrain(options)
}

const isMain =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("sync-lessons-to-central-brain.mjs"))

if (isMain) {
  main().catch((err) => {
    console.error(`❌ Fatal error: ${err.message}`)
    process.exit(1)
  })
}
