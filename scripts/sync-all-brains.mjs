#!/usr/bin/env node
/**
 * sync-all-brains.mjs — Unified Three-Brain Sync
 *
 * Keeps all three agent brains synchronized so each knows what the others
 * have learned and are working on.
 *
 * THREE BRAINS:
 *   1. Brain MCP  — C:/Users/user/brain/data/memory.json
 *                   (powers retrieve_context, smart_code, recall)
 *   2. Codex Brain — memory/codex-brain/memory.json
 *                   (Codex's local RAG store)
 *   3. Claude Brain — memory/claude-brain/knowledge.jsonl
 *                   (Claude Code's persistent knowledge)
 *
 * CANONICAL SOURCE: memory/lesson-index.jsonl + memory/lessons-learned.md
 *
 * SYNC PHASES:
 *   1. PROMOTE  — New claude-brain / codex-brain entries → canonical store
 *   2. DISTRIBUTE — Canonical lessons → all three brains (with embeddings)
 *   3. AWARENESS — Build cross-agent status → inject into all brains
 *
 * CROSS-AGENT AWARENESS:
 *   Each brain gets an `agent-context` entry describing what the other agents
 *   have been working on. When Claude calls retrieve_context("fix X"), it
 *   also sees "Codex recently worked on Y" — preventing duplicate work.
 *
 * Usage:
 *   node scripts/sync-all-brains.mjs              # full sync
 *   node scripts/sync-all-brains.mjs --status     # show sync state
 *   node scripts/sync-all-brains.mjs --dry-run    # preview without writing
 *   node scripts/sync-all-brains.mjs --promote    # phase 1 only
 *   node scripts/sync-all-brains.mjs --distribute # phase 2 only
 *   node scripts/sync-all-brains.mjs --awareness  # phase 3 only
 *   node scripts/sync-all-brains.mjs --force      # re-sync everything
 *   node scripts/sync-all-brains.mjs --train      # phase 4: retrain central ML model
 *   node scripts/sync-all-brains.mjs --sync-ml    # phase 5: sync ML model to VPS
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import os from 'os'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = process.env.PROJECT_ROOT || path.resolve(__dirname, '..')
const PROJECT_ID = process.env.PROJECT_ID || path.basename(ROOT)
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), '.superroo')
const GLOBAL_MEMORY_DIR = path.join(SUPERROO_HOME, 'memory')

// ── Paths ─────────────────────────────────────────────────────────────────────

const MEMORY_DIR        = process.env.MEMORY_DIR
  || (fsSync.existsSync(GLOBAL_MEMORY_DIR) ? GLOBAL_MEMORY_DIR : path.join(ROOT, 'memory'))
const CANONICAL_MD      = path.join(MEMORY_DIR, 'lessons-learned.md')
const CANONICAL_JSONL   = path.join(MEMORY_DIR, 'lesson-index.jsonl')
const CLAUDE_BRAIN      = path.join(MEMORY_DIR, 'claude-brain', 'knowledge.jsonl')
const CODEX_BRAIN       = path.join(MEMORY_DIR, 'codex-brain', 'memory.json')
const BRAIN_MCP         = process.env.BRAIN_MCP_PATH || path.join(MEMORY_DIR, 'brain-mcp', 'memory.json')
const CODEX_TASKS       = process.env.CODEX_TASKS_PATH || path.join(ROOT, 'server', 'src', 'memory', 'codextask.json')
const CLAUDE_TASKS      = process.env.CLAUDE_TASKS_PATH || path.join(ROOT, 'server', 'src', 'memory', 'claudetask.json')
const ACTIVE_WORK       = path.join(ROOT, 'ACTIVE_WORK.md')
// Sync state lives globally so it persists across project moves
const SYNC_STATE        = process.env.SYNC_STATE_PATH
  || path.join(os.homedir(), '.superroo', 'sync-state', `${PROJECT_ID}-brains.json`)
const HELPER_SCRIPT     = path.join(__dirname, 'ml', 'ollama-curl-helper.cmd')
const OLLAMA_URL        = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const EMBED_MODEL       = 'nomic-embed-text'
const TMP_DIR           = fsSync.mkdtempSync(path.join(os.tmpdir(), 'sr-brain-sync-'))

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const statusOnly = args.includes('--status')
const dryRun     = args.includes('--dry-run')
const force      = args.includes('--force')
const onlyPromote    = args.includes('--promote')
const onlyDistribute = args.includes('--distribute')
const onlyAwareness  = args.includes('--awareness')
const onlyTrain      = args.includes('--train')
const onlySyncMl     = args.includes('--sync-ml')
const doAll = !onlyPromote && !onlyDistribute && !onlyAwareness && !onlyTrain && !onlySyncMl

const log  = (...a) => console.log(...a)
const info = (...a) => console.log('  ', ...a)
const warn = (...a) => console.warn('  ⚠️ ', ...a)
const ok   = (...a) => console.log('  ✅', ...a)

// ── Embedding helper ──────────────────────────────────────────────────────────

let ollamaAvailable = null

async function checkOllama() {
  if (ollamaAvailable !== null) return ollamaAvailable
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    ollamaAvailable = res.ok
  } catch { ollamaAvailable = false }
  return ollamaAvailable
}

function embedViaCurl(text) {
  const outFile  = path.join(TMP_DIR, `emb_${Date.now()}.json`)
  const bodyFile = path.join(TMP_DIR, `body_${Date.now()}.json`)
  try {
    fsSync.writeFileSync(bodyFile, JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }), 'utf8')
    execSync(`"${HELPER_SCRIPT}" "${OLLAMA_URL}/api/embeddings" "${outFile}" "${bodyFile}"`, {
      timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    })
    const data = JSON.parse(fsSync.readFileSync(outFile, 'utf8'))
    return data.embedding || null
  } catch { return null }
  finally {
    try { fsSync.unlinkSync(outFile) }  catch {}
    try { fsSync.unlinkSync(bodyFile) } catch {}
  }
}

function embed(text) {
  return embedViaCurl(text)
}

// ── State management ──────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fsSync.readFileSync(SYNC_STATE, 'utf8')) }
  catch {
    return {
      promoted:    { claudeBrain: {}, codexBrain: {} },
      distributed: { brainMcp: {}, codexBrain: {}, claudeBrain: {} },
      lastAwarenessAt: null,
      lastSyncAt: null,
    }
  }
}

async function saveState(state) {
  state.lastSyncAt = new Date().toISOString()
  await fs.writeFile(SYNC_STATE, JSON.stringify(state, null, 2), 'utf8')
}

// ── Brain I/O ─────────────────────────────────────────────────────────────────

function loadJsonlFile(filePath) {
  if (!fsSync.existsSync(filePath)) return []
  return fsSync.readFileSync(filePath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

function loadJsonFile(filePath, fallback) {
  if (!fsSync.existsSync(filePath)) return fallback
  try { return JSON.parse(fsSync.readFileSync(filePath, 'utf8')) }
  catch { return fallback }
}

function saveVectorBrain(filePath, db) {
  if (dryRun) return
  const dir = path.dirname(filePath)
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true })
  fsSync.writeFileSync(filePath, JSON.stringify(db, null, 2), 'utf8')
}

// ── Canonical lesson parser ───────────────────────────────────────────────────

function entryHash(id, title) {
  return crypto.createHash('sha1').update(`${id}::${title}`).digest('hex').slice(0, 12)
}

function buildLessonText(entry) {
  return [
    `Lesson: ${entry.title}`,
    entry.rule_summary  ? `Rule: ${entry.rule_summary}` : '',
    entry.lesson_summary ? `Summary: ${entry.lesson_summary}` : '',
    entry.tags?.length  ? `Tags: ${entry.tags.join(', ')}` : '',
    entry.files?.length ? `Files: ${entry.files.join(', ')}` : '',
    entry.source        ? `Source: ${entry.source}` : '',
    entry.date          ? `Date: ${entry.date}` : '',
  ].filter(Boolean).join('\n')
}

// ── Phase 1: PROMOTE agent brain entries → canonical ─────────────────────────

async function promoteClaudeBrain(state) {
  log('\n📤 Phase 1a: Promote Claude Brain → Canonical')
  const entries = loadJsonlFile(CLAUDE_BRAIN)
  const canonicalEntries = loadJsonlFile(CANONICAL_JSONL)
  const canonicalIds = new Set(canonicalEntries.map(e => e.id).filter(Boolean))

  // Entries that originated FROM canonical (Phase 2c dist, awareness injection,
  // or direct canonical copies) must never be promoted back — that is the
  // duplicate promotion loop. Mark them as skipped so future runs don't rescan.
  const isCanonicalOrigin = e =>
    e.canonical_id ||
    (typeof e.source === 'string' && e.source.startsWith('canonical-dist')) ||
    canonicalIds.has(e.id)
  const isAwareness = e =>
    e.id === 'cb-agent-context-status' || (e.tags || []).includes('agent-context')

  const newEntries = []
  for (const e of entries) {
    if (state.promoted.claudeBrain[e.id]) continue
    if (isAwareness(e) || !e.title) continue
    if (isCanonicalOrigin(e)) {
      state.promoted.claudeBrain[e.id] = {
        lessonId: e.canonical_id || e.id,
        promotedAt: new Date().toISOString(),
        skipped: true,
      }
      continue
    }
    newEntries.push(e)
  }

  if (newEntries.length === 0) { info('Nothing new to promote from Claude Brain'); return 0 }
  log(`  Found ${newEntries.length} new Claude Brain entries`)

  const currentMax = canonicalEntries.reduce((max, e) => {
    const n = parseInt((e.id || '').replace('lesson-', ''), 10)
    return isNaN(n) ? max : Math.max(max, n)
  }, 500)
  let nextId = currentMax + 1

  const newMd = []
  const newJsonl = []

  for (const entry of newEntries) {
    const lessonId = `lesson-${nextId++}`
    const date = entry.date || new Date().toISOString().slice(0, 10)
    const tags = [...(entry.tags || []), 'claude-brain'].join(', ')
    // Crash fix: lesson-index-style entries have no `content` field —
    // fall back to rule/lesson summaries, then title.
    const content = entry.content
      || [entry.rule_summary, entry.lesson_summary].filter(Boolean).join('\n')
      || entry.title

    newMd.push(`
### Lesson: ${entry.title}

Date: ${date}
Source: Claude Brain (${entry.type || 'lesson'})
Model/API used: claude-sonnet-4-6
Confidence: ${entry.confidence || 'medium'}
Related files: ${(entry.relatedFiles || []).join(', ') || 'n/a'}

#### Task Summary

${entry.context || 'n/a'}

#### Lesson Learned

${content}

#### Reusable Rule

${content.split('\n')[0]}

#### Tags

${tags}

---`)

    newJsonl.push(JSON.stringify({
      id: lessonId, title: entry.title,
      type: entry.type || 'lesson',
      date, source: 'claude-brain',
      model: 'claude-sonnet-4-6',
      confidence: entry.confidence || 'medium',
      project: PROJECT_ID,
      files: entry.relatedFiles || [],
      tags: [...(entry.tags || []), 'claude-brain'],
      relevance_score: 0.90,
      rule_summary: content.split('. ')[0] + '.',
      lesson_summary: content.slice(0, 250),
      brain_entry_id: entry.id,
    }))

    state.promoted.claudeBrain[entry.id] = { lessonId, promotedAt: new Date().toISOString() }
    ok(`[${lessonId}] ${entry.title.slice(0, 70)}`)
  }

  if (!dryRun) {
    await fs.appendFile(CANONICAL_MD, newMd.join(''), 'utf8')
    await fs.appendFile(CANONICAL_JSONL, newJsonl.join('\n') + '\n', 'utf8')
  }
  return newEntries.length
}

async function promoteCodexBrain(state) {
  log('\n📤 Phase 1b: Promote Codex Brain → Canonical')
  const db = loadJsonFile(CODEX_BRAIN, { entries: [] })
  const importable = (db.entries || []).filter(e =>
    e.collection !== 'superroo-lessons' &&
    e.collection !== 'agent-context' &&
    e.metadata?.source !== 'superroo-lesson-index' &&
    !e.metadata?.lessonId &&
    !state.promoted.codexBrain[e.id]
  )

  if (importable.length === 0) { info('Nothing new to promote from Codex Brain'); return 0 }
  log(`  Found ${importable.length} Codex Brain entries to promote`)

  const canonicalEntries = loadJsonlFile(CANONICAL_JSONL)
  const currentMax = canonicalEntries.reduce((max, e) => {
    const n = parseInt((e.id || '').replace('lesson-', ''), 10)
    return isNaN(n) ? max : Math.max(max, n)
  }, 500)
  let nextId = currentMax + 1

  const newMd = [], newJsonl = []

  for (const entry of importable) {
    const firstLine = (entry.content || '').split('\n').find(l => l.trim()) || 'Codex entry'
    const title = entry.metadata?.title || firstLine.replace(/^#+\s*/, '').slice(0, 100)
    const lessonId = `lesson-${nextId++}`
    const date = (entry.createdAt || new Date().toISOString()).slice(0, 10)
    const tags = [...(entry.metadata?.tags || []), 'codex-brain', entry.collection].filter(Boolean).join(', ')

    newMd.push(`
### Lesson: ${title}

Date: ${date}
Source: Codex Brain (${entry.collection})
Model/API used: codex
Confidence: ${entry.metadata?.confidence || 'medium'}
Related files: ${(entry.metadata?.files || []).join(', ') || 'n/a'}

#### Task Summary

Promoted from Codex Brain.

#### Lesson Learned

${entry.content}

#### Reusable Rule

${entry.content.split('\n')[0]}

#### Tags

${tags}

---`)

    newJsonl.push(JSON.stringify({
      id: lessonId, title,
      type: 'lesson', date, source: 'codex-brain',
      model: 'codex', confidence: entry.metadata?.confidence || 'medium',
      project: PROJECT_ID, files: entry.metadata?.files || [],
      tags: [...(entry.metadata?.tags || []), 'codex-brain', entry.collection],
      relevance_score: 0.85,
      rule_summary: entry.content.split('. ')[0] + '.',
      lesson_summary: entry.content.slice(0, 250),
    }))

    state.promoted.codexBrain[entry.id] = { lessonId, promotedAt: new Date().toISOString() }
    ok(`[${lessonId}] ${title.slice(0, 70)}`)
  }

  if (!dryRun) {
    await fs.appendFile(CANONICAL_MD, newMd.join(''), 'utf8')
    await fs.appendFile(CANONICAL_JSONL, newJsonl.join('\n') + '\n', 'utf8')
  }
  return importable.length
}

