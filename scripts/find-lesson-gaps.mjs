#!/usr/bin/env node
/**
 * Find all gaps in the SuperRoo learning layer.
 * Analyzes quality, coverage, sync, and topic gaps.
 */
import { readFileSync, existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

function loadJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").trim().split("\n")
    .filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

const entries = loadJsonl(path.join(ROOT, "memory/lesson-index.jsonl"))

// ── 1. Quality Gaps ────────────────────────────────────────────────────────────

const todo = entries.filter(e =>
  (e.lesson_summary || "").includes("TODO") ||
  (e.lesson_summary || "").includes("To be determined") ||
  (e.rule_summary || "").includes("TODO")
)
const emptyBoth = entries.filter(e => !e.lesson_summary && !e.rule_summary)
const draft = entries.filter(e => e.policy_status === "draft")
const lowQ = entries.filter(e => e.quality_score !== undefined && e.quality_score < 0.5)
const noTags = entries.filter(e => !e.tags || e.tags.length === 0)
const noFiles = entries.filter(e => !e.files || e.files.length === 0)
const unknownModel = entries.filter(e => !e.model || e.model === "unknown")

// Overlap: todo AND draft AND low quality = truly useless
const useless = entries.filter(e =>
  ((e.lesson_summary || "").includes("TODO") || (e.lesson_summary || "").includes("To be determined")) &&
  e.policy_status === "draft"
)

console.log("╔══════════════════════════════════════════════════════════╗")
console.log("║           SUPERROO LEARNING LAYER — GAP ANALYSIS        ║")
console.log("╚══════════════════════════════════════════════════════════╝")
console.log(`\nTotal entries: ${entries.length}`)

console.log("\n── 1. QUALITY GAPS ──────────────────────────────────────────")
console.log(`  TODO placeholders:          ${todo.length} (${pct(todo, entries)}%)`)
console.log(`  Empty lesson + rule:        ${emptyBoth.length}`)
console.log(`  Draft status:               ${draft.length} (${pct(draft, entries)}%)`)
console.log(`  Low quality score (<0.5):   ${lowQ.length}`)
console.log(`  No tags:                    ${noTags.length}`)
console.log(`  No files:                   ${noFiles.length}`)
console.log(`  Unknown model:              ${unknownModel.length}`)
console.log(`  ► TRULY USELESS (todo+draft): ${useless.length} entries need enrichment`)

// ── 2. Type Distribution ───────────────────────────────────────────────────────

const typeMap = {}
entries.forEach(e => { const t = e.type || "unknown"; typeMap[t] = (typeMap[t] || 0) + 1 })

console.log("\n── 2. TYPE DISTRIBUTION ─────────────────────────────────────")
Object.entries(typeMap).sort((a,b) => b[1]-a[1]).forEach(([t,c]) =>
  console.log(`  ${t.padEnd(20)} ${c.toString().padStart(4)} (${pct2(c,entries.length)}%)`)
)

// ── 3. File / Directory Coverage ──────────────────────────────────────────────

const dirMap = {}
entries.forEach(e => (e.files || []).forEach(f => {
  const dir = f.replace(/\\/g, "/").split("/")[0] || "root"
  dirMap[dir] = (dirMap[dir] || 0) + 1
}))

// Find major dirs with NO lessons
const allDirs = ["src", "cloud", "webview-ui", "scripts", "packages", "apps", "docs", "docker", ".roo"]
const coveredDirs = Object.keys(dirMap)
const uncoveredDirs = allDirs.filter(d => !coveredDirs.includes(d))

console.log("\n── 3. DIRECTORY COVERAGE ────────────────────────────────────")
Object.entries(dirMap).sort((a,b) => b[1]-a[1]).slice(0, 12).forEach(([d,c]) =>
  console.log(`  ${d.padEnd(25)} ${c.toString().padStart(4)} lessons`)
)
if (uncoveredDirs.length)
  console.log(`  ► ZERO lessons: ${uncoveredDirs.join(", ")}`)

// ── 4. Tag Coverage ───────────────────────────────────────────────────────────

const tagMap = {}
entries.forEach(e => (e.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1 }))
const topTags = Object.entries(tagMap).sort((a,b) => b[1]-a[1]).slice(0, 15)

