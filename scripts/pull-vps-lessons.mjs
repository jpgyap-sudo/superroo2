#!/usr/bin/env node
/**
 * Pull VPS Lessons → Local
 *
 * Fetches all lessons from the SuperRoo VPS Central Brain (PostgreSQL)
 * and saves them into the local learning layer:
 *   - memory/lesson-index.jsonl  (structured index)
 *   - memory/lessons-learned.md  (human-readable markdown)
 *
 * Tracks synced VPS lesson IDs in memory/.vps-pull-state.json to
 * avoid duplicates on repeated runs.
 *
 * Usage:
 *   node scripts/pull-vps-lessons.mjs              # pull all new
 *   node scripts/pull-vps-lessons.mjs --status     # show counts only
 *   node scripts/pull-vps-lessons.mjs --dry-run    # preview, no writes
 *   node scripts/pull-vps-lessons.mjs --force      # re-pull all
 *   node scripts/pull-vps-lessons.mjs --md-only    # skip lesson-index
 *   node scripts/pull-vps-lessons.mjs --limit 500  # cap total pulled
 *
 * Optional auth:
 *   SUPERROO_DAEMON_TOKEN, SUPERROO_API_KEY, or SUPERROO_CLOUD_TOKEN
 *
 * Requires VPS API to be running with GET /api/lessons/export endpoint.
 * Deploy cloud/api/api.js first if the endpoint is not yet live.
 */

import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

// ── Config ─────────────────────────────────────────────────────────────────────

const API_URL       = process.env.SUPERROO_API_URL || "https://dev.abcx124.xyz/api"
const EXPORT_URL    = `${API_URL}/lessons/export`
const API_TOKEN     = process.env.SUPERROO_DAEMON_TOKEN || process.env.SUPERROO_API_KEY || process.env.SUPERROO_CLOUD_TOKEN || ""
const BATCH_SIZE    = 100
const TIMEOUT_MS    = 30000

const LESSON_INDEX  = path.join(ROOT, "memory", "lesson-index.jsonl")
const LESSONS_MD    = path.join(ROOT, "memory", "lessons-learned.md")
const STATE_FILE    = path.join(ROOT, "memory", ".vps-pull-state.json")

// ── CLI flags ──────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const statusOnly = args.includes("--status")
const dryRun    = args.includes("--dry-run")
const force     = args.includes("--force")
const mdOnly    = args.includes("--md-only")
const limitArg  = args.find(a => a.startsWith("--limit"))
const maxPull   = limitArg ? parseInt(args[args.indexOf(limitArg) + 1] || "9999", 10) : 9999

const log  = (...a) => console.log(...a)
const warn = (...a) => console.warn(...a)

// ── State ──────────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fsSync.readFileSync(STATE_FILE, "utf8")) }
  catch { return { pulled: {}, lastPullAt: null, totalPulled: 0 } }
}

async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
}

// ── Next lesson-index ID ───────────────────────────────────────────────────────

function getNextLessonNum() {
  if (!fsSync.existsSync(LESSON_INDEX)) return 500
  const lines = fsSync.readFileSync(LESSON_INDEX, "utf8").trim().split("\n").filter(Boolean)
  const nums = lines.map(l => {
    try { return parseInt(JSON.parse(l).id?.replace("lesson-", "") || "0", 10) }
    catch { return 0 }
  }).filter(n => !isNaN(n))
  return nums.length ? Math.max(...nums) + 1 : 500
}

// ── VPS fetch ──────────────────────────────────────────────────────────────────