// ── Phase 2: DISTRIBUTE canonical → all brains ───────────────────────────────

async function distributeToBrainMcp(canonicalEntries, state) {
  log('\n📥 Phase 2a: Distribute Canonical → Brain MCP')
  const db = loadJsonFile(BRAIN_MCP, { entries: [] })
  const existing = new Set((db.entries || [])
    .flatMap(e => [e.metadata?.canonicalId, e.metadata?.lessonId])
    .filter(Boolean))

  const toSync = canonicalEntries.filter(e =>
    e.id && !existing.has(e.id)
  )

  if (toSync.length === 0) { info('Brain MCP already up to date'); return 0 }
  if (!(await checkOllama())) { warn('Ollama unavailable — skipping Brain MCP embedding'); return 0 }

  log(`  Syncing ${toSync.length} canonical lessons to Brain MCP`)
  let added = 0

  for (const entry of toSync) {
    const text = buildLessonText(entry)
    const embedding = embed(text)
    if (!embedding) { warn(`Embedding failed for ${entry.id}`); continue }

    db.entries.push({
      id: `sr-${entryHash(entry.id, entry.title)}-${Date.now()}`,
      content: text,
      collection: 'superroo-lessons',
      metadata: {
        canonicalId: entry.id, title: entry.title, date: entry.date,
        confidence: entry.confidence, tags: entry.tags, files: entry.files,
        source: entry.source || 'canonical',
      },
      embedding,
      createdAt: new Date().toISOString(),
    })

    state.distributed.brainMcp[entry.id] = { syncedAt: new Date().toISOString() }
    added++
    if (added % 10 === 0) info(`${added}/${toSync.length}...`)
  }

  saveVectorBrain(BRAIN_MCP, db)
  ok(`Added ${added} lessons to Brain MCP (${db.entries.length} total)`)
  return added
}

