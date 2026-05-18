#!/usr/bin/env node
/**
 * Claude Code Stop Hook — Auto Lesson Sync on Task Completion
 *
 * Fires after every Claude response (Stop event). Syncs any unsynced
 * lessons from memory/lesson-index.jsonl to the cloud API. Runs in
 * background — never blocks Claude's response.
 *
 * Registered in ~/.claude/settings.json:
 *   "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "node ..." }] }] }
 *
 * Throttled: only syncs if last sync was > 60s ago (avoid hammering on
 * every short response).
 */

import { spawn } from "child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SUPERROO_ROOT = path.resolve(__dirname, "..")
const LOG_FILE = path.join(os.homedir(), ".superroo", "claude-hook.log")
const THROTTLE_FILE = path.join(SUPERROO_ROOT, "memory", ".stop-hook-last-run")
const THROTTLE_SECONDS = 60

async function log(msg) {
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    const ts = new Date().toISOString()
    const line = `[${ts}] [stop-hook] ${msg}\n`
    writeFileSync(LOG_FILE, line, { flag: "a" })
  } catch {
    // non-fatal
  }
}

function shouldRun() {
  try {
    if (!existsSync(THROTTLE_FILE)) return true
    const last = parseInt(readFileSync(THROTTLE_FILE, "utf-8").trim(), 10)
    return Date.now() - last > THROTTLE_SECONDS * 1000
  } catch {
    return true
  }
}

function markRun() {
  try {
    writeFileSync(THROTTLE_FILE, String(Date.now()))
  } catch {}
}

function hasPendingLessons() {
  try {
    const indexFile = path.join(SUPERROO_ROOT, "memory", "lesson-index.jsonl")
    const stateFile = path.join(SUPERROO_ROOT, "memory", ".sync-state.json")
    if (!existsSync(indexFile)) return false

    const lineCount = readFileSync(indexFile, "utf-8").split("\n").filter((l) => l.trim()).length
    if (lineCount === 0) return false

    if (!existsSync(stateFile)) return true
    const state = JSON.parse(readFileSync(stateFile, "utf-8"))
    return (state.syncedIds?.length || 0) < lineCount
  } catch {
    return false
  }
}

async function main() {
  // Read event from stdin (Stop hook sends event JSON)
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    // Stop hook event — we don't need to inspect it
  } catch {
    // ignore stdin errors
  }

  if (!shouldRun()) {
    process.exit(0)
  }

  if (!hasPendingLessons()) {
    process.exit(0)
  }

  const syncScript = path.join(SUPERROO_ROOT, "scripts", "sync-lessons-to-central-brain.mjs")
  if (!existsSync(syncScript)) {
    process.exit(0)
  }

  markRun()
  await log("pending lessons detected — spawning sync")

  const child = spawn(process.execPath, [syncScript], {
    detached: true,
    stdio: "ignore",
    cwd: SUPERROO_ROOT,
    windowsHide: true,
  })
  child.unref()

  await log(`sync worker spawned (pid ${child.pid})`)
  process.exit(0)
}

main()
