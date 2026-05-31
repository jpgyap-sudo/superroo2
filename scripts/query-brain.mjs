#!/usr/bin/env node
/**
 * Query Brain for Task Context
 *
 * Searches brain's RAG memory for lessons relevant to the current task and
 * prints them as a context block. Used by the Claude SessionStart hook to
 * inject project memory at the start of each session.
 *
 * Usage:
 *   node scripts/query-brain.mjs "<task description>"
 *   node scripts/query-brain.mjs --session-start    # summarize recent lessons
 *   node scripts/query-brain.mjs --stats            # show brain memory stats
 *
 * Outputs plain text — pipe into Claude as context or read in SessionStart hook.
 */

import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Config ────────────────────────────────────────────────────────────────────

const BRAIN_DB      = path.join('C:', 'Users', 'user', 'brain', 'data', 'memory.json')
const OLLAMA_URL    = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const EMBED_MODEL   = 'nomic-embed-text'
const HELPER_SCRIPT = path.join(__dirname, 'ml', 'ollama-curl-helper.cmd')
const TMP_DIR       = fsSync.mkdtempSync(path.join(os.tmpdir(), 'sr-query-brain-'))

const args          = process.argv.slice(2)
const sessionStart  = args.includes('--session-start')
const statsOnly     = args.includes('--stats')
const limitArg      = args.find(a => a.startsWith('--limit='))
const LIMIT         = limitArg ? parseInt(limitArg.split('=')[1]) : 5
const query         = args.filter(a => !a.startsWith('--')).join(' ').trim()

// ── Ollama embed ──────────────────────────────────────────────────────────────

function embedViaCurl(text) {
  const outFile  = path.join(TMP_DIR, `emb_${Date.now()}.json`)
  const bodyFile = path.join(TMP_DIR, `body_${Date.now()}.json`)
  try {
    fsSync.writeFileSync(bodyFile, JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }), 'utf8')
    execSync(`"${HELPER_SCRIPT}" "${OLLAMA_URL}/api/embeddings" "${outFile}" "${bodyFile}"`, {
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const raw = fsSync.readFileSync(outFile, 'utf8')
    return JSON.parse(raw).embedding || null
  } catch {
    return null
  } finally {
    try { fsSync.unlinkSync(outFile) }  catch {}
    try { fsSync.unlinkSync(bodyFile) } catch {}
  }
}

// ── Brain DB ──────────────────────────────────────────────────────────────────

function loadBrainDB() {
  if (!fsSync.existsSync(BRAIN_DB)) return { entries: [] }
  try { return JSON.parse(fsSync.readFileSync(BRAIN_DB, 'utf8')) }
  catch { return { entries: [] } }
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10)
}

function recall(queryEmbed, collection = null, limit = 5) {
  const db = loadBrainDB()
  let candidates = collection
    ? db.entries.filter(e => e.collection === collection)
    : db.entries
  // Skip entries without embeddings
  candidates = candidates.filter(e => Array.isArray(e.embedding))
  return candidates
    .map(e => ({ ...e, score: cosineSimilarity(queryEmbed, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function showStats() {
  const db = loadBrainDB()
  const counts = {}
  for (const e of db.entries) counts[e.collection] = (counts[e.collection] || 0) + 1
  console.log(`🧠 Brain Memory Stats`)
  console.log(`Total entries: ${db.entries.length}`)
  console.log(`Collections:`)
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  - ${name}: ${count} entries`)
  }
  const srCount = counts['superroo-lessons'] || 0
  const syncStateFile = path.join(ROOT, 'memory', 'brain-sync-state.json')
  if (fsSync.existsSync(syncStateFile)) {
    try {
      const state = JSON.parse(fsSync.readFileSync(syncStateFile, 'utf8'))
      console.log(`\nSupeRoo sync:`)
      console.log(`  Synced lessons: ${Object.keys(state.synced || {}).length}`)
      console.log(`  Last sync: ${state.lastSyncAt || 'never'}`)
    } catch {}
  }
}

// ── Session start summary ─────────────────────────────────────────────────────

function sessionStartContext() {
  const db = loadBrainDB()
  const srEntries = db.entries
    .filter(e => e.collection === 'superroo-lessons')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)

  if (srEntries.length === 0) {
    console.log(`<!-- brain: no superroo lessons synced yet — run: node scripts/sync-to-brain.mjs -->`)
    return
  }

  const lines = [
    `<!-- brain-context: ${srEntries.length} recent SuperRoo lessons loaded -->`,
    ``,
    `## Recent SuperRoo Lessons (from brain memory)`,
    ``,
  ]

  for (const e of srEntries) {
    const title = e.metadata?.title || e.content.split('\n')[0].replace(/^#+ /, '')
    const date  = e.metadata?.date  || e.createdAt?.slice(0, 10)
    const tags  = e.metadata?.tags?.join(', ') || ''
    lines.push(`- **${title}** (${date})${tags ? ` — ${tags}` : ''}`)
  }

  lines.push(``, `<!-- end brain-context -->`)
  console.log(lines.join('\n'))
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (statsOnly) { showStats(); return }
  if (sessionStart) { sessionStartContext(); return }

  if (!query) {
    console.error('Usage: node scripts/query-brain.mjs "<query>"')
    console.error('       node scripts/query-brain.mjs --session-start')
    console.error('       node scripts/query-brain.mjs --stats')
    process.exit(1)
  }

  const queryEmbed = embedViaCurl(query)
  if (!queryEmbed) {
    console.error(`❌ Cannot embed query — Ollama not reachable at ${OLLAMA_URL}`)
    process.exit(1)
  }

  const results = recall(queryEmbed, null, LIMIT)

  if (results.length === 0) {
    console.log(`No relevant memories found for: "${query}"`)
    return
  }

  console.log(`🧠 Brain context for: "${query}" (top ${results.length})\n`)
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    console.log(`[${ i + 1 }] ${r.collection} — score: ${r.score.toFixed(3)}`)
    console.log(r.content.slice(0, 600) + (r.content.length > 600 ? '…' : ''))
    console.log()
  }

  // Cleanup
  try { fsSync.rmdirSync(TMP_DIR, { recursive: true }) } catch {}
}

main()