async function distributeToCodexBrain(canonicalEntries, state) {
  log('\n📥 Phase 2b: Distribute Canonical → Codex Brain')
  const db = loadJsonFile(CODEX_BRAIN, { entries: [] })
  const existing = new Set((db.entries || [])
    .flatMap(e => [e.metadata?.canonicalId, e.metadata?.lessonId])
    .filter(Boolean))

  const toSync = canonicalEntries.filter(e =>
    e.id && !existing.has(e.id)
  )

  if (toSync.length === 0) { info('Codex Brain already up to date'); return 0 }
  if (!(await checkOllama())) { warn('Ollama unavailable — skipping Codex Brain embedding'); return 0 }

  log(`  Syncing ${toSync.length} canonical lessons to Codex Brain`)
  let added = 0

  for (const entry of toSync) {
    const text = buildLessonText(entry)
    const embedding = embed(text)
    if (!embedding) { warn(`Embedding failed for ${entry.id}`); continue }

    db.entries.push({
      id: `cb-dist-${entryHash(entry.id, entry.title)}`,
      content: text,
      collection: 'superroo-lessons',
      metadata: {
        canonicalId: entry.id, title: entry.title, date: entry.date,
        confidence: entry.confidence, tags: entry.tags, files: entry.files,
        source: 'canonical-dist',
      },
      embedding,
      createdAt: new Date().toISOString(),
    })

    state.distributed.codexBrain[entry.id] = { syncedAt: new Date().toISOString() }
    added++
    if (added % 10 === 0) info(`${added}/${toSync.length}...`)
  }

  saveVectorBrain(CODEX_BRAIN, db)
  ok(`Added ${added} lessons to Codex Brain (${db.entries.length} total)`)
  return added
}