// Topics that should have lessons but don't
const expectedTopics = [
  "security", "authentication", "performance", "testing", "ci-cd",
  "database", "caching", "error-handling", "logging", "monitoring",
  "typescript", "react", "docker", "nginx", "postgresql", "redis",
  "tailscale", "pm2", "websocket", "ollama"
]
const coveredTopics = new Set(Object.keys(tagMap))
const missingTopics = expectedTopics.filter(t => !coveredTopics.has(t))

console.log("\n── 4. TAG / TOPIC COVERAGE ──────────────────────────────────")
console.log("  Top 15 tags: " + topTags.map(([t,c]) => `${t}(${c})`).join(", "))
if (missingTopics.length)
  console.log(`  ► MISSING TOPICS: ${missingTopics.join(", ")}`)

// ── 5. Temporal Gaps ──────────────────────────────────────────────────────────

const byMonth = {}
entries.forEach(e => {
  const m = (e.date || "").slice(0, 7) || "unknown"
  byMonth[m] = (byMonth[m] || 0) + 1
})

const months = Object.entries(byMonth).filter(([m]) => m !== "unknown").sort()
const lastMonth = months[months.length - 1]?.[0]
const today = new Date().toISOString().slice(0, 7)
const isCurrentMonth = lastMonth === today

console.log("\n── 5. TEMPORAL COVERAGE ─────────────────────────────────────")
months.forEach(([m, c]) => console.log(`  ${m}  ${c.toString().padStart(4)} lessons`))
if (!isCurrentMonth)
  console.log(`  ► GAP: No lessons for ${today} yet`)

// ── 6. Sync Gaps ──────────────────────────────────────────────────────────────

const syncState = (() => {
  try { return JSON.parse(readFileSync(path.join(ROOT, "memory/.sync-state.json"), "utf8")) }
  catch { return { syncedIds: [], totalSynced: 0 } }
})()

const brainSyncState = (() => {
  try { return JSON.parse(readFileSync(path.join(ROOT, "memory/brain-sync-state.json"), "utf8")) }
  catch { return { synced: {} } }
})()

const syncedToVPS = syncState.syncedIds?.length || syncState.totalSynced || 0
const syncedToBrain = Object.keys(brainSyncState.synced || {}).length

console.log("\n── 6. SYNC GAPS ─────────────────────────────────────────────")
console.log(`  lesson-index.jsonl entries: ${entries.length}`)
console.log(`  Synced to VPS PostgreSQL:   ${syncedToVPS}`)
console.log(`  Synced to Claude brain:     ${syncedToBrain}`)
const vpsPending = entries.length - syncedToVPS
const brainPending = entries.length - syncedToBrain
if (vpsPending > 0)  console.log(`  ► VPS sync pending:   ${vpsPending} entries`)
if (brainPending > 0) console.log(`  ► Brain sync pending: ${brainPending} entries`)

// ── 7. Priority Enrichment List ───────────────────────────────────────────────

console.log("\n── 7. PRIORITY ENRICHMENT TARGETS ───────────────────────────")
console.log("  (todo + draft = highest priority to fix)\n")
useless.slice(0, 10).forEach((e, i) =>
  console.log(`  ${i+1}. [${e.id}] ${(e.title || "").slice(0, 65)}`)
)
if (useless.length > 10) console.log(`  ... and ${useless.length - 10} more`)

// ── Summary ───────────────────────────────────────────────────────────────────

const goodEntries = entries.filter(e =>
  (e.lesson_summary || "").length > 30 &&
  !((e.lesson_summary || "").includes("TODO")) &&
  (e.tags || []).length > 0
)

console.log("\n── SUMMARY ──────────────────────────────────────────────────")
console.log(`  Good quality:    ${goodEntries.length}/${entries.length} (${pct(goodEntries, entries)}%)`)
console.log(`  Need enrichment: ${useless.length} entries (todo + draft)`)
console.log(`  Need tags:       ${noTags.length} entries`)
console.log(`  VPS sync gap:    ${Math.max(0, vpsPending)} entries`)
console.log(`  Brain sync gap:  ${Math.max(0, brainPending)} entries`)

function pct(subset, all) { return ((subset.length / all.length) * 100).toFixed(1) }
function pct2(n, total) { return ((n / total) * 100).toFixed(1) }
