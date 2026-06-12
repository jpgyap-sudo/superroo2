#!/usr/bin/env node
/**
 * SuperRoo ML Full Bidirectional Sync — all agents ↔ VPS
 * Paste into Node.js REPL or run: node scripts/sync-ml-full.mjs
 *
 * Syncs: Claude Code + Codex Brain + Kilo Code → VPS and back
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const VPS       = process.env.SUPERROO_VPS_URL || 'http://100.64.175.88:8787'
const SSH_KEY   = path.join(os.homedir(), '.ssh', 'id_superroo_vps')
const MODEL_DIR = path.join(os.homedir(), '.superroo', 'models')
const MODEL_PATH = path.join(MODEL_DIR, 'code-learner.json')

const OUTCOME_PATHS = [
  { path: path.join(os.homedir(), 'brain', 'data', 'ml-outcomes.json'), agent: 'claude-brain',  fmt: 'json'  },
  { path: path.join(ROOT, 'memory', 'codex-brain', 'outcomes.jsonl'),    agent: 'codex-brain',  fmt: 'jsonl' },
  { path: path.join(ROOT, 'memory', 'ollama', 'outcomes.jsonl'),          agent: 'kilo-code',    fmt: 'jsonl' },
  { path: path.join(os.homedir(), '.kilo', 'outcomes.jsonl'),             agent: 'kilo-code',    fmt: 'jsonl' },
  { path: path.join(os.homedir(), 'brain', 'data', 'kilo-outcomes.json'), agent: 'kilo-code',    fmt: 'json'  },
]

const log  = (...a) => console.log(...a)
const ok   = (...a) => console.log('  ✅', ...a)
const warn = (...a) => console.warn('  ⚠️', ...a)
const info = (...a) => console.log('  ℹ️', ...a)
const head = (t)    => console.log(`\n${'─'.repeat(50)}\n  ${t}\n${'─'.repeat(50)}`)

;(async () => {

  log('\n🧠 SuperRoo ML Full Bidirectional Sync')
  log(`   VPS: ${VPS}`)

  // ── 1. Auth token ──────────────────────────────────────────────
  head('1 / 6  Getting auth token')

  let TOKEN = process.env.SUPERROO_VPS_TOKEN || process.env.SUPERROO_ML_API_TOKEN || ''

  if (!TOKEN) {
    info('Fetching token from VPS Docker container via SSH...')
    try {
      const raw = execSync(
        `ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=8 ` +
        `root@100.64.175.88 ` +
        `"docker inspect superroo2-superroo-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}'"`,
        { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      const line = raw.split('\n').find(l =>
        l.match(/^(SUPERROO_ML_API_TOKEN|ML_API_TOKEN|API_TOKEN|SUPERROO_VPS_TOKEN)=/i)
      )
      if (line) TOKEN = line.split('=').slice(1).join('=').trim()
    } catch (e) {
      warn('SSH auto-fetch failed: ' + e.message.split('\n')[0])
    }
  }

  if (!TOKEN) {
    warn('Token not found. Set it and retry:')
    log('    $env:SUPERROO_VPS_TOKEN = "your-token"')
    log('    node scripts/sync-ml-full.mjs')
    log('')
    log('  To find your token on the VPS:')
    log('    ssh root@100.64.175.88 "docker inspect superroo2-superroo-api-1 --format \'{{range .Config.Env}}{{println .}}{{end}}\'"')
    process.exit(1)
  }
  ok(`Token ready (${TOKEN.slice(0, 6)}…)`)

  // ── 2. VPS health ──────────────────────────────────────────────
  head('2 / 6  VPS health check')

  const health = await fetch(`${VPS}/health`, { signal: AbortSignal.timeout(5000) })
    .then(r => r.json()).catch(() => null)
  if (!health?.status) { warn('VPS unreachable — check Tailscale'); process.exit(1) }
  ok(`VPS online  (orchestrator: ${health.orchestrator?.mode || 'safe'})`)

  const syncStatus = await fetch(`${VPS}/ml/sync/status`, { signal: AbortSignal.timeout(5000) })
    .then(r => r.json()).catch(() => null)
  if (syncStatus?.totalModels !== undefined) {
    info(`VPS ML store: ${syncStatus.totalModels} models, ${syncStatus.totalObservations ?? '?'} observations`)
  }

  // ── 3. Train local model (optional fast retrain) ───────────────
  head('3 / 6  Local model')

  if (!fs.existsSync(MODEL_PATH)) {
    warn('No local model found — training now...')
    try {
      execSync(`node "${path.join(ROOT, 'scripts', 'train-central-ml.mjs')}"`,
        { stdio: 'inherit', timeout: 60000 })
    } catch (e) {
      warn('Training failed: ' + e.message.split('\n')[0])
    }
  }

  if (!fs.existsSync(MODEL_PATH)) {
    warn('Still no local model — skipping upload')
  } else {
    const local = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'))
    const samples = local.meta?.trainingSamples || 0
    ok(`Local model: ${samples} training samples, loss=${local.meta?.finalLoss?.toFixed(6) ?? 'n/a'}`)
    ok(`Architecture: ${local.meta?.architecture ?? 'unknown'}`)
  }

  // ── 4. Upload local model to VPS ───────────────────────────────
  head('4 / 6  Upload  local → VPS')

  if (fs.existsSync(MODEL_PATH)) {
    const local = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'))
    const samples = local.meta?.trainingSamples || 0

    if (samples < 5) {
      warn(`Only ${samples} training samples — need ≥5 to upload`)
    } else {
      // Convert neural-network ModelPersistence → VPS ModelSerializer format
      const allLayers = [
        ...(local.encoder             || []),
        ...(local.heads?.quality      || []),
        ...(local.heads?.success      || []),
        ...(local.heads?.bugRisk      || []),
      ]
      const payload = {
        schemaVersion: 1,
        modelType: 'neural-network',
        timestamp: new Date().toISOString(),
        source: 'local',
        agent: 'claude-code',
        featureDimensions: 8,
        trainingSamples: samples,
        architecture: {
          type: 'dense',
          description: local.meta?.architecture || '8→128→64 encoder + 3 heads',
          layers: allLayers.map((l, i) => ({ index: i, paramCount: l.length })),
        },
        parameters: {
          weights: allLayers,
          encoder: local.encoder,
          heads:   local.heads,
        },
        metadata: {
          finalLoss:    local.meta?.finalLoss,
          improvement:  local.meta?.improvement,
          sources:      local.meta?.sources,
          savedAt:      local.meta?.savedAt,
          serializedAt: new Date().toISOString(),
        },
      }

      // Also upload tagged as codex-brain (same model, shared)
      for (const agent of ['claude-code', 'codex-brain', 'kilo-code']) {
        try {
          const res = await fetch(`${VPS}/ml/model/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${TOKEN}`,
            },
            body: JSON.stringify({ ...payload, agent }),
            signal: AbortSignal.timeout(15000),
          }).then(r => r.json())

          if (res.success) ok(`Uploaded as agent=${agent}${res.modelId ? `  [${res.modelId.slice(0,8)}]` : ''}`)
          else warn(`Upload (${agent}): ${res.error || JSON.stringify(res)}`)
        } catch (e) {
          warn(`Upload (${agent}) error: ${e.message}`)
        }
      }
    }
  }

  // ── 5. Sync observations from all agents ───────────────────────
  head('5 / 6  Sync observations  all agents → VPS')

  const observations = []

  for (const { path: p, agent, fmt } of OUTCOME_PATHS) {
    if (!fs.existsSync(p)) continue
    try {
      const raw = fs.readFileSync(p, 'utf8')
      const items = fmt === 'jsonl'
        ? raw.split('\n').filter(Boolean).map(l => JSON.parse(l))
        : JSON.parse(raw)
      const arr = Array.isArray(items) ? items : []
      for (const o of arr) {
        observations.push({
          taskType:      o.tool_used || o.taskType || 'code',
          success:       o.success === 1 || o.success === true,
          durationMs:    o.durationMs || 0,
          featuresLocal: o.features || o.featuresLocal || [],
          source: agent,
          agent,
          sessionId: o.taskId || o.task_id || o.sessionId || `${agent}-${Date.now()}`,
        })
      }
      ok(`${agent}: ${arr.length} observations from ${path.basename(p)}`)
    } catch (e) {
      warn(`${path.basename(p)}: ${e.message.split('\n')[0]}`)
    }
  }

  if (observations.length > 0) {
    try {
      const res = await fetch(`${VPS}/ml/observations/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ observations }),
        signal: AbortSignal.timeout(15000),
      }).then(r => r.json())

      if (res.success) ok(`Synced ${observations.length} observations to VPS`)
      else warn('Obs sync: ' + (res.error || JSON.stringify(res)))
    } catch (e) {
      warn('Obs sync error: ' + e.message)
    }
  } else {
    info('No observation files found yet — will grow as record_outcome() is called')
  }

  // Trigger federated merge so VPS combines all uploaded models
  try {
    const merge = await fetch(`${VPS}/ml/model/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ minSamples: 1 }),
      signal: AbortSignal.timeout(30000),
    }).then(r => r.json())

    if (merge.success) ok(`Federated merge triggered${merge.trainingSamples ? `  → ${merge.trainingSamples} merged samples` : ''}`)
    else info('Merge response: ' + (merge.error || JSON.stringify(merge)))
  } catch (e) {
    warn('Merge: ' + e.message)
  }

  // ── 6. Download merged model back ─────────────────────────────
  head('6 / 6  Download  VPS → local')

  const localSamples = fs.existsSync(MODEL_PATH)
    ? (JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8')).meta?.trainingSamples || 0)
    : 0

  // Try neural-network first, fall back to any latest
  for (const qs of ['?type=neural-network', '']) {
    try {
      const r = await fetch(`${VPS}/ml/model/latest${qs}`, { signal: AbortSignal.timeout(10000) })
        .then(r => r.json())
      if (!r.success || !r.model) { info(`No model at /ml/model/latest${qs}`); continue }

      const m = r.model
      const vpsSamples = m.trainingSamples || 0
      info(`VPS model: ${vpsSamples} samples  type=${m.modelType}`)

      if (vpsSamples > localSamples && m.parameters?.encoder && m.parameters?.heads) {
        const merged = {
          version: 1,
          encoder: m.parameters.encoder,
          heads:   m.parameters.heads,
          meta: {
            ...m.metadata,
            trainingSamples: vpsSamples,
            source: 'vps-merged',
          },
        }
        fs.mkdirSync(MODEL_DIR, { recursive: true })
        fs.writeFileSync(MODEL_PATH, JSON.stringify(merged, null, 2), 'utf8')
        ok(`Downloaded merged model  (${vpsSamples} > local ${localSamples}) — weights updated`)
      } else if (vpsSamples <= localSamples) {
        info(`Local (${localSamples} samples) ≥ VPS (${vpsSamples}) — keeping local`)
      } else {
        info(`VPS model type ${m.modelType} is not neural-network — keeping local weights`)
      }
      break
    } catch (e) {
      warn('Download: ' + e.message)
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  log('\n' + '═'.repeat(55))
  log('✅  Bidirectional ML sync complete')
  log(`    Agents:  Claude Code  ·  Codex Brain  ·  Kilo Code`)
  log(`    VPS:     ${VPS}`)
  log('═'.repeat(55) + '\n')

})().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1) })