async function distributeToClaudeBrain(canonicalEntries, state) {
  log('\n📥 Phase 2c: Distribute Canonical → Claude Brain')
  const existing = new Set(
    loadJsonlFile(CLAUDE_BRAIN)
      .flatMap(e => [e.brain_entry_id, e.canonical_id, e.id])
      .filter(Boolean)
  )

  const toSync = canonicalEntries.filter(e =>
    e.id && !existing.has(e.id) &&
    e.source !== 'claude-brain' // don't re-import own entries
  )

  if (toSync.length === 0) { info('Claude Brain already up to date'); return 0 }
  log(`  Syncing ${toSync.length} canonical lessons to Claude Brain`)

  const lines = toSync.map(entry => JSON.stringify({
    id: `cb-dist-${entryHash(entry.id, entry.title)}`,
    type: entry.type || 'lesson',
    title: entry.title,
    content: entry.lesson_summary || entry.rule_summary || entry.title,
    confidence: entry.confidence || 'medium',
    date: entry.date || new Date().toISOString().slice(0, 10),
    tags: entry.tags || [],
    relatedFiles: entry.files || [],
    source: `canonical-dist (${entry.source || 'unknown'})`,
    canonical_id: entry.id,
  }))

  if (!dryRun) await fs.appendFile(CLAUDE_BRAIN, lines.join('\n') + '\n', 'utf8')

  for (const e of toSync) state.distributed.claudeBrain[e.id] = { syncedAt: new Date().toISOString() }
  ok(`Added ${toSync.length} lessons to Claude Brain`)
  return toSync.length
}

