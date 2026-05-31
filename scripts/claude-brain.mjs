/**
 * Claude's Central Brain CLI
 *
 * A persistent knowledge store for Claude Code's observations, lessons,
 * decisions, and patterns about the SuperRoo project.
 *
 * Usage:
 *   node scripts/claude-brain.mjs add --type lesson --title "..." --content "..." --tags "tag1,tag2"
 *   node scripts/claude-brain.mjs query --tag "vscode-extension"
 *   node scripts/claude-brain.mjs search --q "ripgrep"
 *   node scripts/claude-brain.mjs recent --n 10
 *   node scripts/claude-brain.mjs index
 *   node scripts/claude-brain.mjs stats
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const BRAIN_DIR = path.join(ROOT, "memory/claude-brain")
const KNOWLEDGE_FILE = path.join(BRAIN_DIR, "knowledge.jsonl")
const INDEX_FILE = path.join(BRAIN_DIR, "brain-index.json")
const SESSIONS_FILE = path.join(BRAIN_DIR, "sessions.jsonl")

// Ensure brain directory exists
if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadAllEntries() {
  if (!existsSync(KNOWLEDGE_FILE)) return []
  return readFileSync(KNOWLEDGE_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

function loadIndex() {
  if (!existsSync(INDEX_FILE)) return { byTag: {}, byType: {}, byContext: {}, count: 0, lastUpdated: null }
  try { return JSON.parse(readFileSync(INDEX_FILE, "utf8")) } catch { return { byTag: {}, byType: {}, byContext: {}, count: 0 } }
}

function saveIndex(idx) {
  writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), "utf8")
}

function rebuildIndex(entries) {
  const idx = { byTag: {}, byType: {}, byContext: {}, count: entries.length, lastUpdated: new Date().toISOString() }
  for (const e of entries) {
    // by tag
    for (const tag of (e.tags || [])) {
      if (!idx.byTag[tag]) idx.byTag[tag] = []
      idx.byTag[tag].push(e.id)
    }
    // by type
    if (!idx.byType[e.type]) idx.byType[e.type] = []
    idx.byType[e.type].push(e.id)
    // by context
    if (e.context) {
      const ctx = e.context.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 30)
      if (!idx.byContext[ctx]) idx.byContext[ctx] = []
      idx.byContext[ctx].push(e.id)
    }
  }
  return idx
}

function getNextId(entries) {
  const nums = entries.map(e => parseInt((e.id || "cb-000").replace("cb-", ""), 10)).filter(n => !isNaN(n))
  const max = nums.length ? Math.max(...nums) : 0
  return "cb-" + String(max + 1).padStart(3, "0")
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdAdd(argv) {
  const args = parseArgs(argv)
  const type = args.type || "lesson"
  const title = args.title
  const content = args.content
  const tags = (args.tags || "").split(",").map(t => t.trim()).filter(Boolean)
  const context = args.context || ""
  const confidence = args.confidence || "medium"
  const relatedFiles = (args.files || "").split(",").map(f => f.trim()).filter(Boolean)

  if (!title || !content) {
    console.error("Error: --title and --content are required")
    process.exit(1)
  }

  const entries = loadAllEntries()
  const id = getNextId(entries)
  const entry = {
    id,
    type,
    title,
    content,
    context,
    confidence,
    date: new Date().toISOString().slice(0, 10),
    tags,
    source: "claude-sonnet-4-6 session",
    relatedFiles,
    createdAt: new Date().toISOString()
  }

  appendFileSync(KNOWLEDGE_FILE, JSON.stringify(entry) + "\n", "utf8")

  // Update index
  const allEntries = [...entries, entry]
  const idx = rebuildIndex(allEntries)
  saveIndex(idx)

  console.log("✅ Added entry " + id + ": " + title)
  console.log("   Type: " + type + " | Tags: " + tags.join(", "))
}

function cmdQuery(argv) {
  const args = parseArgs(argv)
  const tag = args.tag
  const type = args.type
  const entries = loadAllEntries()

  let results = entries
  if (tag) results = results.filter(e => (e.tags || []).includes(tag))
  if (type) results = results.filter(e => e.type === type)

  if (!results.length) {
    console.log("No entries found for the given filter.")
    return
  }

  console.log("Found " + results.length + " entries:\n")
  for (const e of results) {
    console.log("[" + e.id + "] " + e.type.toUpperCase() + ": " + e.title)
    console.log("  Date: " + e.date + " | Confidence: " + e.confidence + " | Tags: " + (e.tags || []).join(", "))
    console.log("  " + e.content.slice(0, 150).replace(/\n/g, " ") + (e.content.length > 150 ? "..." : ""))
    console.log()
  }
}

function cmdSearch(argv) {
  const args = parseArgs(argv)
  const q = (args.q || "").toLowerCase()
  if (!q) { console.error("Error: --q is required"); process.exit(1) }

  const entries = loadAllEntries()
  const results = entries.filter(e =>
    e.title.toLowerCase().includes(q) ||
    e.content.toLowerCase().includes(q) ||
    (e.tags || []).some(t => t.toLowerCase().includes(q)) ||
    (e.context || "").toLowerCase().includes(q)
  )

  if (!results.length) {
    console.log('No entries matching "' + q + '"')
    return
  }

  console.log("Found " + results.length + ' entries matching "' + q + '":\n')
  for (const e of results) {
    console.log("[" + e.id + "] " + e.title)
    const snippet = (e.content || "").toLowerCase().indexOf(q)
    if (snippet !== -1) {
      const start = Math.max(0, snippet - 40)
      const end = Math.min(e.content.length, snippet + q.length + 80)
      console.log("  ..." + e.content.slice(start, end) + "...")
    }
    console.log()
  }
}

function cmdRecent(argv) {
  const args = parseArgs(argv)
  const n = parseInt(args.n || "10", 10)
  const entries = loadAllEntries()
  const recent = entries.slice(-n).reverse()

  console.log("Recent " + recent.length + " entries:\n")
  for (const e of recent) {
    console.log("[" + e.id + "] " + e.date + " | " + e.type + ": " + e.title)
  }
}

function cmdIndex() {
  const idx = loadIndex()
  console.log("Brain Index — " + idx.count + " entries, last updated: " + idx.lastUpdated)
  console.log("\nBy Type:")
  for (const [type, ids] of Object.entries(idx.byType || {})) {
    console.log("  " + type + ": " + ids.length)
  }
  console.log("\nTop Tags:")
  const tagsSorted = Object.entries(idx.byTag || {}).sort((a, b) => b[1].length - a[1].length).slice(0, 20)
  for (const [tag, ids] of tagsSorted) {
    console.log("  " + tag + ": " + ids.length)
  }
}

function cmdStats() {
  const entries = loadAllEntries()
  const byType = {}
  const byConfidence = {}
  const byMonth = {}
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1
    byConfidence[e.confidence] = (byConfidence[e.confidence] || 0) + 1
    const month = (e.date || "").slice(0, 7)
    if (month) byMonth[month] = (byMonth[month] || 0) + 1
  }
  console.log("Claude Brain Stats")
  console.log("  Total entries: " + entries.length)
  console.log("  By type: " + JSON.stringify(byType))
  console.log("  By confidence: " + JSON.stringify(byConfidence))
  console.log("  By month: " + JSON.stringify(byMonth))
}

function cmdRebuildIndex() {
  const entries = loadAllEntries()
  const idx = rebuildIndex(entries)
  saveIndex(idx)
  console.log("✅ Rebuilt index for " + entries.length + " entries")
}

// ─── Arg Parser ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true
      result[key] = val
    }
  }
  return result
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv

switch (command) {
  case "add": cmdAdd(rest); break
  case "query": cmdQuery(rest); break
  case "search": cmdSearch(rest); break
  case "recent": cmdRecent(rest); break
  case "index": cmdIndex(); break
  case "stats": cmdStats(); break
  case "rebuild-index": cmdRebuildIndex(); break
  default:
    console.log("Claude Brain CLI\n")
    console.log("Commands:")
    console.log("  add       --type --title --content --tags --context --confidence --files")
    console.log("  query     --tag [tag] --type [type]")
    console.log("  search    --q [keyword]")
    console.log("  recent    --n [count]")
    console.log("  index     (show tag/type index)")
    console.log("  stats     (summary statistics)")
    console.log("  rebuild-index")
    break
}
