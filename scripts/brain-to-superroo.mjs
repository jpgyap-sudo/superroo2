#!/usr/bin/env node
/**
 * Brain → SuperRoo Sync
 * Reads brain entries and imports them into the SuperRoo learning layer.
 */
import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"
import crypto from "crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const LESSONS_MD    = path.join(ROOT, "memory", "lessons-learned.md")
const LESSON_INDEX  = path.join(ROOT, "memory", "lesson-index.jsonl")
const SYNC_STATE    = path.join(ROOT, "memory", "brain-sync-state.json")
const BRAIN_DB      = path.join("C:", "Users", "user", "brain", "data", "memory.json")

const SUPERROO_COLLECTIONS = new Set(["superroo-lessons"])
const IMPORT_COLLECTIONS = new Set(["code", "general", "docs", "conversations"])

const args     = process.argv.slice(2)
const force    = args.includes("--force")
const statusOnly = args.includes("--status")
const dryRun   = args.includes("--dry-run")
const quiet    = args.includes("--quiet")

const log  = (...a) => { if (!quiet) console.log(...a) }

function loadBrainDB() {
  if (!fsSync.existsSync(BRAIN_DB)) return { entries: [] }
  try { return JSON.parse(fsSync.readFileSync(BRAIN_DB, "utf8")) }
  catch { return { entries: [] } }
}

function loadSyncState() {
  try { return JSON.parse(fsSync.readFileSync(SYNC_STATE, "utf8")) }
  catch { return { synced: {}, lastSyncAt: null } }
}

async function saveSyncState(state) {
  await fs.writeFile(SYNC_STATE, JSON.stringify(state, null, 2), "utf8")
}

function getNextLessonNum() {
  if (!fsSync.existsSync(LESSON_INDEX)) return 500
  const lines = fsSync.readFileSync(LESSON_INDEX, "utf8").trim().split("\n").filter(Boolean)
  const nums = lines.map(l => {
    try { return parseInt(JSON.parse(l).id?.replace("lesson-", "") || "0", 10) }
    catch { return 0 }
  }).filter(n => !isNaN(n) && n < 100000)
  return nums.length ? Math.max(...nums) + 1 : 500
}

function extractTitle(entry) {
  if (entry.metadata?.title) return entry.metadata.title
  const firstLine = (entry.content || "").split("\n").find(l => l.trim())
  if (firstLine) return firstLine.replace(/^#+\s*/, "").replace(/^\*+\s*/, "").slice(0, 120).trim()
  return `Brain entry ${entry.id}`
}

function toMarkdownLesson(entry, title, date) {
  const tags = (entry.metadata?.tags || []).join(", ") || entry.collection
  return `
### Lesson: ${title}

Date: ${date}
Source: Claude Code brain sync (collection: ${entry.collection})
Model/API used: claude-sonnet-4-6
Confidence: ${entry.metadata?.confidence || "medium"}
Related files: ${(entry.metadata?.relatedFiles || []).join(", ") || "n/a"}

#### Task Summary

Imported from Claude Code local brain memory.

#### Lesson Learned

${entry.content}

#### Reusable Rule

${entry.metadata?.rule || entry.content.split("\n").slice(0, 3).join(" ")}

#### Tags

${tags}

---
`
}

function toIndexEntry(entry, lessonId, title, date) {
  const content = (entry.content || "").trim()
  return {
    id: lessonId, title,
    type: entry.metadata?.type || "lesson",
    date, source: "Claude Code brain sync",
    model: "claude-sonnet-4-6",
    confidence: entry.metadata?.confidence || "medium",
    project: "superroo2",
    files: entry.metadata?.relatedFiles || [],
    tags: [...(entry.metadata?.tags || []), entry.collection, "claude-brain"].filter(Boolean),
    relevance_score: 0.90,
    relevance_factors: {
      is_bug_fix: entry.metadata?.type === "fix",
      has_tests: false,
      affects_multiple_files: (entry.metadata?.relatedFiles || []).length > 1,
      has_reusable_rule: !!entry.metadata?.rule,
    },
    rule_summary: entry.metadata?.rule || content.split(". ")[0] + ".",
    lesson_summary: content.slice(0, 250),
    brain_entry_id: entry.id,
  }
}

async function main() {
  log("🔄 Brain → SuperRoo Sync")
  const db = loadBrainDB()
  const state = loadSyncState()
  if (!state.fromBrain) state.fromBrain = {}

  const candidates = db.entries.filter(e => {
    if (SUPERROO_COLLECTIONS.has(e.collection)) return false
    if (!IMPORT_COLLECTIONS.has(e.collection)) return false
    if (!force && state.fromBrain[e.id]) return false
    return true
  })

  log(`Brain entries: ${db.entries.length} total | Importable: ${candidates.length} new`)

  if (statusOnly) {
    log("\nRecently imported:")
    Object.entries(state.fromBrain).slice(-5).forEach(([id, meta]) => {
      log(`  [${meta.lessonId}] ${meta.title} (${meta.syncedAt?.slice(0, 10)})`)
    })
    return
  }

  if (candidates.length === 0) { log("\n✅ Nothing new to import."); return }
  if (dryRun) { candidates.forEach(e => log(`  - ${extractTitle(e)}`)); return }

  let mdAppend = ""
  const indexLines = []
  let currentNum = getNextLessonNum()

  for (const entry of candidates) {
    const title = extractTitle(entry)
    const date = (entry.createdAt || new Date().toISOString()).slice(0, 10)
    const lessonId = `lesson-${currentNum++}`
    mdAppend += toMarkdownLesson(entry, title, date)
    indexLines.push(JSON.stringify(toIndexEntry(entry, lessonId, title, date)))
    state.fromBrain[entry.id] = { lessonId, title, syncedAt: new Date().toISOString() }
    log(`  ✅ [${lessonId}] ${title}`)
  }

  await fs.appendFile(LESSONS_MD, mdAppend, "utf8")
  await fs.appendFile(LESSON_INDEX, indexLines.join("\n") + "\n", "utf8")
  state.lastBrainSyncAt = new Date().toISOString()
  await saveSyncState(state)
  log(`\n✅ Imported ${candidates.length} brain entries into SuperRoo`)
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
