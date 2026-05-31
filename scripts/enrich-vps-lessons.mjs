#!/usr/bin/env node
/**
 * Enrich Weak VPS Lessons
 *
 * Fetches lessons with empty content from VPS memory-explorer,
 * uses Hermes 3 (local Ollama) to generate proper root_cause,
 * fix, and reusable_rule for each, then pushes enriched versions
 * back to the VPS PostgreSQL via /api/lessons/sync.
 *
 * Usage:
 *   node scripts/enrich-vps-lessons.mjs              # enrich all weak lessons
 *   node scripts/enrich-vps-lessons.mjs --dry-run    # preview only
 *   node scripts/enrich-vps-lessons.mjs --limit 5    # enrich first N only
 */

import { execSync } from "child_process"
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, existsSync } from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const API_URL     = process.env.SUPERROO_API_URL || "https://dev.abcx124.xyz/api"
const OLLAMA_URL  = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
const HERMES_MODEL = "hermes3"
const HELPER      = path.join(__dirname, "ml", "ollama-curl-helper.cmd")
const TMP_DIR     = mkdtempSync(path.join(os.tmpdir(), "sr-enrich-"))

const args     = process.argv.slice(2)
const dryRun   = args.includes("--dry-run")
const limitArg = args.indexOf("--limit")
const maxItems = limitArg >= 0 ? parseInt(args[limitArg + 1] || "999", 10) : 999

const log  = (...a) => console.log(...a)
const warn = (...a) => console.warn(...a)

// ── Ollama chat via curl helper (avoids Node.js fetch() hang on Windows) ──────

function hermesChat(systemPrompt, userPrompt) {
  const outFile  = path.join(TMP_DIR, `out_${Date.now()}.json`)
  const bodyFile = path.join(TMP_DIR, `body_${Date.now()}.json`)
  try {
    writeFileSync(bodyFile, JSON.stringify({
      model: HERMES_MODEL,
      stream: false,
      options: { temperature: 0.3 },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    }), "utf8")

    execSync(`"${HELPER}" "${OLLAMA_URL}/api/chat" "${outFile}" "${bodyFile}"`, {
      timeout: 90000,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    })

    const data = JSON.parse(readFileSync(outFile, "utf8"))
    return data?.message?.content?.trim() || null
  } catch (err) {
    warn("  ⚠️  Hermes call failed:", err.message)
    return null
  } finally {
    try { unlinkSync(outFile) }  catch {}
    try { unlinkSync(bodyFile) } catch {}
  }
}

// ── Generate enriched content for a lesson ────────────────────────────────────

function enrich(lesson) {
  const title = lesson.task || lesson.title || "Unknown task"
  const tags  = (lesson.tags || []).join(", ")
  const files = (lesson.files || []).join(", ")
  const type  = lesson.task_type || "lesson"

  const systemPrompt = `You are a senior software engineer writing structured engineering lessons for a knowledge base.
Given a task title, tags, and affected files, generate concise, actionable content in exactly this JSON format:
{
  "root_cause": "What the core insight or problem was (2-3 sentences, specific and actionable)",
  "fix": "The reusable rule or fix that other engineers should apply (1-2 sentences)",
  "reusable_rule": "A single imperative sentence rule starting with a verb (e.g. Always..., Never..., When...)"
}
Output only the JSON object, no preamble.`

  const userPrompt = `Task: ${title}
Type: ${type}
Tags: ${tags}
Files affected: ${files}

Generate the engineering lesson content:`

  const raw = hermesChat(systemPrompt, userPrompt)
  if (!raw) return null

  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0])
  } catch {
    warn("  ⚠️  JSON parse failed for:", title.slice(0, 50))
    return null
  }
}

// ── Push enriched lessons to VPS PostgreSQL ───────────────────────────────────

