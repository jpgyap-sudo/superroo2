#!/usr/bin/env node
/**
 * train-central-ml.mjs — Central ML Training
 *
 * Trains a unified CodeLearner model from ALL outcome sources:
 *   1. Lessons (memory/lesson-index.jsonl) — 390+ free training samples
 *   2. Brain MCP outcomes (brain/data/ml-outcomes.json)
 *   3. Codex Brain outcomes (memory/codex-brain/outcomes.jsonl)
 *
 * Saves trained weights to:
 *   ~/.superroo/models/code-learner.json (ModelPersistence format)
 *
 * The ml-router.js in brain/src/ reads these weights for inference.
 * The sync-ml-to-vps.mjs script uploads them to the VPS for federated merge.
 *
 * Architecture (matches TypeScript CodeLearner exactly):
 *   Encoder:    Dense(8→128) → BatchNorm(128) → ReLU → Dense(128→64)
 *   bugRisk:    Dense(64→32) → ReLU → Dense(32→3) → Softmax
 *   quality:    Dense(64→32) → ReLU → Dense(32→1) → Sigmoid
 *   success:    Dense(64→32) → ReLU → Dense(32→2) → Softmax
 *
 * Usage:
 *   node scripts/train-central-ml.mjs              # train + save
 *   node scripts/train-central-ml.mjs --status     # show training data stats
 *   node scripts/train-central-ml.mjs --epochs 100 # custom epoch count
 *   node scripts/train-central-ml.mjs --dry-run    # show data without training
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const GLOBAL_DIR = path.join(homedir(), '.superroo', 'memory')

// Lesson sources — project-local + global fallback
const LESSON_INDEX        = path.join(ROOT, 'memory', 'lesson-index.jsonl')
const GLOBAL_LESSON_INDEX = path.join(GLOBAL_DIR, 'lesson-index.jsonl')

// Outcome sources — project-local + global kilo outcomes
const BRAIN_OUTCOMES    = path.join(homedir(), 'brain', 'data', 'ml-outcomes.json')
const CODEX_OUTCOMES    = path.join(ROOT, 'memory', 'codex-brain', 'outcomes.jsonl')
const KILO_OUTCOMES     = path.join(homedir(), '.kilo', 'outcomes.jsonl')
const BLACKBOX_OUTCOMES = path.join(homedir(), '.superroo', 'memory', 'blackbox-outcomes.jsonl')
const COPILOT_OUTCOMES  = path.join(homedir(), '.superroo', 'memory', 'copilot-outcomes.jsonl')

const MODEL_DIR      = process.env.SUPERROO_MODEL_DIR || path.join(homedir(), '.superroo', 'models')
const MODEL_PATH     = path.join(MODEL_DIR, 'code-learner.json')
const TRAIN_LOG_PATH = path.join(MODEL_DIR, 'train-log.json')

const args        = process.argv.slice(2)
const statusOnly  = args.includes('--status')
const dryRun      = args.includes('--dry-run')
const epochsArg   = args.find(a => a.startsWith('--epochs='))?.split('=')[1]
const EPOCHS      = epochsArg ? parseInt(epochsArg) : (args.includes('--epochs') ? parseInt(args[args.indexOf('--epochs') + 1]) : 50)
const LR          = 0.001
const BATCH_SIZE  = 16

const log  = (...a) => console.log(...a)
const info = (...a) => console.log(' ', ...a)

// ── Pure-JS Neural Net Primitives ─────────────────────────────────────────────

function randn(std = 0.1) { return (Math.random() * 2 - 1) * std }
function he(fanIn) { return randn(Math.sqrt(2 / fanIn)) }
function xavier(fanIn, fanOut) { return randn(Math.sqrt(6 / (fanIn + fanOut))) }

class Tensor {
  constructor(data, rows, cols) {
    if (rows && cols) {
      this._rows = rows; this._cols = cols
      this._data = data instanceof Float64Array ? data : new Float64Array(data)
    } else if (Array.isArray(data) && Array.isArray(data[0])) {
      this._rows = data.length; this._cols = data[0].length
      this._data = new Float64Array(this._rows * this._cols)
      for (let r = 0; r < this._rows; r++)
        for (let c = 0; c < this._cols; c++)
          this._data[r * this._cols + c] = data[r][c]
    } else {
      this._rows = (data || []).length; this._cols = 1
      this._data = new Float64Array(data || [])
    }
  }
  get rows() { return this._rows }
  get cols() { return this._cols }
  get(r, c = 0) { return this._data[r * this._cols + c] }
  set(r, c, v) { this._data[r * this._cols + c] = v }
  to1D() { return Array.from(this._data) }
  static from2D(arr) { return new Tensor(arr) }
  static zeros(r, c) {
    const t = new Tensor([], r, c || 1)
    t._data = new Float64Array(r * (c || 1)).fill(0)
    return t
  }
  clone() {
    const t = new Tensor(Array.from(this._data), this._rows, this._cols)
    return t
  }
  matmul(B) {
    const [M, K, N] = [this._rows, this._cols, B._cols]
    const out = new Float64Array(M * N)
    for (let i = 0; i < M; i++)
      for (let k = 0; k < K; k++) {
        const aik = this._data[i * K + k]
        for (let j = 0; j < N; j++)
          out[i * N + j] += aik * B._data[k * N + j]
      }
    return new Tensor(out, M, N)
  }
  map(fn) {
    const out = new Float64Array(this._data.length)
    for (let i = 0; i < out.length; i++) out[i] = fn(this._data[i])
    return new Tensor(out, this._rows, this._cols)
  }
  transpose() {
    const out = new Float64Array(this._rows * this._cols)
    for (let r = 0; r < this._rows; r++)
      for (let c = 0; c < this._cols; c++)
        out[c * this._rows + r] = this._data[r * this._cols + c]
    return new Tensor(out, this._cols, this._rows)
  }
}

class DenseLayer {
  constructor(inDim, outDim, init = 'he') {
    const std = init === 'he' ? Math.sqrt(2 / inDim) : Math.sqrt(6 / (inDim + outDim))
    const W = new Float64Array(inDim * outDim).map(() => randn(std))
    const b = new Float64Array(outDim).fill(0.01)
    this.W = new Tensor(W, inDim, outDim)
    this.b = new Tensor(b, 1, outDim)
    this.dW = Tensor.zeros(inDim, outDim)
    this.db = Tensor.zeros(1, outDim)
    this._input = null
    this.inDim = inDim; this.outDim = outDim
  }
  forward(x) {
    this._input = x
    const out = x.matmul(this.W)
    for (let r = 0; r < out._rows; r++)
      for (let c = 0; c < out._cols; c++)
        out._data[r * out._cols + c] += this.b._data[c]
    return out
  }
  backward(dOut) {
    const N = this._input._rows
    // dW = X^T @ dOut
    const dW = this._input.transpose().matmul(dOut)
    for (let i = 0; i < this.dW._data.length; i++) this.dW._data[i] = dW._data[i] / N
    // db = sum dOut over batch
    for (let c = 0; c < this.outDim; c++) {
      let s = 0
      for (let r = 0; r < N; r++) s += dOut._data[r * this.outDim + c]
      this.db._data[c] = s / N
    }
    return dOut.matmul(this.W.transpose())
  }
  parameters() {
    return [
      { tensor: this.W, grad: this.dW },
      { tensor: this.b, grad: this.db },
    ]
  }
  serialise() { return [this.W.to1D(), this.b.to1D()] }
  deserialise(data) {
    if (data[0]) this.W._data = new Float64Array(data[0])
    if (data[1]) this.b._data = new Float64Array(data[1])
  }
}

class BatchNormLayer {
  constructor(dim, eps = 1e-5, momentum = 0.1) {
    this.dim = dim; this.eps = eps; this.momentum = momentum
    this.gamma = new Tensor(new Float64Array(dim).fill(1), 1, dim)
    this.beta  = new Tensor(new Float64Array(dim).fill(0), 1, dim)
    this.runMean = new Float64Array(dim).fill(0)
    this.runVar  = new Float64Array(dim).fill(1)
    this.dGamma = Tensor.zeros(1, dim)
    this.dBeta  = Tensor.zeros(1, dim)
    this._training = true
    this._xNorm = null; this._xMu = null; this._xVar = null; this._input = null
  }
  setTraining(v) { this._training = v }
  forward(x) {
    const [N, D] = [x._rows, x._cols]
    if (!this._training) {
      const out = new Float64Array(N * D)
      for (let r = 0; r < N; r++)
        for (let c = 0; c < D; c++) {
          const i = r * D + c
          out[i] = this.gamma._data[c] * (x._data[i] - this.runMean[c]) / Math.sqrt(this.runVar[c] + this.eps) + this.beta._data[c]
        }
      return new Tensor(out, N, D)
    }
    const mu = new Float64Array(D)
    for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) mu[c] += x._data[r * D + c]
    for (let c = 0; c < D; c++) mu[c] /= N
    const variance = new Float64Array(D)
    for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) { const d = x._data[r * D + c] - mu[c]; variance[c] += d * d }
    for (let c = 0; c < D; c++) variance[c] /= N
    const invStd = variance.map(v => 1 / Math.sqrt(v + this.eps))
    const xNorm = new Float64Array(N * D)
    for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) xNorm[r * D + c] = (x._data[r * D + c] - mu[c]) * invStd[c]
    const out = new Float64Array(N * D)
    for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) out[r * D + c] = this.gamma._data[c] * xNorm[r * D + c] + this.beta._data[c]
    for (let c = 0; c < D; c++) {
      this.runMean[c] = (1 - this.momentum) * this.runMean[c] + this.momentum * mu[c]
      this.runVar[c]  = (1 - this.momentum) * this.runVar[c]  + this.momentum * variance[c]
    }
    this._xNorm = new Tensor(xNorm, N, D); this._xMu = mu; this._xVar = variance; this._input = x
    return new Tensor(out, N, D)
  }
  backward(dOut) {
    const [N, D] = [dOut._rows, dOut._cols]
    const xNorm = this._xNorm
    for (let c = 0; c < D; c++) {
      let dg = 0, db = 0
      for (let r = 0; r < N; r++) { dg += dOut._data[r * D + c] * xNorm._data[r * D + c]; db += dOut._data[r * D + c] }
      this.dGamma._data[c] = dg; this.dBeta._data[c] = db
    }
    const invStd = this._xVar.map(v => 1 / Math.sqrt(v + this.eps))
    const dxNorm = new Float64Array(N * D)
    for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) dxNorm[r * D + c] = dOut._data[r * D + c] * this.gamma._data[c]
    const dx = new Float64Array(N * D)
    for (let c = 0; c < D; c++) {
      let sum1 = 0, sum2 = 0
      for (let r = 0; r < N; r++) { sum1 += dxNorm[r * D + c]; sum2 += dxNorm[r * D + c] * xNorm._data[r * D + c] }
      for (let r = 0; r < N; r++)
        dx[r * D + c] = invStd[c] / N * (N * dxNorm[r * D + c] - sum1 - xNorm._data[r * D + c] * sum2)
    }
    return new Tensor(dx, N, D)
  }
  parameters() { return [{ tensor: this.gamma, grad: this.dGamma }, { tensor: this.beta, grad: this.dBeta }] }
  serialise() { return [Array.from(this.gamma._data), Array.from(this.beta._data), Array.from(this.runMean), Array.from(this.runVar)] }
  deserialise(data) {
    if (data[0]) this.gamma._data = new Float64Array(data[0])
    if (data[1]) this.beta._data  = new Float64Array(data[1])
    if (data[2]) this.runMean = new Float64Array(data[2])
    if (data[3]) this.runVar  = new Float64Array(data[3])
  }
}

class ReLULayer {
  forward(x) { this._input = x; return x.map(v => Math.max(0, v)) }
  backward(dOut) {
    const dx = new Float64Array(dOut._data.length)
    for (let i = 0; i < dx.length; i++) dx[i] = this._input._data[i] > 0 ? dOut._data[i] : 0
    return new Tensor(dx, dOut._rows, dOut._cols)
  }
  parameters() { return [] }
  serialise() { return [] }
  deserialise() {}
}

class SigmoidLayer {
  forward(x) { this._out = x.map(v => 1 / (1 + Math.exp(-v))); return this._out }
  backward(dOut) {
    const dx = new Float64Array(dOut._data.length)
    for (let i = 0; i < dx.length; i++) { const s = this._out._data[i]; dx[i] = dOut._data[i] * s * (1 - s) }
    return new Tensor(dx, dOut._rows, dOut._cols)
  }
  parameters() { return [] }
  serialise() { return [] }
  deserialise() {}
}

class SoftmaxLayer {
  forward(x) {
    const out = new Float64Array(x._data.length)
    for (let r = 0; r < x._rows; r++) {
      let max = -Infinity
      for (let c = 0; c < x._cols; c++) if (x._data[r * x._cols + c] > max) max = x._data[r * x._cols + c]
      let sum = 0
      for (let c = 0; c < x._cols; c++) { out[r * x._cols + c] = Math.exp(x._data[r * x._cols + c] - max); sum += out[r * x._cols + c] }
      for (let c = 0; c < x._cols; c++) out[r * x._cols + c] /= sum
    }
    this._out = new Tensor(out, x._rows, x._cols)
    return this._out
  }
  backward(dOut) {
    const dx = new Float64Array(dOut._data.length)
    for (let r = 0; r < dOut._rows; r++) {
      let dot = 0
      for (let c = 0; c < dOut._cols; c++) dot += this._out._data[r * dOut._cols + c] * dOut._data[r * dOut._cols + c]
      for (let c = 0; c < dOut._cols; c++) dx[r * dOut._cols + c] = this._out._data[r * dOut._cols + c] * (dOut._data[r * dOut._cols + c] - dot)
    }
    return new Tensor(dx, dOut._rows, dOut._cols)
  }
  parameters() { return [] }
  serialise() { return [] }
  deserialise() {}
}

class Adam {
  constructor(params, lr = 0.001) {
    this.params = params; this.lr = lr
    this.m = params.map(p => new Float64Array(p.tensor._data.length))
    this.v = params.map(p => new Float64Array(p.tensor._data.length))
    this.t = 0
  }
  zeroGrad() { for (const p of this.params) if (p.grad) p.grad._data.fill(0) }
  step() {
    const { lr, m, v } = this; this.t++
    const bc1 = 1 - Math.pow(0.9,  this.t)
    const bc2 = 1 - Math.pow(0.999, this.t)
    for (let i = 0; i < this.params.length; i++) {
      const { tensor, grad } = this.params[i]
      if (!grad) continue
      for (let j = 0; j < tensor._data.length; j++) {
        const g = grad._data[j]
        m[i][j] = 0.9 * m[i][j] + 0.1 * g
        v[i][j] = 0.999 * v[i][j] + 0.001 * g * g
        tensor._data[j] -= lr * (m[i][j] / bc1) / (Math.sqrt(v[i][j] / bc2) + 1e-8)
      }
    }
  }
}

function mse(pred, target) {
  const N = pred._data.length
  let loss = 0
  const grad = new Float64Array(N)
  for (let i = 0; i < N; i++) { const d = pred._data[i] - target._data[i]; loss += d * d; grad[i] = 2 * d / N }
  return { loss: loss / N, grad: new Tensor(grad, pred._rows, pred._cols) }
}

function crossEntropy(pred, target) {
  const [N, C] = [pred._rows, pred._cols]
  let loss = 0
  const grad = new Float64Array(pred._data.length)
  for (let r = 0; r < N; r++) for (let c = 0; c < C; c++) {
    const p = Math.max(pred._data[r * C + c], 1e-15)
    if (target._data[r * C + c] > 0) loss -= target._data[r * C + c] * Math.log(p)
    grad[r * C + c] = (p - target._data[r * C + c]) / N
  }
  return { loss: loss / N, grad: new Tensor(grad, N, C) }
}

// ── CodeLearner Architecture ──────────────────────────────────────────────────

function buildEncoder() {
  return [new DenseLayer(8, 128, 'he'), new BatchNormLayer(128), new ReLULayer(), new DenseLayer(128, 64, 'he')]
}
function buildHead(inDim, outDim, finalLayer) {
  return [new DenseLayer(inDim, 32, 'he'), new ReLULayer(), new DenseLayer(32, outDim, 'xavier'), finalLayer]
}

function forward(x, layers) { let h = x; for (const l of layers) h = l.forward(h); return h }
function backward(grad, layers) { let g = grad; for (let i = layers.length - 1; i >= 0; i--) g = layers[i].backward(g); return g }
function params(layers) { return layers.flatMap(l => l.parameters()) }

function setTraining(layers, mode) {
  for (const l of layers) if (l.setTraining) l.setTraining(mode)
}

function serialiseLayers(layers) {
  return layers.map(l => l.serialise())
}

function deserialiseLayers(layers, data) {
  for (let i = 0; i < layers.length; i++) if (data[i]) layers[i].deserialise(data[i])
}

// ── Feature Extraction ────────────────────────────────────────────────────────

function extractFeatures(text, contextStr = '') {
  const t = (text + ' ' + contextStr).toLowerCase()
  const fileCount  = (t.match(/\.(ts|tsx|js|jsx|mjs|py|go|rs|java|cs)\b/g) || []).length
  const complexKw  = ['refactor', 'architecture', 'migration', 'redesign', 'multi-file', 'integration', 'module', 'service', 'pipeline', 'system', 'implement']
  const criticalKw = ['production', 'critical', 'security', 'auth', 'payment', 'deploy', 'database', 'schema', 'race condition', 'memory leak']
  const simpleKw   = ['fix typo', 'rename', 'add comment', 'format', 'lint', 'small']
  const complexScore  = complexKw.filter(k => t.includes(k)).length
  const criticalScore = criticalKw.filter(k => t.includes(k)).length
  const simpleScore   = simpleKw.filter(k => t.includes(k)).length
  const lineCount  = text.split('\n').length
  const codeBlocks = (text.match(/```/g) || []).length / 2
  return [
    Math.min(fileCount / 10, 1),
    Math.min(lineCount / 300, 1),
    Math.min(complexScore / 5, 1),
    criticalScore > 0 ? 1 : 0,
    Math.min(text.length / 3000, 1),
    codeBlocks > 0 ? 1 : 0,
    fileCount > 2 ? 1 : 0,
    simpleScore > 0 ? 0 : 1,
  ]
}

// ── Data Collection ───────────────────────────────────────────────────────────

function confidenceToQuality(confidence) {
  if (confidence === 'high')   return 0.9
  if (confidence === 'medium') return 0.7
  return 0.5
}

function loadLessonSamples() {
  // Merge project-local + global lesson index (deduplicate by id)
  const seen = new Set()
  const allLines = []
  for (const src of [LESSON_INDEX, GLOBAL_LESSON_INDEX]) {
    if (!fs.existsSync(src)) continue
    for (const line of fs.readFileSync(src, 'utf8').split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); if (!seen.has(e.id)) { seen.add(e.id); allLines.push(line) } } catch {}
    }
  }
  if (allLines.length === 0) return []
  const lines = allLines
  const samples = []
  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      const text = [entry.title, entry.lesson_summary, entry.rule_summary].filter(Boolean).join(' ')
      const features = extractFeatures(text)
      const quality = confidenceToQuality(entry.confidence)
      samples.push({ features, success: 1, quality, bugRisk: 0, source: 'lesson' })
    } catch {}
  }

  // Inject synthetic failure samples to balance the dataset (lessons are 100% success-biased).
  // Generate ~15% failure rate by augmenting complex/critical features with failure labels.
  // This teaches the model what high-risk tasks look like before it sees real failure data.
  const failureRate = 0.15
  const numSynthetic = Math.floor(samples.length * failureRate)
  const syntheticsAdded = []

  for (let i = 0; i < numSynthetic; i++) {
    // Simulate a hard task that failed: high complexity, critical keywords, multi-file
    const noise = () => (Math.random() - 0.5) * 0.1
    syntheticsAdded.push({
      features: [
        0.4 + Math.random() * 0.6,   // many files
        0.5 + Math.random() * 0.5,   // many lines
        0.6 + Math.random() * 0.4,   // complex keywords
        Math.random() > 0.5 ? 1 : 0, // sometimes critical
        0.5 + Math.random() * 0.5,   // long prompt
        Math.random() > 0.3 ? 1 : 0, // usually has code context
        Math.random() > 0.4 ? 1 : 0, // often multi-file
        0.3 + Math.random() * 0.4,   // not entirely trivial
      ].map((v, idx) => Math.max(0, Math.min(1, v + noise()))),
      success: 0,
      quality:  0.2 + Math.random() * 0.3,
      bugRisk:  Math.random() > 0.5 ? 2 : 1,
      source: 'synthetic-failure',
    })
  }

  return [...samples, ...syntheticsAdded]
}

function outcomeToSample(o, label) {
  // Use pre-computed features if present, otherwise extract from prompt text
  const features = o.features?.length === 8
    ? o.features
    : extractFeatures(o.prompt || o.task || o.title || '')
  return {
    features,
    success: o.success  ?? 1,
    quality: o.quality  ?? (o.bug_risk != null ? 1 - o.bug_risk * 0.3 : 0.7),
    bugRisk: o.bugRisk  ?? o.bug_risk ?? 0,
    source:  label,
  }
}

function loadBrainOutcomes() {
  if (!fs.existsSync(BRAIN_OUTCOMES)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(BRAIN_OUTCOMES, 'utf8'))
    return raw.filter(o => o && (o.features?.length === 8 || o.prompt || o.task))
      .map(o => outcomeToSample(o, 'brain-mcp'))
  } catch { return [] }
}

function loadCodexOutcomes() {
  // Load from codex-brain outcomes + kilo outcomes (both JSONL, same format)
  const samples = []
  for (const [file, label] of [
    [CODEX_OUTCOMES,    'codex-brain'],
    [KILO_OUTCOMES,     'kilo-code'],
    [BLACKBOX_OUTCOMES, 'blackbox'],
    [COPILOT_OUTCOMES,  'copilot'],
  ]) {
    if (!fs.existsSync(file)) continue
    try {
      fs.readFileSync(file, 'utf8')
        .split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l) } catch { return null } })
        .filter(o => o && (o.features?.length === 8 || o.prompt || o.task))
        .forEach(o => samples.push(outcomeToSample(o, label)))
    } catch {}
  }
  return samples
}

// ── Training ──────────────────────────────────────────────────────────────────

function toBatch(samples, batchSize) {
  const batches = []
  for (let i = 0; i < samples.length; i += batchSize) {
    batches.push(samples.slice(i, i + batchSize))
  }
  return batches
}

function trainEpoch(encoder, qualityH, successH, bugRiskH, optimizer, samples) {
  const shuffled = [...samples].sort(() => Math.random() - 0.5)
  const batches = toBatch(shuffled, BATCH_SIZE)
  let totalLoss = 0

  for (const batch of batches) {
    const X = Tensor.from2D(batch.map(s => s.features))

    optimizer.zeroGrad()

    // Forward encoder
    const encoded = forward(X, encoder)

    let batchLoss = 0

    // ── quality head (regression) ──
    const qSamples = batch.filter(s => s.quality !== undefined)
    if (qSamples.length > 0) {
      const qIdx = qSamples.map(s => batch.indexOf(s))
      const qX = Tensor.from2D(qSamples.map(() => null).map((_, i) => Array.from(encoded._data).slice(qIdx[i] * 64, qIdx[i] * 64 + 64)))
      const qTarget = Tensor.from2D(qSamples.map(s => [s.quality]))
      const qPred = forward(qX, qualityH)
      const { loss: ql, grad: qg } = mse(qPred, qTarget)
      batchLoss += ql
      const qEncoderGrad = backward(backward(qg, qualityH), encoder)
      // accumulate encoder grad
      for (let i = 0; i < encoder.length; i++) {
        const ep = encoder[i].parameters()
        // grads already accumulated via backward
      }
    }

    // ── success head (classification) ──
    const sSamples = batch.filter(s => s.success !== undefined)
    if (sSamples.length > 0) {
      const sIdx = sSamples.map(s => batch.indexOf(s))
      const sX = Tensor.from2D(sSamples.map((_, i) => Array.from(encoded._data).slice(sIdx[i] * 64, sIdx[i] * 64 + 64)))
      const sTarget = Tensor.from2D(sSamples.map(s => s.success === 1 ? [0, 1] : [1, 0]))
      const sPred = forward(sX, successH)
      const { loss: sl, grad: sg } = crossEntropy(sPred, sTarget)
      batchLoss += sl
      backward(backward(sg, successH), encoder)
    }

    // ── bugRisk head (3-class) ──
    const bSamples = batch.filter(s => s.bugRisk !== undefined)
    if (bSamples.length > 0) {
      const bIdx = bSamples.map(s => batch.indexOf(s))
      const bX = Tensor.from2D(bSamples.map((_, i) => Array.from(encoded._data).slice(bIdx[i] * 64, bIdx[i] * 64 + 64)))
      const bTarget = Tensor.from2D(bSamples.map(s => { const v = [0,0,0]; v[s.bugRisk||0]=1; return v }))
      const bPred = forward(bX, bugRiskH)
      const { loss: bl, grad: bg } = crossEntropy(bPred, bTarget)
      batchLoss += bl
      backward(backward(bg, bugRiskH), encoder)
    }

    optimizer.step()
    totalLoss += batchLoss / batches.length
  }
  return totalLoss / batches.length
}

// ── Save / Load ───────────────────────────────────────────────────────────────

function saveModel(encoder, qualityH, successH, bugRiskH, meta) {
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  const weights = {
    version: 1,
    encoder:  serialiseLayers(encoder),
    heads: {
      quality:  serialiseLayers(qualityH),
      success:  serialiseLayers(successH),
      bugRisk:  serialiseLayers(bugRiskH),
    },
    meta: {
      ...meta,
      savedAt: new Date().toISOString(),
      architecture: '8→128→64 encoder, 3 heads (quality/success/bugRisk)',
    },
  }
  fs.writeFileSync(MODEL_PATH, JSON.stringify(weights, null, 2), 'utf8')
  return MODEL_PATH
}

function loadExistingModel(encoder, qualityH, successH, bugRiskH) {
  if (!fs.existsSync(MODEL_PATH)) return false
  try {
    const raw = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'))
    if (raw.encoder) deserialiseLayers(encoder, raw.encoder)
    if (raw.heads?.quality)  deserialiseLayers(qualityH,  raw.heads.quality)
    if (raw.heads?.success)  deserialiseLayers(successH,  raw.heads.success)
    if (raw.heads?.bugRisk)  deserialiseLayers(bugRiskH,   raw.heads.bugRisk)
    return true
  } catch { return false }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('🧠 Central ML Training — SuperRoo CodeLearner')
  log('')

  // Collect training data
  const lessonSamples = loadLessonSamples()
  const brainSamples  = loadBrainOutcomes()
  const codexSamples  = loadCodexOutcomes()
  const allSamples    = [...lessonSamples, ...brainSamples, ...codexSamples]

  log(`📊 Training Data Sources:`)
  info(`Lessons (project + global):    ${lessonSamples.length} samples`)
  info(`Brain MCP outcomes:            ${brainSamples.length} samples`)
  info(`Codex Brain + Kilo outcomes:   ${codexSamples.length} samples`)
  info(`Total:                         ${allSamples.length} samples`)
  log('')

  if (statusOnly || dryRun) {
    const bySource = {}
    for (const s of allSamples) bySource[s.source] = (bySource[s.source] || 0) + 1
    log(`Source breakdown: ${JSON.stringify(bySource, null, 2)}`)
    const successRate = (allSamples.filter(s => s.success === 1).length / allSamples.length * 100).toFixed(1)
    log(`Success rate in data: ${successRate}%`)
    log(`Model path: ${MODEL_PATH}`)
    log(`Existing weights: ${fs.existsSync(MODEL_PATH) ? '✅ found' : '❌ none'}`)
    return
  }

  if (allSamples.length < 5) {
    log('⚠️  Need at least 5 samples to train. Record more outcomes with record_outcome().')
    return
  }

  // Build model
  const encoder  = buildEncoder()
  const qualityH = buildHead(64, 1, new SigmoidLayer())
  const successH = buildHead(64, 2, new SoftmaxLayer())
  const bugRiskH = buildHead(64, 3, new SoftmaxLayer())

  // Load existing weights if available (continue training)
  const resumed = loadExistingModel(encoder, qualityH, successH, bugRiskH)
  if (resumed) info('Resumed from existing weights — continuing training')
  else info('Starting from random initialization')

  // Set training mode
  setTraining(encoder, true)
  setTraining(qualityH, true)
  setTraining(successH, true)
  setTraining(bugRiskH, true)

  const allParams = [...params(encoder), ...params(qualityH), ...params(successH), ...params(bugRiskH)]
  const optimizer = new Adam(allParams, LR)

  log(`Training ${EPOCHS} epochs on ${allSamples.length} samples (batch=${BATCH_SIZE}, lr=${LR})`)
  log('')

  const lossHistory = []
  for (let epoch = 0; epoch <= EPOCHS; epoch++) {
    const loss = trainEpoch(encoder, qualityH, successH, bugRiskH, optimizer, allSamples)
    lossHistory.push(loss)
    if (epoch % 10 === 0) {
      process.stdout.write(`  Epoch ${String(epoch).padStart(3)}/${EPOCHS}  loss=${loss.toFixed(4)}\n`)
    }
  }

  // Save
  setTraining(encoder, false)
  setTraining(qualityH, false)
  setTraining(successH, false)
  setTraining(bugRiskH, false)

  const finalLoss = lossHistory[lossHistory.length - 1]
  const trainMeta = {
    trainingSamples: allSamples.length,
    samples: allSamples.length,
    trained_at: new Date().toISOString(),
    epochs: EPOCHS,
    finalLoss: parseFloat(finalLoss.toFixed(6)),
    initialLoss: parseFloat(lossHistory[0].toFixed(6)),
    improvement: parseFloat(((lossHistory[0] - finalLoss) / lossHistory[0] * 100).toFixed(1)),
    sources: { lessons: lessonSamples.length, brainMcp: brainSamples.length, codex: codexSamples.length },
  }

  const saved = saveModel(encoder, qualityH, successH, bugRiskH, trainMeta)

  // ── Agent-Specific Model Variants ─────────────────────────────────────────
  // Fine-tune separate models per agent using their own outcomes (if any).
  // Shares the encoder weights (transfer learning) but specialises the heads.
  const agentOutcomeSources = {
    claude:    path.join(homedir(), '.superroo', 'memory', 'codex-brain', 'outcomes.jsonl'),
    'kilo-code': path.join(homedir(), '.kilo', 'outcomes.jsonl'),
    codex:     CODEX_OUTCOMES,
    blackbox:  BLACKBOX_OUTCOMES,
    copilot:   COPILOT_OUTCOMES,
  }
  for (const [agentName, outcomePath] of Object.entries(agentOutcomeSources)) {
    if (!fs.existsSync(outcomePath)) continue
    const agentOutcomes = fs.readFileSync(outcomePath, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(o => o && o.features?.length === 8)
      .map(o => ({ features: o.features, success: o.success??1, quality: o.quality??0.7, bugRisk: o.bugRisk??0, source: agentName }))
    if (agentOutcomes.length < 3) continue

    // Blend with global lesson samples (3:1 ratio global:agent-specific)
    const blended = [...lessonSamples.slice(-agentOutcomes.length*3), ...agentOutcomes]
      .sort(() => Math.random() - 0.5)
    log(`\n  Fine-tuning ${agentName} variant on ${agentOutcomes.length} agent outcomes + ${blended.length - agentOutcomes.length} global lessons`)

    // Copy global encoder + heads for fine-tuning (preserve transfer learning)
    const agentEncoder = JSON.parse(JSON.stringify(encoder))
    const agentQuality = JSON.parse(JSON.stringify(qualityH))
    const agentSuccess = JSON.parse(JSON.stringify(successH))
    const agentBugRisk = JSON.parse(JSON.stringify(bugRiskH))
    const agentOpt = newAdam(LR * 0.1)  // lower LR for fine-tuning
    setTraining(agentEncoder, true); setTraining(agentQuality, true)
    setTraining(agentSuccess, true); setTraining(agentBugRisk, true)

    for (let ep = 0; ep < 20; ep++) trainEpoch(agentEncoder, agentQuality, agentSuccess, agentBugRisk, agentOpt, blended)
    setTraining(agentEncoder, false); setTraining(agentQuality, false)
    setTraining(agentSuccess, false); setTraining(agentBugRisk, false)

    const agentModelPath = path.join(MODEL_DIR, `code-learner-${agentName}.json`)
    fs.writeFileSync(agentModelPath, JSON.stringify({
      version: 1,
      encoder: serialiseLayers(agentEncoder),
      heads: { quality: serialiseLayers(agentQuality), success: serialiseLayers(agentSuccess), bugRisk: serialiseLayers(agentBugRisk) },
      meta: { ...trainMeta, agent: agentName, agentOutcomes: agentOutcomes.length, savedAt: new Date().toISOString() },
    }, null, 2), 'utf8')
    info(`  ✅ Saved ${agentName} model → ${path.basename(agentModelPath)}`)
  }

  // Save training log
  const log2 = fs.existsSync(TRAIN_LOG_PATH) ? JSON.parse(fs.readFileSync(TRAIN_LOG_PATH, 'utf8')) : []
  log2.push({ ...trainMeta, trainedAt: new Date().toISOString() })
  if (log2.length > 20) log2.splice(0, log2.length - 20)
  fs.writeFileSync(TRAIN_LOG_PATH, JSON.stringify(log2, null, 2), 'utf8')

  log('')
  log('═'.repeat(50))
  log(`✅ Training complete`)
  log(`   Samples:     ${allSamples.length}`)
  log(`   Epochs:      ${EPOCHS}`)
  log(`   Loss:        ${lossHistory[0].toFixed(4)} → ${finalLoss.toFixed(4)} (${trainMeta.improvement}% improvement)`)
  log(`   Saved to:    ${saved}`)
  log('')
  log('Next steps:')
  log('  node scripts/sync-ml-to-vps.mjs       # upload to VPS for federated merge')
  log('  node scripts/sync-all-brains.mjs --awareness  # push status to all brains')
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
