#!/usr/bin/env node
/**
 * Batch-enrich all draft/TODO entries in lesson-index.jsonl
 * using Hermes 3 (local Ollama).
 *
 * Patches lesson_summary, rule_summary, policy_status, confidence
 * in-place. Saves progress after every 10 entries so it's resumable.
 *
 * Usage:
 *   node scripts/enrich-draft-lessons.mjs           # enrich all drafts
 *   node scripts/enrich-draft-lessons.mjs --limit 20 # first N only
 *   node scripts/enrich-draft-lessons.mjs --dry-run  # preview only
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, unlinkSync } from "fs"
import { execSync } from "child_process"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, "..")
const INDEX     = path.join(ROOT, "memory", "lesson-index.jsonl")
const HELPER    = path.join(__dirname, "ml", "ollama-curl-helper.cmd")
const TMP_DIR   = mkdtempSync(path.join(os.tmpdir(), "sr-enrich-draft-"))
const OLLAMA    = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
const MODEL     = "hermes3"
const SAVE_EVERY = 10   // checkpoint after every N enrichments

const args    = process.argv.slice(2)
const dryRun  = args.includes("--dry-run")
const limitIdx = args.indexOf("--limit")
const limit   = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "9999", 10) : 9999

const log  = (...a) => console.log(...a)
const warn = (...a) => console.warn(...a)

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadLines() {
  return readFileSync(INDEX, "utf8").split("\n")
}

function saveLines(lines) {
  writeFileSync(INDEX, lines.join("\n"), "utf8")
}

function parseEntry(line) {
  try { return JSON.parse(line) } catch { return null }
}

function isDraft(e) {
  if (!e) return false
  const ls = (e.lesson_summary || "").trim()
  const rs = (e.rule_summary   || "").trim()
  return (
    e.policy_status === "draft" ||
    ls.includes("TODO") ||
    ls.includes("To be determined") ||
    rs.includes("TODO") ||
    (!ls && !rs)
  )
}

function hermesChat(system, user) {
  const out  = path.join(TMP_DIR, `o${Date.now()}.json`)
  const body = path.join(TMP_DIR, `b${Date.now()}.json`)
  try {
    writeFileSync(body, JSON.stringify({
      model: MODEL, stream: false,
      options: { temperature: 0.25 },
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user   },
      ],
    }), "utf8")
    execSync(`"${HELPER}" "${OLLAMA}/api/chat" "${out}" "${body}"`, {
      timeout: 90000, stdio: ["pipe","pipe","ignore"], windowsHide: true,
    })
    const data = JSON.parse(readFileSync(out, "utf8"))
    return data?.message?.content?.trim() || null
  } catch { return null }
  finally {
    try { unlinkSync(out)  } catch {}
    try { unlinkSync(body) } catch {}
  }
}

function enrich(e) {
  const system = `You are a senior engineer writing structured engineering lessons for a knowledge base.
Given a lesson title, type, tags, and files, generate two fields in JSON:
{
  "lesson_summary": "2-3 sentences describing the core insight, what went wrong or what was learned, and why it matters",
  "rule_summary": "One imperative sentence starting with a strong verb (Always, Never, When X do Y)"
}
Output ONLY the JSON object. No markdown, no preamble.`

  const user = `Title: ${e.title}
Type: ${e.type || "lesson"}
Tags: ${(e.tags || []).join(", ") || "n/a"}
Files: ${(e.files || []).slice(0,6).join(", ") || "n/a"}
Date: ${e.date || "unknown"}

Generate lesson_summary and rule_summary:`

  const raw = hermesChat(system, user)
  if (!raw) return null
  try {
    const m = raw.match(/\{[\s\S]*?\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (!parsed.lesson_summary || !parsed.rule_summary) return null
    return parsed
  } catch { return null }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log("🔬 Batch Enrich Draft Lessons — Hermes 3")
  log(`   Index: ${INDEX}`)
  log(`   Ollama: ${OLLAMA}`)
  log("")

  // Verify Hermes 3 is up
  const ping = hermesChat("reply with one word", "ping")
  if (!ping) { warn("❌ Hermes 3 not reachable"); process.exit(1) }
  log("✅ Hermes 3 connected\n")

  let lines = loadLines()
  const draftIndices = []

  lines.forEach((line, i) => {
    const e = parseEntry(line)
    if (e && isDraft(e)) draftIndices.push(i)
  })

  const targets = draftIndices.slice(0, limit)
  log(`Found ${draftIndices.length} draft entries, processing ${targets.length}`)

  if (dryRun) {
    log("\n[DRY RUN] Would enrich:")
    targets.slice(0, 15).forEach(i => {
      const e = parseEntry(lines[i])
      log(`  [${e?.id}] ${(e?.title || "").slice(0, 65)}`)
    })
    if (targets.length > 15) log(`  ... and ${targets.length - 15} more`)
    return
  }

  let enriched = 0, failed = 0

  for (let idx = 0; idx < targets.length; idx++) {
    const lineIdx = targets[idx]
    const e = parseEntry(lines[lineIdx])
    if (!e) { failed++; continue }

    const num = idx + 1
    process.stdout.write(`[${num}/${targets.length}] ${(e.title || "").slice(0, 60).padEnd(60)} `)

    const result = enrich(e)
    if (!result) {
      process.stdout.write("⚠️  failed\n")
      failed++
      continue
    }

    // Patch entry
    e.lesson_summary = result.lesson_summary
    e.rule_summary   = result.rule_summary
    e.policy_status  = "promotable"
    e.confidence     = e.confidence === "unknown" ? "medium" : e.confidence
    e.enriched_by    = MODEL
    e.enriched_at    = new Date().toISOString()
    // Remove draft quality score and replace
    if (e.quality_score !== undefined && e.quality_score < 0.5) e.quality_score = 0.75

    lines[lineIdx] = JSON.stringify(e)
    enriched++
    process.stdout.write("✅\n")

    // Checkpoint every SAVE_EVERY entries
    if (enriched % SAVE_EVERY === 0) {
      saveLines(lines)
      log(`  💾 Checkpoint saved (${enriched} done)`)
    }
  }

  // Final save
  saveLines(lines)

  log(`\n✅ Enrichment complete`)
  log(`   Enriched: ${enriched}`)
  log(`   Failed:   ${failed}`)
  log(`   Index:    ${lines.filter(l => parseEntry(l)).length} total entries`)
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