// ── Phase 3: AWARENESS — cross-agent context injection ────────────────────────

function getRecentTasks(filePath, agentName, limit = 5) {
  const data = loadJsonFile(filePath, { tasks: [] })
  const tasks = (data.tasks || [])
    .sort((a, b) => new Date(b.updatedAt || b.startedAt || 0) - new Date(a.updatedAt || a.startedAt || 0))
    .slice(0, limit)

  if (tasks.length === 0) return `  ${agentName}: no recent tasks recorded`

  return tasks.map(t => {
    const status = t.status === 'active' ? '🔵 ACTIVE' : t.status === 'completed' ? '✅' : '⏳'
    const date = (t.updatedAt || t.startedAt || '').slice(0, 10)
    const files = t.filesChanged?.slice(0, 3).join(', ') || ''
    return `  ${status} [${date}] ${t.title}${files ? `\n       Files: ${files}` : ''}`
  }).join('\n')
}

function getRecentLessons(entries, source, limit = 5) {
  return entries
    .filter(e => e.source?.includes(source) || e.tags?.includes(source.toLowerCase()))
    .slice(-limit)
    .reverse()
    .map(e => `  • [${e.date || '?'}] ${e.title}`)
    .join('\n') || `  (none tagged ${source})`
}

async function injectAwareness(state) {
  log('\n🔄 Phase 3: Cross-Agent Awareness Injection')

  const canonicalEntries = loadJsonlFile(CANONICAL_JSONL)
  const recentCanonical = canonicalEntries.slice(-20).reverse()

  const codexTasksText  = getRecentTasks(CODEX_TASKS,  'Codex')
  const claudeTasksText = getRecentTasks(CLAUDE_TASKS, 'Claude Code')
  const codexLessons    = getRecentLessons(recentCanonical, 'codex', 5)
  const claudeLessons   = getRecentLessons(recentCanonical, 'claude', 5)
  const kiloLessons     = getRecentLessons(recentCanonical, 'kilo', 5)

  // Active tasks across all agents
  const allTasks = [
    ...(loadJsonFile(CODEX_TASKS, { tasks: [] }).tasks || []),
    ...(loadJsonFile(CLAUDE_TASKS, { tasks: [] }).tasks || []),
  ]
  const activeTasks = allTasks.filter(t => t.status === 'active')

  // If ACTIVE_WORK.md exists, use it directly as the awareness text
  if (fsSync.existsSync(ACTIVE_WORK)) {
    const activeWorkContent = fsSync.readFileSync(ACTIVE_WORK, 'utf8')
    const truncated = activeWorkContent.slice(0, 6000) // keep embedding manageable

    if (await checkOllama()) {
      const embedding = embed(truncated)
      if (embedding) {
        const db = loadJsonFile(BRAIN_MCP, { entries: [] })
        db.entries = (db.entries || []).filter(e => e.id !== 'agent-context-status')
        db.entries.push({ id: 'agent-context-status', content: truncated, collection: 'agent-context', metadata: { updatedAt: new Date().toISOString(), source: 'ACTIVE_WORK.md' }, embedding, createdAt: new Date().toISOString() })
        saveVectorBrain(BRAIN_MCP, db)
        ok('Injected ACTIVE_WORK.md into Brain MCP')

        const cdb = loadJsonFile(CODEX_BRAIN, { entries: [] })
        cdb.entries = (cdb.entries || []).filter(e => e.id !== 'agent-context-status')
        cdb.entries.push({ id: 'agent-context-status', content: truncated, collection: 'agent-context', metadata: { updatedAt: new Date().toISOString(), source: 'ACTIVE_WORK.md' }, embedding, createdAt: new Date().toISOString() })
        saveVectorBrain(CODEX_BRAIN, cdb)
        ok('Injected ACTIVE_WORK.md into Codex Brain')
      }
    }

    if (!dryRun) {
      const existing = loadJsonlFile(CLAUDE_BRAIN).filter(e => e.id !== 'cb-agent-context-status')
      existing.push({ id: 'cb-agent-context-status', type: 'observation', title: 'Active Work Board', content: truncated, confidence: 'high', date: new Date().toISOString().slice(0, 10), tags: ['agent-context', 'active-work'], source: 'ACTIVE_WORK.md' })
      await fs.writeFile(CLAUDE_BRAIN, existing.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
      ok('Injected ACTIVE_WORK.md into Claude Brain')
    }

    state.lastAwarenessAt = new Date().toISOString()
    return truncated
  }

  const awarenessText = `# Cross-Agent Status
Updated: ${new Date().toISOString().slice(0, 16)} UTC

## 🔵 Active Right Now
${activeTasks.length > 0
  ? activeTasks.map(t => `  • [${t.agent || 'agent'}] ${t.title}`).join('\n')
  : '  (no active tasks)'}

## Codex — Recent Work
${codexTasksText}

## Codex — Recent Lessons
${codexLessons}

## Claude Code — Recent Work
${claudeTasksText}

## Claude Code — Recent Lessons
${claudeLessons}

## Kilo Code — Recent Lessons
${kiloLessons}

## Summary Stats
  Canonical lessons: ${canonicalEntries.length}
  Claude Brain entries: ${loadJsonlFile(CLAUDE_BRAIN).length}
  Codex Brain entries: ${loadJsonFile(CODEX_BRAIN, { entries: [] }).entries?.length || 0}
  Brain MCP entries: ${loadJsonFile(BRAIN_MCP, { entries: [] }).entries?.length || 0}
`

  log(awarenessText)

  // Inject into Brain MCP
  if (!(await checkOllama())) {
    warn('Ollama unavailable — skipping awareness embedding')
  } else {
    const embedding = embed(awarenessText)
    if (embedding) {
      const db = loadJsonFile(BRAIN_MCP, { entries: [] })
      db.entries = (db.entries || []).filter(e => e.id !== 'agent-context-status')
      db.entries.push({
        id: 'agent-context-status',
        content: awarenessText,
        collection: 'agent-context',
        metadata: { updatedAt: new Date().toISOString(), type: 'cross-agent-awareness' },
        embedding,
        createdAt: new Date().toISOString(),
      })
      saveVectorBrain(BRAIN_MCP, db)
      ok('Injected awareness into Brain MCP')
    }
  }

  // Inject into Codex Brain
  if (await checkOllama()) {
    const embedding = embed(awarenessText)
    if (embedding) {
      const db = loadJsonFile(CODEX_BRAIN, { entries: [] })
      db.entries = (db.entries || []).filter(e => e.id !== 'agent-context-status')
      db.entries.push({
        id: 'agent-context-status',
        content: awarenessText,
        collection: 'agent-context',
        metadata: { updatedAt: new Date().toISOString(), type: 'cross-agent-awareness' },
        embedding,
        createdAt: new Date().toISOString(),
      })
      saveVectorBrain(CODEX_BRAIN, db)
      ok('Injected awareness into Codex Brain')
    }
  }

  // Inject into Claude Brain (no embedding needed, text-based)
  if (!dryRun) {
    const existing = loadJsonlFile(CLAUDE_BRAIN)
    const withoutAwareness = existing.filter(e => e.id !== 'cb-agent-context-status')
    const updated = [
      ...withoutAwareness,
      {
        id: 'cb-agent-context-status',
        type: 'observation',
        title: 'Cross-agent status',
        content: awarenessText,
        confidence: 'high',
        date: new Date().toISOString().slice(0, 10),
        tags: ['agent-context', 'cross-agent', 'awareness'],
        source: 'sync-all-brains',
      },
    ]
    await fs.writeFile(CLAUDE_BRAIN, updated.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
    ok('Injected awareness into Claude Brain')
  }

  state.lastAwarenessAt = new Date().toISOString()
  return awarenessText
}

// ── Status reporter ───────────────────────────────────────────────────────────

async function showStatus() {
  const state = loadState()
  const canonical = loadJsonlFile(CANONICAL_JSONL)
  const claudeBrain = loadJsonlFile(CLAUDE_BRAIN)
  const codexBrain = loadJsonFile(CODEX_BRAIN, { entries: [] })
  const brainMcp = loadJsonFile(BRAIN_MCP, { entries: [] })

  const brainMcpLessons = new Set((brainMcp.entries || [])
    .map(e => e.metadata?.canonicalId || e.metadata?.lessonId)
    .filter(Boolean)).size
  const codexBrainLessons = new Set((codexBrain.entries || [])
    .map(e => e.metadata?.canonicalId || e.metadata?.lessonId)
    .filter(Boolean)).size
  const canonicalIds = new Set(canonical.map(e => e.id).filter(Boolean))
  const claudeBrainLessons = new Set(claudeBrain
    .map(e => e.canonical_id || e.brain_entry_id || (canonicalIds.has(e.id) ? e.id : null))
    .filter(Boolean)).size

  log('\n📊 Brain Sync Status')
  log('═'.repeat(55))
  log(`Canonical (lesson-index.jsonl)    ${String(canonical.length).padStart(5)} entries`)
  log(`Claude Brain (knowledge.jsonl)    ${String(claudeBrain.length).padStart(5)} entries`)
  log(`Codex Brain (memory.json)         ${String((codexBrain.entries || []).length).padStart(5)} entries`)
  log(`Brain MCP  (memory.json)          ${String((brainMcp.entries || []).length).padStart(5)} entries`)
  log('─'.repeat(55))
  log(`Canonical → Brain MCP synced:     ${String(brainMcpLessons).padStart(5)}`)
  log(`Canonical → Codex Brain synced:   ${String(codexBrainLessons).padStart(5)}`)
  log(`Canonical -> Claude Brain synced: ${String(claudeBrainLessons).padStart(5)}`)
  log(`Promoted from Claude Brain:       ${String(Object.keys(state.promoted?.claudeBrain || {}).length).padStart(5)}`)
  log(`Promoted from Codex Brain:        ${String(Object.keys(state.promoted?.codexBrain || {}).length).padStart(5)}`)
  log(`Last full sync:   ${state.lastSyncAt || 'never'}`)
  log(`Last awareness:   ${state.lastAwarenessAt || 'never'}`)

  const awEntry = (brainMcp.entries || []).find(e => e.id === 'agent-context-status')
  if (awEntry) {
    log('\nLatest awareness entry:')
    log(awEntry.content.split('\n').slice(0, 10).map(l => '  ' + l).join('\n'))
  }
}

// ── Phase 4: ML Training ──────────────────────────────────────────────────────

async function maybeTrainML(state) {
  log('\n🧠 Phase 4: Central ML Training')
  const TRAIN_SCRIPT = path.join(ROOT, 'scripts', 'train-central-ml.mjs')
  const BRAIN_OUTCOMES = path.join('C:', 'Users', 'user', 'brain', 'data', 'ml-outcomes.json')
  const CODEX_OUTCOMES = path.join(ROOT, 'memory', 'codex-brain', 'outcomes.jsonl')

  // Count available samples
  let total = 0
  const canonical = loadJsonlFile(CANONICAL_JSONL)
  total += canonical.length  // lessons always available as training signal

  if (fsSync.existsSync(BRAIN_OUTCOMES)) {
    try { total += JSON.parse(fsSync.readFileSync(BRAIN_OUTCOMES, 'utf8')).length } catch {}
  }
  if (fsSync.existsSync(CODEX_OUTCOMES)) {
    total += fsSync.readFileSync(CODEX_OUTCOMES, 'utf8').split('\n').filter(Boolean).length
  }

  const lastTrain = state.lastTrainAt ? new Date(state.lastTrainAt) : null
  const hoursSinceTrain = lastTrain ? (Date.now() - lastTrain.getTime()) / 3600000 : Infinity

  if (total < 5) {
    info(`Not enough data to train (${total} samples, need ≥5)`); return
  }
  if (hoursSinceTrain < 1 && !force) {
    info(`Skipping training — last trained ${hoursSinceTrain.toFixed(1)}h ago (run --force to override)`); return
  }

  log(`  Training on ${total} samples (${canonical.length} lessons + explicit outcomes)...`)
  if (dryRun) { info('(dry-run — skipping actual training)'); return }

  try {
    const { spawnSync } = await import('child_process')
    const result = spawnSync(process.execPath, [TRAIN_SCRIPT, '--epochs=50'], {
      cwd: ROOT, encoding: 'utf8', timeout: 300000,
    })
    if (result.status !== 0) {
      warn(`Training failed: ${result.stderr?.slice(0, 200) || 'unknown error'}`)
    } else {
      ok('ML model retrained successfully')
      const lastLine = (result.stdout || '').split('\n').filter(l => l.includes('loss=')).pop()
      if (lastLine) info(lastLine.trim())
      state.lastTrainAt = new Date().toISOString()
    }
  } catch (err) {
    warn(`Training error: ${err.message}`)
  }
}

async function syncMlToVps() {
  log('\n🌐 Phase 5: ML VPS Sync')
  const SYNC_SCRIPT = path.join(ROOT, 'scripts', 'sync-ml-to-vps.mjs')
  if (dryRun) { info('(dry-run — skipping VPS sync)'); return }
  try {
    const { spawnSync } = await import('child_process')
    const result = spawnSync(process.execPath, [SYNC_SCRIPT], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
    })
    if (result.status !== 0) warn(`VPS sync failed: ${result.stderr?.slice(0, 200) || 'VPS unreachable'}`)
    else ok('ML synced to VPS')
  } catch (err) {
    warn(`VPS sync error: ${err.message}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('🧠 sync-all-brains — Three-Brain Unified Sync')
  if (dryRun) log('  (DRY RUN — no files will be written)')
  log('')

  if (statusOnly) { await showStatus(); return }

  const state = loadState()
  const canonicalEntries = loadJsonlFile(CANONICAL_JSONL)
  log(`Canonical entries: ${canonicalEntries.length}`)

  let totalPromoted = 0, totalDistributed = 0

  // Phase 1: Promote
  if (doAll || onlyPromote) {
    totalPromoted += await promoteClaudeBrain(state)
    totalPromoted += await promoteCodexBrain(state)
    if (totalPromoted > 0) {
      // Reload canonical after promotion
      canonicalEntries.splice(0, canonicalEntries.length, ...loadJsonlFile(CANONICAL_JSONL))
      log(`\n  Promoted ${totalPromoted} entries to canonical`)
    }
  }

  // Phase 2: Distribute
  if (doAll || onlyDistribute) {
    totalDistributed += await distributeToBrainMcp(canonicalEntries, state)
    totalDistributed += await distributeToCodexBrain(canonicalEntries, state)
    totalDistributed += await distributeToClaudeBrain(canonicalEntries, state)
  }

  // Phase 3: Awareness
  if (doAll || onlyAwareness) {
    await injectAwareness(state)
  }

  // Phase 4: Retrain central ML model if enough new outcomes
  if (doAll || onlyTrain) {
    await maybeTrainML(state)
  }

  // Phase 5: Sync ML model to VPS
  if (onlySyncMl) {
    await syncMlToVps()
  }

  if (!dryRun) await saveState(state)

  log('\n' + '═'.repeat(55))
  log(`✅ Sync complete`)
  log(`   Promoted:    ${totalPromoted} new entries → canonical`)
  log(`   Distributed: ${totalDistributed} canonical → brains`)
  log(`   Awareness:   injected into all three brains`)
  log('')
  log('All three brains now share:')
  log('  • All lessons from Codex, Claude Code, and Kilo Code')
  log('  • Current active tasks per agent')
  log('  • Recent work summary for cross-agent awareness')

  try { fsSync.rmdirSync(TMP_DIR, { recursive: true }) } catch {}
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
