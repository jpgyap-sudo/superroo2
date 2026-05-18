#!/usr/bin/env node
/**
 * Sync Local Lessons to Central Brain
 *
 * Reads all locally-stored lessons from memory/lesson-index.jsonl and
 * batch-pushes them to the Central Brain via MCP. Tracks which lessons
 * have been synced using a sync-state file (memory/.sync-state.json)
 * to avoid duplicates.
 *
 * Usage:
 *   node scripts/sync-lessons-to-central-brain.mjs              # Sync all unsynced lessons
 *   node scripts/sync-lessons-to-central-brain.mjs --force      # Re-sync ALL lessons
 *   node scripts/sync-lessons-to-central-brain.mjs --dry-run    # Show what would be synced
 *   node scripts/sync-lessons-to-central-brain.mjs --status     # Show sync status only
 *
 * Environment:
 *   SUPERROO_MCP_URL       MCP server URL (default: http://127.0.0.1:3419/mcp)
 *   SUPERROO_DAEMON_TOKEN  Auth token for the daemon
 *   SUPERROO_SYNC_TIMEOUT  Per-lesson timeout in ms (default: 10000)
 */

import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { accessSync } from "fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const MCP_URL = process.env.SUPERROO_MCP_URL || "http://127.0.0.1:3419/mcp"
const SYNC_TIMEOUT = parseInt(process.env.SUPERROO_SYNC_TIMEOUT || "10000", 10)

const INDEX_FILE = path.join(ROOT, "memory", "lesson-index.jsonl")
const SYNC_STATE_FILE = path.join(ROOT, "memory", ".sync-state.json")

// ── Sync State ──

/**
 * @typedef {{ syncedIds: string[], lastSync: string|null, totalSynced: number }} SyncState
 */

/**
 * Read the current sync state.
 * @returns {Promise<SyncState>}
 */
async function readSyncState() {
  try {
    const raw = await fs.readFile(SYNC_STATE_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    return { syncedIds: [], lastSync: null, totalSynced: 0 }
  }
}

/**
 * Write the sync state.
 * @param {SyncState} state
 */
async function writeSyncState(state) {
  await fs.mkdir(path.dirname(SYNC_STATE_FILE), { recursive: true })
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), "utf-8")
}

// ── Lesson Loading ──

/**
 * Read all lessons from lesson-index.jsonl.
 * @returns {Promise<Array<{id: string, title: string, lesson_summary: string, rule_summary: string, tags: string[], files: string[], date: string, source: string, model: string, confidence: string}>>}
 */
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

// ── MCP Sync ──

/**
 * Send a single lesson to Central Brain via MCP.
 * @param {object} lesson
 * @returns {Promise<boolean>}
 */
async function syncLesson(lesson) {
  const topic = `[${lesson.source || "local"}] ${lesson.title}`
  const content = [
    `## ${lesson.title}`,
    "",
    `**Date:** ${lesson.date}`,
    `**Source:** ${lesson.source || "local-fallback"}`,
    `**Model:** ${lesson.model || "unknown"}`,
    `**Confidence:** ${lesson.confidence || "medium"}`,
    `**Files:** ${(lesson.files || []).join(", ")}`,
    "",
    `**Summary:** ${lesson.lesson_summary || ""}`,
    "",
    `**Rule:** ${lesson.rule_summary || ""}`,
    "",
    `**Tags:** ${(lesson.tags || []).join(", ")}`,
  ].join("\n")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT)

  try {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SUPERROO_DAEMON_TOKEN
          ? { Authorization: `Bearer ${process.env.SUPERROO_DAEMON_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: "hermes_learn",
          arguments: { topic, content },
        },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return response.ok
  } catch (err) {
    clearTimeout(timeout)
    return false
  }
}

// ── Main ──

/**
 * Sync all unsynced local lessons to Central Brain.
 * @param {{ force?: boolean, dryRun?: boolean, statusOnly?: boolean }} options
 */
export async function syncLocalLessonsToCentralBrain(options = {}) {
  const { force = false, dryRun = false, statusOnly = false } = options

  console.error("📚 Syncing local lessons to Central Brain...")
  console.error(`   MCP URL: ${MCP_URL}`)
  console.error(`   Timeout: ${SYNC_TIMEOUT}ms per lesson`)
  console.error("")

  // Load all lessons
  const lessons = await loadAllLessons()
  if (lessons.length === 0) {
    console.error("📭 No lessons found to sync.")
    return { synced: 0, skipped: 0, failed: 0, total: 0 }
  }

  // Load sync state
  const state = await readSyncState()

  // Filter lessons to sync
  const toSync = force
    ? lessons
    : lessons.filter((l) => !state.syncedIds.includes(l.id))

  if (statusOnly) {
    console.error(`📊 Sync Status:`)
    console.error(`   Total lessons:     ${lessons.length}`)
    console.error(`   Already synced:    ${state.syncedIds.length}`)
    console.error(`   Pending sync:      ${toSync.length}`)
    console.error(`   Last sync:         ${state.lastSync || "never"}`)
    console.error(`   Total ever synced: ${state.totalSynced}`)
    return {
      total: lessons.length,
      synced: state.syncedIds.length,
      pending: toSync.length,
      lastSync: state.lastSync,
      totalSynced: state.totalSynced,
    }
  }

  if (toSync.length === 0) {
    console.error("✅ All lessons are already synced to Central Brain.")
    console.error(`   (Total: ${lessons.length}, Last sync: ${state.lastSync || "never"})`)
    return { synced: 0, skipped: lessons.length, failed: 0, total: lessons.length }
  }

  if (dryRun) {
    console.error(`🔍 Dry run — would sync ${toSync.length} lesson(s):`)
    for (const lesson of toSync) {
      console.error(`   • [${lesson.id}] ${lesson.title}`)
    }
    return { synced: 0, skipped: 0, failed: 0, total: lessons.length, wouldSync: toSync.length }
  }

  // Sync each lesson
  let synced = 0
  let failed = 0

  for (let i = 0; i < toSync.length; i++) {
    const lesson = toSync[i]
    const progress = `[${i + 1}/${toSync.length}]`
    process.stdout.write(`   ${progress} Syncing "${lesson.title.slice(0, 60)}"... `)

    const ok = await syncLesson(lesson)

    if (ok) {
      console.error(`✅`)
      synced++
      state.syncedIds.push(lesson.id)
    } else {
      console.error(`❌`)
      failed++
    }
  }

  // Update sync state
  state.lastSync = new Date().toISOString()
  state.totalSynced += synced
  await writeSyncState(state)

  // Summary
  console.error("")
  console.error(`📊 Sync Complete:`)
  console.error(`   Synced:  ${synced}`)
  console.error(`   Failed:  ${failed}`)
  console.error(`   Skipped: ${lessons.length - toSync.length}`)
  console.error(`   Total:   ${lessons.length}`)

  return { synced, failed, skipped: lessons.length - toSync.length, total: lessons.length }
}

// ── CLI Entry Point ──

async function main() {
  const args = process.argv.slice(2)

  const options = {
    force: args.includes("--force") || args.includes("-f"),
    dryRun: args.includes("--dry-run") || args.includes("-n"),
    statusOnly: args.includes("--status") || args.includes("-s"),
  }

  await syncLocalLessonsToCentralBrain(options)
}

// Run if called directly
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("sync-lessons-to-central-brain.mjs")
)
if (isMain) {
  main().catch((err) => {
    console.error(`❌ Fatal error: ${err.message}`)
    process.exit(1)
  })
}
