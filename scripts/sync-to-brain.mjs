#!/usr/bin/env node
/**
 * SuperRoo → Brain Sync
 *
 * Reads lessons from memory/lessons-learned.md, generates embeddings via local
 * Ollama (nomic-embed-text), and stores them directly in brain's memory.json.
 * Tracks synced IDs in memory/brain-sync-state.json to avoid duplicates.
 *
 * Usage:
 *   node scripts/sync-to-brain.mjs              # sync all new lessons
 *   node scripts/sync-to-brain.mjs --last-only  # sync only the most recent lesson
 *   node scripts/sync-to-brain.mjs --force      # re-sync all lessons
 *   node scripts/sync-to-brain.mjs --status     # show sync state without syncing
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import os from 'os'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const LESSONS_FILE  = path.join(ROOT, 'memory', 'lessons-learned.md')
const SYNC_STATE    = path.join(ROOT, 'memory', 'brain-sync-state.json')
const BRAIN_DB      = path.join('C:', 'Users', 'user', 'brain', 'data', 'memory.json')
const OLLAMA_URL    = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const EMBED_MODEL   = 'nomic-embed-text'
const COLLECTION    = 'superroo-lessons'
const HELPER_SCRIPT = path.join(__dirname, 'ml', 'ollama-curl-helper.cmd')
const TMP_DIR       = fsSync.mkdtempSync(path.join(os.tmpdir(), 'sr-brain-sync-'))

const args      = process.argv.slice(2)
const lastOnly  = args.includes('--last-only')
const force     = args.includes('--force')
const statusOnly = args.includes('--status')
const quiet     = args.includes('--quiet')

const log  = (...a) => { if (!quiet) console.log(...a) }
const warn = (...a) => { if (!quiet) console.warn(...a) }

function embedViaCurl(text) {
  const outFile  = path.join(TMP_DIR, `emb_${Date.now()}.json`)
  const bodyFile = path.join(TMP_DIR, `body_${Date.now()}.json`)
  try {
    fsSync.writeFileSync(bodyFile, JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }), 'utf8')
    execSync(`"${HELPER_SCRIPT}" "${OLLAMA_URL}/api/embeddings" "${outFile}" "${bodyFile}"`, {
      timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    })
    const raw = fsSync.readFileSync(outFile, 'utf8')
    const data = JSON.parse(raw)
    return data.embedding || null
  } catch { return null }
  finally {
    try { fsSync.unlinkSync(outFile) }  catch {}
    try { fsSync.unlinkSync(bodyFile) } catch {}
  }
}

function loadBrainDB() {
  const dir = path.dirname(BRAIN_DB)
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true })
  if (!fsSync.existsSync(BRAIN_DB)) return { entries: [] }
  try { return JSON.parse(fsSync.readFileSync(BRAIN_DB, 'utf8')) }
  catch { return { entries: [] } }
}

function saveBrainDB(db) {
  fsSync.writeFileSync(BRAIN_DB, JSON.stringify(db, null, 2), 'utf8')
}

function loadSyncState() {
  try { return JSON.parse(fsSync.readFileSync(SYNC_STATE, 'utf8')) }
  catch { return { synced: {}, lastSyncAt: null } }
}

async function saveSyncState(state) {
  await fs.writeFile(SYNC_STATE, JSON.stringify(state, null, 2), 'utf8')
}

function lessonHash(title, date) {
  return crypto.createHash('sha1').update(`${title}::${date}`).digest('hex').slice(0, 12)
}

function parseLessons(content) {
  const lessons = []
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const headerMatch = lines[i].match(/^### (?:Legacy )?Lesson: (.+)$/)
    if (!headerMatch) { i++; continue }
    const title = headerMatch[1].trim()
    const startLine = i
    i++
    while (i < lines.length && !lines[i].match(/^### (?:Legacy )?Lesson: /)) i++
    const block = lines.slice(startLine, i).join('\n')
    const dateM       = block.match(/^Date:\s*(.+)$/m)
    const sourceM     = block.match(/^Source:\s*(.+)$/m)
    const modelM      = block.match(/^Model\/API used:\s*(.+)$/m)
    const confidenceM = block.match(/^Confidence:\s*(.+)$/m)
    const filesM      = block.match(/^Related files:\s*(.+)$/m)
    const tagsM       = block.match(/^#### Tags\s*\n([\s\S]+?)(?=\n###|$)/)
    const lessonM     = block.match(/#### Lesson Learned\s*\n([\s\S]+?)(?=\n####|$)/)
    const ruleM       = block.match(/#### Reusable Rule\s*\n([\s\S]+?)(?=\n####|$)/)
    const taskM       = block.match(/#### Task Summary\s*\n([\s\S]+?)(?=\n####|$)/)
    lessons.push({
      title,
      date:       dateM?.[1]?.trim()       || 'unknown',
      source:     sourceM?.[1]?.trim()     || 'unknown',
      model:      modelM?.[1]?.trim()      || 'unknown',
      confidence: confidenceM?.[1]?.trim() || 'unknown',
      files:      filesM?.[1]?.trim().split(',').map(f => f.trim()).filter(Boolean) || [],
      tags:       tagsM?.[1]?.trim().split(/[,\n]/).map(t => t.trim()).filter(Boolean) || [],
      lesson:     lessonM?.[1]?.trim()     || '',
      rule:       ruleM?.[1]?.trim()       || '',
      task:       taskM?.[1]?.trim()       || '',
      fullContent: block.trim(),
    })
  }
  return lessons
}

function buildMemoryContent(lesson) {
  return [
    `# SuperRoo Lesson: ${lesson.title}`,
    ``,
    `**Date:** ${lesson.date}`,
    `**Confidence:** ${lesson.confidence}`,
    `**Files:** ${lesson.files.join(', ') || 'n/a'}`,
    `**Tags:** ${lesson.tags.join(', ') || 'n/a'}`,
    ``,
    lesson.task    ? `## Task Summary\n${lesson.task}\n`    : '',
    lesson.lesson  ? `## Lesson Learned\n${lesson.lesson}\n`  : '',
    lesson.rule    ? `## Reusable Rule\n${lesson.rule}\n`    : '',
  ].filter(l => l !== undefined).join('\n').trim()
}

async function main() {
  log(`🧠 SuperRoo → Brain Sync`)
  log(`Brain DB:  ${BRAIN_DB}`)
  log(`Ollama:    ${OLLAMA_URL} (${EMBED_MODEL})`)
  log('')

  let content
  try { content = await fs.readFile(LESSONS_FILE, 'utf8') }
  catch { warn(`❌ Lessons file not found: ${LESSONS_FILE}`); process.exit(1) }

  let lessons = parseLessons(content)
  log(`Found ${lessons.length} lessons in lessons-learned.md`)

  if (lessons.length === 0) { log('Nothing to sync.'); return }

  const state = loadSyncState()

  if (statusOnly) {
    const synced = Object.keys(state.synced).length
    log(`\nSync state:`)
    log(`  Synced: ${synced}/${lessons.length} lessons`)
    log(`  Last sync: ${state.lastSyncAt || 'never'}`)
    const db = loadBrainDB()
    const srEntries = db.entries.filter(e => e.collection === COLLECTION)
    log(`  Brain entries (${COLLECTION}): ${srEntries.length}`)
    return
  }

  if (lastOnly) {
    lessons = [lessons[lessons.length - 1]]
    log(`--last-only: syncing only "${lessons[0].title}"`)
  } else if (!force) {
    const before = lessons.length
    lessons = lessons.filter(l => !state.synced[lessonHash(l.title, l.date)])
    log(`${before - lessons.length} already synced, ${lessons.length} new`)
  } else {
    log(`--force: re-syncing all ${lessons.length} lessons`)
  }

  if (lessons.length === 0) { log('\n✅ All lessons already in brain. Nothing to do.'); return }

  const testEmbed = embedViaCurl('test connectivity')
  if (!testEmbed) {
    warn(`\n❌ Cannot reach Ollama at ${OLLAMA_URL}`)
    process.exit(1)
  }
  log(`✅ Ollama connected (embedding dims: ${testEmbed.length})`)
  log('')

  const db = loadBrainDB()
  let added = 0, failed = 0

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i]
    const hash = lessonHash(lesson.title, lesson.date)
    log(`[${i + 1}/${lessons.length}] ${lesson.title}`)

    const content = buildMemoryContent(lesson)
    const embedding = embedViaCurl(content)

    if (!embedding) { warn(`  ⚠️  Embedding failed — skipping`); failed++; continue }

    if (force) db.entries = db.entries.filter(e => e.metadata?.superrooHash !== hash)

    db.entries.push({
      id: `sr-${hash}-${Date.now()}`,
      content,
      collection: COLLECTION,
      metadata: { superrooHash: hash, title: lesson.title, date: lesson.date, confidence: lesson.confidence, tags: lesson.tags, files: lesson.files, source: 'superroo-lessons-learned' },
      embedding,
      createdAt: new Date().toISOString(),
    })

    state.synced[hash] = { title: lesson.title, date: lesson.date, syncedAt: new Date().toISOString() }
    added++
    log(`  ✅ Stored (${embedding.length}d embedding)`)
  }

  saveBrainDB(db)
  state.lastSyncAt = new Date().toISOString()
  await saveSyncState(state)

  log('')
  log('═'.repeat(50))
  log(`✅ Synced ${added} lessons to brain`)
  if (failed > 0) log(`⚠️  ${failed} failed`)
  log(`Brain total entries: ${db.entries.length}`)
  log(`SuperRoo collection: ${db.entries.filter(e => e.collection === COLLECTION).length}`)

  try { fsSync.rmdirSync(TMP_DIR, { recursive: true }) } catch {}
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