async function pushToVPS(enrichedLessons) {
  const payload = enrichedLessons.map(l => ({
    id: l.id || `enriched-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    title: l.task,
    type: l.task_type || "lesson",
    date: l.date || new Date().toISOString().slice(0, 10),
    source: "hermes3-enrichment",
    model: HERMES_MODEL,
    confidence: "high",
    project: l.project || "superroo2",
    files: l.files || [],
    tags: [...(l.tags || []), "enriched"],
    relevance_score: 0.90,
    lesson_summary: l._enriched.root_cause,
    rule_summary: l._enriched.reusable_rule,
  }))

  const res = await fetch(`${API_URL}/lessons/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`VPS sync failed: ${res.status} ${txt.slice(0, 200)}`)
  }

  return await res.json()
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log("🔬 Enrich Weak VPS Lessons via Hermes 3")
  log(`   VPS: ${API_URL}`)
  log(`   Ollama: ${OLLAMA_URL} (${HERMES_MODEL})`)
  log("")

  // 1. Fetch weak lessons from VPS
  log("📥 Fetching weak lessons from VPS...")
  const res = await fetch(`${API_URL.replace("/api", "")}/api/memory-explorer?q=superroo&limit=999`)
  if (!res.ok) throw new Error(`memory-explorer failed: ${res.status}`)
  const data = await res.json()

  const weak = (data.lessons || []).filter(l =>
    (l.root_cause || "").trim() === "No lesson summary recorded." ||
    (l.root_cause || "").trim().length < 30 ||
    (l.fix || "").trim() === "No reusable rule recorded." ||
    (l.fix || "").trim().length < 20
  ).slice(0, maxItems)

  log(`Found ${weak.length} lessons needing enrichment`)
  if (weak.length === 0) { log("✅ Nothing to enrich."); return }
  log("")

  if (dryRun) {
    log("[DRY RUN] Would enrich:")
    weak.forEach(l => log(`  - ${l.task?.slice(0, 70)}`))
    return
  }

  // 2. Verify Ollama is up
  const testRes = hermesChat("reply with OK", "test")
  if (!testRes) {
    warn("❌ Hermes 3 not reachable. Start Ollama and ensure hermes3 is pulled.")
    process.exit(1)
  }
  log("✅ Hermes 3 connected\n")

  // 3. Enrich each lesson
  const enriched = []
  for (let i = 0; i < weak.length; i++) {
    const lesson = weak[i]
    log(`[${i + 1}/${weak.length}] ${lesson.task?.slice(0, 65) || "Untitled"}`)

    const content = enrich(lesson)
    if (!content) { warn("  ⚠️  Skipping — enrichment failed"); continue }

    log(`  root_cause: ${content.root_cause.slice(0, 80)}...`)
    log(`  rule:       ${content.reusable_rule.slice(0, 80)}`)
    log("")

    enriched.push({ ...lesson, _enriched: content })
  }

  log(`\nEnriched ${enriched.length}/${weak.length} lessons`)

  // 4. Save enriched content locally FIRST (before any network calls)
  const outFile = path.join(ROOT, "memory", "enriched-lessons.jsonl")
  const lines = enriched.map(l => JSON.stringify({
    id: l.id,
    task: l.task,
    tags: l.tags,
    files: l.files,
    date: l.date,
    project: l.project,
    root_cause: l._enriched.root_cause,
    fix: l._enriched.fix,
    reusable_rule: l._enriched.reusable_rule,
    enrichedAt: new Date().toISOString(),
    enrichedBy: HERMES_MODEL,
  }))
  writeFileSync(outFile, lines.join("\n") + "\n", "utf8")
  log(`💾 Saved enriched content to memory/enriched-lessons.jsonl`)

  // 5. Push to VPS via curl (avoids Node.js fetch() hanging on Windows HTTPS)
  if (enriched.length === 0) { log("Nothing to push."); return }
  log("\n📤 Pushing enriched lessons to VPS PostgreSQL via curl...")

  const payload = enriched.map(l => ({
    id: `enriched-${(l.id || l.task?.slice(0,20).replace(/\s+/g,'-') || Date.now())}`,
    title: l.task,
    type: l.task_type || "lesson",
    date: l.date || new Date().toISOString().slice(0, 10),
    source: "hermes3-enrichment",
    model: HERMES_MODEL,
    confidence: "high",
    project: l.project || "superroo2",
    files: l.files || [],
    tags: [...(l.tags || []), "enriched"],
    relevance_score: 0.90,
    lesson_summary: l._enriched.root_cause,
    rule_summary: l._enriched.reusable_rule,
  }))

  const payloadFile = path.join(TMP_DIR, "payload.json")
  const pushOutFile = path.join(TMP_DIR, "push_out.json")
  writeFileSync(payloadFile, JSON.stringify(payload), "utf8")

  try {
    execSync(
      `curl -s -X POST "${API_URL}/lessons/sync" -H "Content-Type: application/json" --data-binary "@${payloadFile}" -o "${pushOutFile}" --max-time 30`,
      { timeout: 35000, windowsHide: true }
    )
    const pushResult = JSON.parse(readFileSync(pushOutFile, "utf8"))
    log(`✅ Synced: ${pushResult.synced || 0}, Failed: ${pushResult.failed || 0}`)
  } catch (err) {
    warn(`⚠️  VPS push failed: ${err.message}`)
    warn(`   Enriched content saved locally at memory/enriched-lessons.jsonl`)
    warn(`   Re-run with: node scripts/enrich-vps-lessons.mjs --push-only`)
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
