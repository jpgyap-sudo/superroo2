#!/usr/bin/env node
/**
 * Ollama Model Warmup — loads all models into RAM for zero cold starts.
 * Run at the start of every Claude Code session.
 *
 * With 64GB RAM: all 5 models fit simultaneously (~26GB total).
 * After warmup, every call gets near-instant first-token response.
 *
 * Usage: node ops/ollama/warmup.mjs
 */

const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
const KEEP_ALIVE = "24h"

const MODELS = [
  { name: "hermes3",              role: "Researcher / Analyst / Memory Retriever" },
  { name: "qwen2.5-coder:7b",    role: "Fast coder (1-3s)" },
  { name: "qwen2.5-coder:14b",   role: "Heavy coder (3-8s)" },
  { name: "phi4",                 role: "Deep reasoning / architecture" },
  { name: "nomic-embed-text",     role: "Embeddings for RAG" },
]

async function warmModel(model) {
  const start = Date.now()
  try {
    // For embed model use /api/embed, for chat models use /api/chat
    const isEmbed = model.name.includes("nomic") || model.name.includes("embed")
    const endpoint = isEmbed ? `${OLLAMA}/api/embed` : `${OLLAMA}/api/chat`
    const body = isEmbed
      ? { model: model.name, input: "warmup", keep_alive: KEEP_ALIVE }
      : { model: model.name, stream: false, keep_alive: KEEP_ALIVE, messages: [{ role: "user", content: "ready" }] }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const ms = Date.now() - start
    if (res.ok) {
      console.log(`  ✅ ${model.name.padEnd(24)} ${ms}ms  — ${model.role}`)
      return { ok: true, model: model.name, ms }
    } else {
      console.log(`  ❌ ${model.name.padEnd(24)} HTTP ${res.status}`)
      return { ok: false, model: model.name }
    }
  } catch (err) {
    const ms = Date.now() - start
    console.log(`  ⚠️  ${model.name.padEnd(24)} ${err.message}`)
    return { ok: false, model: model.name, error: err.message }
  }
}

async function main() {
  console.log("🔥 Ollama Model Warmup")
  console.log(`   Host: ${OLLAMA}`)
  console.log(`   Keep-alive: ${KEEP_ALIVE}`)
  console.log("")

  // Check Ollama is up
  try {
    const res = await fetch(`${OLLAMA}/api/tags`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const loaded = data.models?.map(m => m.name) || []
    console.log(`Ollama running — ${loaded.length} models available`)
    if (loaded.length > 0) console.log(`  Available: ${loaded.join(", ")}`)
    console.log("")
  } catch (err) {
    console.error(`❌ Ollama not reachable at ${OLLAMA}: ${err.message}`)
    console.error(`   Start Ollama: open Ollama app or run 'ollama serve'`)
    process.exit(1)
  }

  console.log("Loading models into RAM...")
  const start = Date.now()

  // Load models in parallel for faster warmup
  const results = await Promise.all(MODELS.map(warmModel))

  const total = Date.now() - start
  const succeeded = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length

  console.log("")
  console.log("═".repeat(50))
  console.log(`✅ Warmup complete: ${succeeded}/${MODELS.length} models loaded (${total}ms total)`)
  if (failed > 0) console.log(`⚠️  ${failed} models failed — check 'ollama pull <model>'`)
  console.log("")
  console.log("All models are now in RAM with 24h keep-alive.")
  console.log("Expected response times:")
  console.log("  hermes3:           1-2s first token")
  console.log("  qwen2.5-coder:7b:  0.5-1s first token")
  console.log("  qwen2.5-coder:14b: 1-3s first token")
  console.log("  nomic-embed-text:  ~50ms per embed")
  console.log("")
  console.log("brain_status() in Claude to verify all tools ready.")
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