async function fetchBatch(offset, limit) {
  const url = `${EXPORT_URL}?offset=${offset}&limit=${limit}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers = API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : undefined
    const res = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      const txt = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ── Converters ─────────────────────────────────────────────────────────────────

function toMarkdown(row, date) {
  const tags = (row.metadata?.tags || []).join(", ") || "vps-central-brain"
  return `
### Lesson: ${row.topic}

Date: ${date}
Source: VPS Central Brain (PostgreSQL pull)
Model/API used: ${row.metadata?.agent_type || "cloud-agent"}
Confidence: high
Related files: ${(row.metadata?.features_affected || []).join(", ") || "n/a"}

#### Task Summary

Pulled from VPS Central Brain. Project: ${row.project}. Type: ${row.lesson_type}.

#### Lesson Learned

${row.content}

#### Reusable Rule

${row.content.split("\n")[0]}

#### Tags

${tags}

---
`
}

function toIndexEntry(row, lessonId, date) {
  const content = row.content || ""
  return {
    id: lessonId,
    title: row.topic,
    type: row.lesson_type || "lesson",
    date,
    source: "VPS Central Brain pull",
    model: row.metadata?.agent_type || "cloud-agent",
    confidence: "high",
    project: row.project || "superroo2",
    files: row.metadata?.features_affected || [],
    tags: [...(row.metadata?.tags || []), "vps-central-brain", row.lesson_type].filter(Boolean),
    relevance_score: 0.88,
    relevance_factors: {
      is_bug_fix: row.lesson_type === "bug_fix",
      has_tests: false,
      affects_multiple_files: false,
      has_reusable_rule: true,
    },
    rule_summary: content.split("\n")[0].slice(0, 200),
    lesson_summary: content.slice(0, 300),
    vps_id: row.id,
    source_task_id: row.source_task_id,
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log("⬇️  Pull VPS Lessons → Local")
  log(`   API: ${EXPORT_URL}`)
  log("")

  // Status check
  const state = loadState()
  const alreadyPulled = Object.keys(state.pulled).length

  if (statusOnly) {
    log(`Sync state:`)
    log(`  Already pulled: ${alreadyPulled} VPS lessons`)
    log(`  Last pull:      ${state.lastPullAt || "never"}`)
    try {
      const first = await fetchBatch(0, 1)
      log(`  VPS total:      ${first.total} lessons`)
      log(`  Pending:        ${Math.max(0, first.total - alreadyPulled)}`)
    } catch (err) {
      log(`  VPS unreachable: ${err.message}`)
    }
    return
  }

  // Fetch first batch to get total count
  let firstBatch
  try {
    firstBatch = await fetchBatch(0, BATCH_SIZE)
  } catch (err) {
    warn(`❌ Cannot reach VPS: ${err.message}`)
    warn(`   Make sure the VPS API is running and GET /api/lessons/export is deployed.`)
    process.exit(1)
  }

  const total = firstBatch.total
  log(`VPS has ${total} lessons, ${alreadyPulled} already pulled locally`)

  const newRows = firstBatch.rows.filter(r => force || !state.pulled[String(r.id)])
  log(`First batch: ${firstBatch.rows.length} rows, ${newRows.length} new`)

  if (total === 0 || (!force && alreadyPulled >= total)) {
    log("\n✅ All VPS lessons already pulled locally.")
    return
  }

  // Collect all new rows across batches
  let allNewRows = [...newRows]
  let offset = BATCH_SIZE

  while (offset < total && allNewRows.length < maxPull) {
    log(`  Fetching batch offset=${offset}...`)
    try {
      const batch = await fetchBatch(offset, BATCH_SIZE)
      const fresh = batch.rows.filter(r => force || !state.pulled[String(r.id)])
      allNewRows = [...allNewRows, ...fresh]
      offset += BATCH_SIZE
      if (batch.rows.length < BATCH_SIZE) break
    } catch (err) {
      warn(`  ⚠️  Batch at offset=${offset} failed: ${err.message} — stopping early`)
      break
    }
  }

  if (allNewRows.length === 0) {
    log("\n✅ No new VPS lessons to pull.")
    return
  }

  log(`\nPulling ${allNewRows.length} new lessons...`)

  if (dryRun) {
    log("[DRY RUN] Would import:")
    allNewRows.slice(0, 10).forEach(r => log(`  - [${r.lesson_type}] ${r.topic}`))
    if (allNewRows.length > 10) log(`  ... and ${allNewRows.length - 10} more`)
    return
  }

  // Convert and write
  let lessonNum = getNextLessonNum()
  let mdAppend = ""
  const indexLines = []

  for (const row of allNewRows) {
    const date = (row.created_at || new Date().toISOString()).slice(0, 10)
    const lessonId = `lesson-${lessonNum}`
    lessonNum++

    mdAppend += toMarkdown(row, date)
    indexLines.push(JSON.stringify(toIndexEntry(row, lessonId, date)))
    state.pulled[String(row.id)] = { lessonId, title: row.topic, syncedAt: new Date().toISOString() }
  }

  // Append to lessons-learned.md
  await fs.appendFile(LESSONS_MD, mdAppend, "utf8")
  log(`📝 Appended ${allNewRows.length} lessons to lessons-learned.md`)

  // Append to lesson-index.jsonl (unless --md-only)
  if (!mdOnly) {
    await fs.appendFile(LESSON_INDEX, indexLines.join("\n") + "\n", "utf8")
    log(`📋 Appended ${allNewRows.length} entries to lesson-index.jsonl`)
  }

  // Save state
  state.lastPullAt = new Date().toISOString()
  state.totalPulled = (state.totalPulled || 0) + allNewRows.length
  await saveState(state)
  log(`💾 State saved (total pulled: ${state.totalPulled})`)

  log(`\n✅ Pulled ${allNewRows.length} VPS lessons into local learning layer`)
  log(`   Run sync-to-brain.mjs to also push them into Claude's local brain`)
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
