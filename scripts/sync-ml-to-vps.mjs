#!/usr/bin/env node
/**
 * sync-ml-to-vps.mjs — Federated ML Sync (Local ↔ VPS)
 *
 * Uploads locally-trained CodeLearner weights to the VPS orchestrator,
 * downloads the latest merged (federated) model, and updates local weights.
 *
 * Protocol:
 *   1. POST /ml/model/upload   → send local model (ModelSerializer format)
 *   2. GET  /ml/model/latest   → fetch VPS merged model
 *   3. If merged model exists + has more samples → update local weights
 *   4. POST /ml/observations/sync → sync outcome observations
 *
 * VPS endpoints (via Tailscale): http://100.64.175.88:8787
 *
 * Usage:
 *   node scripts/sync-ml-to-vps.mjs              # full sync
 *   node scripts/sync-ml-to-vps.mjs --upload     # upload only
 *   node scripts/sync-ml-to-vps.mjs --download   # download only
 *   node scripts/sync-ml-to-vps.mjs --status     # check VPS reachability
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const ROOT       = path.resolve(__dirname, '..')
const MODEL_DIR  = process.env.SUPERROO_MODEL_DIR || path.join(homedir(), '.superroo', 'models')
const MODEL_PATH = path.join(MODEL_DIR, 'code-learner.json')
const BRAIN_OUTCOMES  = path.join('C:', 'Users', 'user', 'brain', 'data', 'ml-outcomes.json')
const CODEX_OUTCOMES  = path.join(ROOT, 'memory', 'codex-brain', 'outcomes.jsonl')
const SYNC_STATE_PATH = path.join(MODEL_DIR, 'vps-sync-state.json')

// VPS config
const VPS_URL      = process.env.SUPERROO_VPS_URL || 'http://100.64.175.88:8787'
const VPS_TOKEN    = process.env.SUPERROO_VPS_TOKEN || ''
const TIMEOUT_MS   = 15000

const args         = process.argv.slice(2)
const statusOnly   = args.includes('--status')
const uploadOnly   = args.includes('--upload')
const downloadOnly = args.includes('--download')

const log  = (...a) => console.log(...a)
const info = (...a) => console.log(' ', ...a)
const warn = (...a) => console.warn('  ⚠️', ...a)
const ok   = (...a) => console.log('  ✅', ...a)

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function vpsPost(endpoint, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${VPS_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(VPS_TOKEN ? { 'Authorization': `Bearer ${VPS_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

async function vpsGet(endpoint) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${VPS_URL}${endpoint}`, {
      headers: { ...(VPS_TOKEN ? { 'Authorization': `Bearer ${VPS_TOKEN}` } : {}) },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

async function checkVps() {
  try {
    const res = await fetch(`${VPS_URL}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch { return false }
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadSyncState() {
  try { return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8')) }
  catch { return { lastUploadAt: null, lastDownloadAt: null, lastObsyncAt: null, totalUploads: 0, totalDownloads: 0 } }
}

function saveSyncState(state) {
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

// ── Model serialization for VPS upload ───────────────────────────────────────

function readLocalModel() {
  if (!fs.existsSync(MODEL_PATH)) return null
  try { return JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8')) }
  catch { return null }
}

function toVpsFormat(localModel) {
  // Convert ModelPersistence format → ModelSerializer format for VPS
  // VPS expects: { schemaVersion: 1, modelType, featureDimensions, trainingSamples, parameters: { weights } }
  const allLayers = [
    ...(localModel.encoder || []),
    ...(localModel.heads?.quality  || []),
    ...(localModel.heads?.success  || []),
    ...(localModel.heads?.bugRisk  || []),
  ]
  return {
    schemaVersion: 1,
    modelType: 'neural-network',
    timestamp: new Date().toISOString(),
    source: 'local',
    featureDimensions: 8,
    trainingSamples: localModel.meta?.trainingSamples || 0,
    architecture: {
      type: 'dense',
      description: localModel.meta?.architecture || '8→128→64 encoder + 3 heads',
      layers: allLayers.map((l, i) => ({ index: i, paramCount: l.length })),
    },
    parameters: {
      // Store full model in custom format with named sections
      weights: allLayers,
      encoder: localModel.encoder,
      heads:   localModel.heads,
    },
    metadata: {
      finalLoss:    localModel.meta?.finalLoss,
      improvement:  localModel.meta?.improvement,
      sources:      localModel.meta?.sources,
      savedAt:      localModel.meta?.savedAt,
      serializedAt: new Date().toISOString(),
    },
  }
}

function fromVpsFormat(vpsModel) {
  // Convert VPS model back to ModelPersistence format for local use
  const params = vpsModel.parameters
  if (params?.encoder && params?.heads) {
    // Full model with named sections
    return {
      version: 1,
      encoder: params.encoder,
      heads:   params.heads,
      meta: { ...vpsModel.metadata, trainingSamples: vpsModel.trainingSamples, source: 'vps-merged' },
    }
  }
  return null
}

// ── Observations ──────────────────────────────────────────────────────────────

function collectObservations() {
  const obs = []

  // Brain MCP outcomes
  if (fs.existsSync(BRAIN_OUTCOMES)) {
    try {
      const raw = JSON.parse(fs.readFileSync(BRAIN_OUTCOMES, 'utf8'))
      for (const o of raw) {
        obs.push({
          taskType: o.tool_used || 'code',
          success: o.success === 1,
          durationMs: 0,
          featuresLocal: o.features || [],
          source: 'brain-mcp',
          sessionId: o.taskId || `brain-${Date.now()}`,
        })
      }
    } catch {}
  }

  // Codex Brain outcomes
  if (fs.existsSync(CODEX_OUTCOMES)) {
    try {
      const lines = fs.readFileSync(CODEX_OUTCOMES, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const o = JSON.parse(line)
          obs.push({
            taskType: o.tool_used || 'code',
            success: o.success === 1,
            durationMs: 0,
            featuresLocal: o.features || [],
            source: 'codex-brain',
            sessionId: o.task_id || `codex-${Date.now()}`,
          })
        } catch {}
      }
    } catch {}
  }

  return obs
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('🌐 SuperRoo ML VPS Sync')
  log(`   VPS: ${VPS_URL}`)
  log('')

  const state = loadSyncState()

  // Check VPS reachability
  const reachable = await checkVps()
  if (!reachable) {
    warn(`VPS not reachable at ${VPS_URL}`)
    warn('Check Tailscale is connected: tailscale status')
    if (statusOnly) {
      log(`Last upload:   ${state.lastUploadAt || 'never'}`)
      log(`Last download: ${state.lastDownloadAt || 'never'}`)
    }
    process.exit(1)
  }
  ok(`VPS reachable`)

  if (statusOnly) {
    log(`Last upload:      ${state.lastUploadAt || 'never'}`)
    log(`Last download:    ${state.lastDownloadAt || 'never'}`)
    log(`Total uploads:    ${state.totalUploads}`)
    log(`Total downloads:  ${state.totalDownloads}`)
    const localModel = readLocalModel()
    if (localModel) {
      log(`Local model:      ${localModel.meta?.trainingSamples || 0} training samples, loss=${localModel.meta?.finalLoss || 'n/a'}`)
    } else {
      log(`Local model:      ❌ not trained yet`)
    }
    return
  }

  // ── Upload local model ────────────────────────────────────────────────────

  if (!downloadOnly) {
    const localModel = readLocalModel()
    if (!localModel) {
      warn('No local model to upload. Run: node scripts/train-central-ml.mjs')
    } else if ((localModel.meta?.trainingSamples || 0) < 5) {
      warn(`Local model has only ${localModel.meta?.trainingSamples} samples — skipping upload (need ≥5)`)
    } else {
      try {
        const vpsFormat = toVpsFormat(localModel)
        const result = await vpsPost('/ml/model/upload', vpsFormat)
        state.lastUploadAt = new Date().toISOString()
        state.totalUploads++
        ok(`Uploaded local model (${localModel.meta?.trainingSamples} samples) → VPS`)
        if (result.modelId) info(`VPS model ID: ${result.modelId}`)
      } catch (err) {
        warn(`Upload failed: ${err.message}`)
      }
    }
  }

  // ── Download merged model ─────────────────────────────────────────────────

  if (!uploadOnly) {
    try {
      const vpsModel = await vpsGet('/ml/model/latest?source=cloud&type=neural-network')
      if (!vpsModel || !vpsModel.parameters) {
        info('No merged model available on VPS yet')
      } else {
        const localModel = readLocalModel()
        const localSamples = localModel?.meta?.trainingSamples || 0
        const vpsSamples   = vpsModel.trainingSamples || 0

        if (vpsSamples > localSamples) {
          const converted = fromVpsFormat(vpsModel)
          if (converted) {
            fs.mkdirSync(MODEL_DIR, { recursive: true })
            fs.writeFileSync(MODEL_PATH, JSON.stringify(converted, null, 2), 'utf8')
            state.lastDownloadAt = new Date().toISOString()
            state.totalDownloads++
            ok(`Downloaded merged model from VPS (${vpsSamples} samples > local ${localSamples})`)
            ok('Local weights updated — ml-router will use merged model on next call')
          }
        } else {
          info(`Local model (${localSamples} samples) ≥ VPS merged model (${vpsSamples}) — keeping local`)
        }
      }
    } catch (err) {
      warn(`Download failed: ${err.message}`)
    }
  }

  // ── Sync observations ─────────────────────────────────────────────────────

  if (!uploadOnly && !downloadOnly) {
    const observations = collectObservations()
    if (observations.length > 0) {
      try {
        await vpsPost('/ml/observations/sync', { observations })
        state.lastObsyncAt = new Date().toISOString()
        ok(`Synced ${observations.length} observations to VPS`)
      } catch (err) {
        warn(`Observation sync failed: ${err.message}`)
      }
    } else {
      info('No observations to sync')
    }
  }

  saveSyncState(state)

  log('')
  log('═'.repeat(50))
  log('✅ VPS sync complete')
  log(`   Uploads:   ${state.totalUploads}`)
  log(`   Downloads: ${state.totalDownloads}`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
