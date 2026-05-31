#!/usr/bin/env node
/**
 * Merge all lesson files into the two canonical stores:
 *   memory/lessons-learned.md   (human-readable markdown)
 *   memory/lesson-index.jsonl   (machine-readable structured index)
 *
 * Sources merged:
 *   1. memory/lessons.jsonl          — Codex/Kimi format (task/root_cause/fix)
 *   2. memory/enriched-lessons.jsonl — Hermes 3 enrichments (patch existing entries)
 *   3. memory/claude-brain/knowledge.jsonl — Claude's own brain entries
 *
 * After merge:
 *   - lessons.jsonl → deleted (fully absorbed)
 *   - enriched-lessons.jsonl → deleted (patches applied)
 *   - lesson-summaries.json → regenerated from merged lessons-learned.md
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
const LESSONS_JSONL = path.join(ROOT, "memory", "lessons.jsonl")
const ENRICHED_FILE = path.join(ROOT, "memory", "enriched-lessons.jsonl")
const CLAUDE_BRAIN  = path.join(ROOT, "memory", "claude-brain", "knowledge.jsonl")
const BACKUPS_DIR   = path.join(ROOT, "memory", "backups")

const log  = (...a) => console.log(...a)

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadJsonl(filePath) {
  if (!fsSync.existsSync(filePath)) return []
  return fsSync.readFileSync(filePath, "utf8").trim().split("\n")
    .filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

function loadIndexMap() {
  const entries = loadJsonl(LESSON_INDEX)
  const byId = new Map(entries.map(e => [e.id, e]))
  // Also build title-based dedup map (normalized)
  const byTitle = new Map(entries.map(e => [normalizeTitle(e.title || ""), e]))
  return { entries, byId, byTitle }
}

function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)
}

function getNextLessonNum(entries) {
  const nums = entries.map(e => parseInt((e.id || "lesson-0").replace("lesson-", ""), 10)).filter(n => !isNaN(n))
  return nums.length ? Math.max(...nums) + 1 : 400
}

function makeHash(title) {
  return crypto.createHash("sha1").update(title).digest("hex").slice(0, 8)
}

async function backup(filePath) {
  if (!fsSync.existsSync(filePath)) return
  await fs.mkdir(BACKUPS_DIR, { recursive: true })
  const base = path.basename(filePath)
  const date = new Date().toISOString().slice(0, 10)
  const dest = path.join(BACKUPS_DIR, `${date}-merge-${base}`)
  await fs.copyFile(filePath, dest)
  log(`  📦 Backed up ${base} → backups/${path.basename(dest)}`)
}

// ── Convert lessons.jsonl entry (Codex format) → both stores ──────────────────

function codexToMarkdown(e, lessonId) {
  const tags = (e.tags || []).join(", ") || "legacy"
  return `
### Lesson: ${e.task || e.title || "Untitled"}

Date: ${e.date || "unknown"}
Source: ${e.source || "Codex/Kimi legacy session"}
Model/API used: ${(e.models || ["unknown"])[0] || "unknown"}
Confidence: ${e.confidence || "medium"}
Related files: ${(e.files || []).join(", ") || "n/a"}

#### Task Summary

${e.task_summary || e.task || "Imported from legacy lessons.jsonl."}

#### Lesson Learned

${e.root_cause || e.lesson_summary || "See reusable rule."}

#### Reusable Rule

${e.fix || e.reusable_rule || e.rule_summary || "No rule recorded."}

#### Tags

${tags}

---
`
}

function codexToIndex(e, lessonId) {
  return {
    id: lessonId,
    title: e.task || e.title || "Untitled",
    type: e.task_type || e.type || "lesson",
    date: e.date || "unknown",
    source: e.source || "Codex/Kimi legacy session",
    model: (e.models || ["unknown"])[0] || "unknown",
    confidence: e.confidence || "medium",
    project: e.project || "superroo2",
    files: e.files || [],
    tags: e.tags || [],
    relevance_score: 0.85,
    relevance_factors: {
      is_bug_fix: (e.task_type || e.type) === "bugfix",
      has_tests: false,
      affects_multiple_files: (e.files || []).length > 1,
      has_reusable_rule: !!(e.fix || e.reusable_rule),
    },
    rule_summary: e.fix || e.reusable_rule || e.rule_summary || "",
    lesson_summary: e.root_cause || e.lesson_summary || "",
    merged_from: "lessons.jsonl",
  }
}

// ── Convert claude-brain entry → both stores ───────────────────────────────────

function brainToMarkdown(e, lessonId) {
  const tags = (e.tags || []).join(", ") || "claude-brain"
  return `
### Lesson: ${e.title}

Date: ${e.date || "unknown"}
Source: Claude Code brain (claude-brain/knowledge.jsonl)
Model/API used: claude-sonnet-4-6
Confidence: ${e.confidence || "high"}
Related files: ${(e.relatedFiles || []).join(", ") || "n/a"}

#### Task Summary

${e.type === "fix" ? "Bug fix" : e.type === "pattern" ? "Pattern observed" : "Engineering lesson"} from Claude Code session.

#### Lesson Learned

${e.content}

#### Reusable Rule

${e.content.split(". ")[0]}.

#### Tags

${tags}

---
`
}

function brainToIndex(e, lessonId) {
  return {
    id: lessonId,
    title: e.title,
    type: e.type || "lesson",
    date: e.date || "unknown",
    source: "Claude Code brain",
    model: "claude-sonnet-4-6",
    confidence: e.confidence || "high",
    project: "superroo2",
    files: e.relatedFiles || [],
    tags: [...(e.tags || []), "claude-brain"],
    relevance_score: 0.93,
    relevance_factors: {
      is_bug_fix: e.type === "fix",
      has_tests: false,
      affects_multiple_files: (e.relatedFiles || []).length > 1,
      has_reusable_rule: true,
    },
    rule_summary: e.content.split(". ")[0] + ".",
    lesson_summary: e.content.slice(0, 250),
    merged_from: "claude-brain/knowledge.jsonl",
    brain_id: e.id,
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log("🔀 Merge Lesson Files → Canonical Stores")
  log("=========================================\n")

  // Load current index for dedup
  const { entries: existing, byTitle } = loadIndexMap()
  let nextNum = getNextLessonNum(existing)
  log(`Current index: ${existing.length} entries`)

  let mdAppend = ""
  const newIndexEntries = []
  let skipped = 0

  // ── Step 1: Merge lessons.jsonl (Codex/Kimi format) ────────────────────────
  const legacyLessons = loadJsonl(LESSONS_JSONL)
  log(`\n📂 lessons.jsonl: ${legacyLessons.length} entries`)

  for (const e of legacyLessons) {
    const title = e.task || e.title || ""
    if (!title) { skipped++; continue }
    if (byTitle.has(normalizeTitle(title))) {
      log(`  ⊘ Already in index: ${title.slice(0, 60)}`)
      skipped++
      continue
    }
    const lessonId = `lesson-${nextNum++}`
    mdAppend += codexToMarkdown(e, lessonId)
    newIndexEntries.push(codexToIndex(e, lessonId))
    byTitle.set(normalizeTitle(title), { id: lessonId })
    log(`  ✅ [${lessonId}] ${title.slice(0, 65)}`)
  }

  // ── Step 2: Patch existing entries with enriched content ───────────────────
  const enrichedLessons = loadJsonl(ENRICHED_FILE)
  log(`\n📂 enriched-lessons.jsonl: ${enrichedLessons.length} entries`)

  // Load full index for patching
  const indexLines = fsSync.existsSync(LESSON_INDEX)
    ? fsSync.readFileSync(LESSON_INDEX, "utf8").trim().split("\n").filter(Boolean)
    : []

  const patchedLines = new Map() // lessonId → new JSON line

  for (const e of enrichedLessons) {
    const title = e.task || ""
    if (!title) continue
    const existing = byTitle.get(normalizeTitle(title))
    if (!existing) {
      // Not in index — treat as new entry
      const lessonId = `lesson-${nextNum++}`
      const asCodex = {
        task: e.task,
        task_type: "lesson",
        date: e.date || e.enrichedAt?.slice(0, 10) || "unknown",
        files: e.files || [],
        tags: e.tags || [],
        project: e.project || "superroo2",
        root_cause: e.root_cause,
        fix: e.fix,
        reusable_rule: e.reusable_rule,
        models: [e.enrichedBy || "hermes3"],
      }
      mdAppend += codexToMarkdown(asCodex, lessonId)
      newIndexEntries.push(codexToIndex(asCodex, lessonId))
      byTitle.set(normalizeTitle(title), { id: lessonId })
      log(`  ✅ [${lessonId}] ${title.slice(0, 65)} (new)`)
    } else {
      // Patch the existing index entry with enriched content
      const targetId = existing.id
      const idx = indexLines.findIndex(l => {
        try { return JSON.parse(l).id === targetId } catch { return false }
      })
      if (idx >= 0) {
        const parsed = JSON.parse(indexLines[idx])
        parsed.lesson_summary = e.root_cause || parsed.lesson_summary
        parsed.rule_summary = e.reusable_rule || parsed.rule_summary
        parsed.enriched_by = e.enrichedBy || "hermes3"
        parsed.enriched_at = e.enrichedAt
        patchedLines.set(idx, JSON.stringify(parsed))
        log(`  🔧 Patched [${targetId}]: ${title.slice(0, 60)}`)
      }
    }
  }

  // ── Step 3: Merge claude-brain entries ─────────────────────────────────────
  const brainEntries = loadJsonl(CLAUDE_BRAIN)
  log(`\n📂 claude-brain/knowledge.jsonl: ${brainEntries.length} entries`)

  for (const e of brainEntries) {
    const title = e.title || ""
    if (!title) { skipped++; continue }
    if (byTitle.has(normalizeTitle(title))) {
      log(`  ⊘ Already in index: ${title.slice(0, 60)}`)
      skipped++
      continue
    }
    const lessonId = `lesson-${nextNum++}`
    mdAppend += brainToMarkdown(e, lessonId)
    newIndexEntries.push(brainToIndex(e, lessonId))
    byTitle.set(normalizeTitle(title), { id: lessonId })
    log(`  ✅ [${lessonId}] ${title.slice(0, 65)}`)
  }

  // ── Apply changes ──────────────────────────────────────────────────────────
  log(`\n📊 Summary:`)
  log(`  New lessons to add:    ${newIndexEntries.length}`)
  log(`  Entries to patch:      ${patchedLines.size}`)
  log(`  Duplicates skipped:    ${skipped}`)

  if (newIndexEntries.length === 0 && patchedLines.size === 0) {
    log("\n✅ Nothing to merge — all files already consolidated.")
    return
  }

  // Backup before writing
  log("\n📦 Backing up originals...")
  await backup(LESSONS_MD)
  await backup(LESSON_INDEX)

  // Apply patches to lesson-index.jsonl
  if (patchedLines.size > 0) {
    const patched = indexLines.map((line, i) => patchedLines.has(i) ? patchedLines.get(i) : line)
    await fs.writeFile(LESSON_INDEX, patched.join("\n") + "\n", "utf8")
    log(`  ✏️  Patched ${patchedLines.size} entries in lesson-index.jsonl`)
  }

  // Append new entries to lesson-index.jsonl
  if (newIndexEntries.length > 0) {
    await fs.appendFile(LESSON_INDEX, newIndexEntries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8")
    log(`  ➕ Appended ${newIndexEntries.length} new entries to lesson-index.jsonl`)
  }

  // Append new lessons to lessons-learned.md
  if (mdAppend.trim()) {
    await fs.appendFile(LESSONS_MD, mdAppend, "utf8")
    log(`  ➕ Appended ${newIndexEntries.length} new lessons to lessons-learned.md`)
  }

  // Delete absorbed source files
  const toDelete = [
    { file: LESSONS_JSONL, label: "lessons.jsonl" },
    { file: ENRICHED_FILE, label: "enriched-lessons.jsonl" },
  ]
  log("\n🗑️  Removing absorbed source files:")
  for (const { file, label } of toDelete) {
    if (fsSync.existsSync(file)) {
      await fs.unlink(file)
      log(`  🗑️  Deleted ${label}`)
    }
  }

  // Final counts
  const finalIndex = loadJsonl(LESSON_INDEX)
  const finalMd = fsSync.readFileSync(LESSONS_MD, "utf8")
  const finalLessonCount = (finalMd.match(/^### (?:Legacy )?Lesson:/gm) || []).length

  log("\n✅ Merge complete!")
  log(`  lessons-learned.md:  ${finalLessonCount} lessons`)
  log(`  lesson-index.jsonl:  ${finalIndex.length} entries`)
  log(`  Redundant files:     deleted`)
  log("\n  Next: run node scripts/ollama-summarize-lesson.mjs --last-only")
  log("        to regenerate lesson-summaries.json")
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
