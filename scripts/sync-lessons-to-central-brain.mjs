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
 *
 * Environment:
 *   SUPERROO_API_URL       Cloud API base URL (default: https://dev.abcx124.xyz/api)
 *   SUPERROO_SYNC_TIMEOUT  Per-batch timeout ms (default: 30000)
 *   SUPERROO_BATCH_SIZE    Lessons per batch (default: 50)
 */

import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { accessSync } from "fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const API_URL = process.env.SUPERROO_API_URL || "https://dev.abcx124.xyz/api"
const SYNC_URL = `${API_URL}/lessons/sync`
const SYNC_TIMEOUT = parseInt(process.env.SUPERROO_SYNC_TIMEOUT || "30000", 10)
const BATCH_SIZE = parseInt(process.env.SUPERROO_BATCH_SIZE || "50", 10)

const INDEX_FILE = path.join(ROOT, "memory", "lesson-index.jsonl")
const SYNC_STATE_FILE = path.join(ROOT, "memory", ".sync-state.json")

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

async function syncBatch(lessons) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT)

  try {
    const response = await fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  const { force = false, dryRun = false, statusOnly = false } = options

  console.error("📚 Syncing local lessons to Central Brain...")
  console.error(`   API: ${SYNC_URL}`)
  console.error(`   Batch size: ${BATCH_SIZE}`)
  console.error("")

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

  return { synced: totalSynced, failed: totalFailed, skipped: lessons.length - toSync.length, total: lessons.length }
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2)
  const options = {
    force: args.includes("--force") || args.includes("-f"),
    dryRun: args.includes("--dry-run") || args.includes("-n"),
    statusOnly: args.includes("--status") || args.includes("-s"),
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
