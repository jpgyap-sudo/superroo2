/**
 * Migration Script: Migrate existing lessons from JSONL to pgvector
 *
 * This script reads lessons from memory/lesson-index.jsonl and memory/lessons-learned.md,
 * generates embeddings via Ollama (or OpenAI fallback), and stores them in Postgres/pgvector.
 *
 * Usage:
 *   node scripts/migrate-lessons-to-pgvector.mjs [--dry-run] [--batch-size 50]
 *
 * Options:
 *   --dry-run         Preview what would be migrated without writing
 *   --batch-size N    Process N lessons at a time (default: 50)
 *   --source jsonl    Only migrate from JSONL (default: both)
 *   --source md       Only migrate from markdown
 *   --force           Re-import even if already in pgvector (by id)
 *   --project NAME    Override project name (default: auto-detect from git remote)
 */

import fs from "fs"
import path from "path"
import { createInterface } from "readline"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")

// ── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  jsonlPath: path.join(REPO_ROOT, "memory/lesson-index.jsonl"),
  mdPath: path.join(REPO_ROOT, "memory/lessons-learned.md"),
  pgConnectionString:
    process.env.BRAIN_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://superroo:superroo@127.0.0.1:5432/superroo_brain",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  embeddingProvider: process.env.EMBEDDING_PROVIDER || "ollama",
  batchSize: 50,
  dryRun: false,
  source: "both", // 'jsonl' | 'md' | 'both'
  force: false,
  project: "",
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        CONFIG.dryRun = true
        break
      case "--batch-size":
        CONFIG.batchSize = parseInt(args[++i], 10) || 50
        break
      case "--source":
        CONFIG.source = args[++i] || "both"
        break
      case "--force":
        CONFIG.force = true
        break
      case "--project":
        CONFIG.project = args[++i] || ""
        break
      case "--help":
        console.log(`
Usage: node scripts/migrate-lessons-to-pgvector.mjs [options]

Options:
  --dry-run         Preview what would be migrated without writing
  --batch-size N    Process N lessons at a time (default: 50)
  --source jsonl    Only migrate from JSONL
  --source md       Only migrate from markdown
  --force           Re-import even if already in pgvector (by id)
  --project NAME    Override project name
  --help            Show this help
        `)
        process.exit(0)
    }
  }
}

// ── Embedding Service ──────────────────────────────────────────────────────

async function generateEmbedding(text) {
  const provider = CONFIG.embeddingProvider

  if (provider === "openai" && CONFIG.openAiApiKey) {
    return generateOpenAiEmbedding(text)
  }

  // Default: Ollama
  return generateOllamaEmbedding(text)
}

async function generateOllamaEmbedding(text) {
  // Try modern /api/embed endpoint first
  try {
    const res = await fetch(`${CONFIG.ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.ollamaModel,
        input: text,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.embeddings?.[0] || null
    }
  } catch {}

  // Fall back to legacy /api/embeddings endpoint
  try {
    const res = await fetch(`${CONFIG.ollamaBaseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.ollamaModel,
        prompt: text,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.embedding || null
    }
  } catch {}

  return null
}

async function generateOpenAiEmbedding(text) {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.data?.[0]?.embedding || null
    }
  } catch {}
  return null
}

// ── Lesson Loaders ─────────────────────────────────────────────────────────

function loadJsonlLessons() {
  if (!fs.existsSync(CONFIG.jsonlPath)) {
    console.log(`  ⚠ JSONL file not found: ${CONFIG.jsonlPath}`)
    return []
  }

  const content = fs.readFileSync(CONFIG.jsonlPath, "utf-8")
  const lines = content.split("\n").filter((l) => l.trim())

  return lines.map((line, i) => {
    try {
      const lesson = JSON.parse(line)
      return {
        id: lesson.id || `jsonl-${i + 1}`,
        title: lesson.title || "Untitled lesson",
        summary: lesson.lesson_summary || lesson.summary || "",
        content: [
          lesson.lesson_summary || "",
          lesson.rule_summary || "",
          JSON.stringify(lesson.relevance_factors || {}),
        ]
          .filter(Boolean)
          .join("\n\n"),
        memoryType: lesson.type === "bugfix" ? "bug" : lesson.type === "decision" ? "decision" : "lesson",
        tags: lesson.tags || [],
        files: lesson.files || [],
        agent: lesson.source || "migration",
        model: lesson.model || "unknown",
        importance: 0.5,
        confidence: lesson.confidence === "high" ? 0.9 : lesson.confidence === "medium" ? 0.7 : 0.4,
        createdAt: lesson.date ? new Date(lesson.date).toISOString() : new Date().toISOString(),
      }
    } catch {
      return null
    }
  }).filter(Boolean)
}

function loadMdLessons() {
  if (!fs.existsSync(CONFIG.mdPath)) {
    console.log(`  ⚠ Markdown file not found: ${CONFIG.mdPath}`)
    return []
  }

  const content = fs.readFileSync(CONFIG.mdPath, "utf-8")
  const lessons = []
  const blocks = content.split(/### Lesson:/)

  for (const block of blocks) {
    if (!block.trim()) continue

    const lines = block.split("\n")
    const title = lines[0]?.trim() || "Untitled lesson"

    const extract = (label) => {
      const line = lines.find((l) => l.trim().startsWith(label))
      return line ? line.split(":").slice(1).join(":").trim() : ""
    }

    const extractMultiline = (startLabel, endLabels) => {
      const startIdx = lines.findIndex((l) => l.trim().startsWith(startLabel))
      if (startIdx === -1) return ""
      const endIdx = lines.findIndex(
        (l, i) => i > startIdx && endLabels.some((el) => l.trim().startsWith(el))
      )
      const slice = lines.slice(startIdx + 1, endIdx > startIdx ? endIdx : undefined)
      return slice
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n")
    }

    const lesson = {
      id: `md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      summary: extract("Task Summary") || extract("Bug Cause") || title,
      content: block.trim(),
      memoryType: extract("Bug Cause") ? "bug" : "lesson",
      tags: (extract("Tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
      files: (extract("Related files") || "")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      agent: extract("Source") || "migration",
      model: (extract("Model/API used") || "unknown").trim(),
      importance: 0.5,
      confidence: extract("Confidence") === "high" ? 0.9 : extract("Confidence") === "medium" ? 0.7 : 0.4,
      createdAt: extract("Date") ? new Date(extract("Date")).toISOString() : new Date().toISOString(),
    }

    lessons.push(lesson)
  }

  return lessons
}

// ── Database ───────────────────────────────────────────────────────────────

async function connectDb() {
  const { default: pg } = await import("pg")
  const pool = new pg.default.Pool({
    connectionString: CONFIG.pgConnectionString,
    max: 5,
  })
  // Test connection
  await pool.query("SELECT 1")
  return pool
}

async function ensureSchema(pool) {
  const schemaPath = path.join(REPO_ROOT, "cloud/orchestrator/stores/brain/schema.sql")
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, "utf-8")
    await pool.query(schema)
    console.log("  ✓ Schema applied")
  }
}

async function lessonExists(pool, lessonId) {
  const result = await pool.query("SELECT id FROM agent_memory WHERE id = $1", [lessonId])
  return result.rows.length > 0
}

async function insertLesson(pool, lesson, embedding) {
  const embeddingStr = embedding ? `[${embedding.join(",")}]` : null

  await pool.query(
    `INSERT INTO agent_memory (id, project_id, agent, model, title, summary, content,
            embedding, embedding_model, embedding_dims, memory_type, status,
            importance, confidence, tags, files, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10, $11, 'approved',
             $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding,
       tags = EXCLUDED.tags,
       files = EXCLUDED.files,
       updated_at = NOW()`,
    [
      lesson.id,
      CONFIG.project || "superroo2",
      lesson.agent,
      lesson.model,
      lesson.title,
      lesson.summary,
      lesson.content,
      embeddingStr,
      CONFIG.embeddingProvider === "openai" ? "openai/text-embedding-3-small" : `ollama/${CONFIG.ollamaModel}`,
      embedding ? embedding.length : 0,
      lesson.memoryType,
      lesson.importance,
      lesson.confidence,
      lesson.tags,
      lesson.files,
      lesson.createdAt,
    ]
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  parseArgs()
  console.log("\n🧠 Central Brain v2 — Lesson Migration Script")
  console.log("═".repeat(50))
  console.log(`  Source JSONL: ${CONFIG.jsonlPath}`)
  console.log(`  Source MD:    ${CONFIG.mdPath}`)
  console.log(`  Database:     ${CONFIG.pgConnectionString.replace(/\/\/[^@]+@/, "//***@")}`)
  console.log(`  Embeddings:   ${CONFIG.embeddingProvider}`)
  console.log(`  Dry run:      ${CONFIG.dryRun}`)
  console.log(`  Force:        ${CONFIG.force}`)
  console.log(`  Batch size:   ${CONFIG.batchSize}`)
  console.log("")

  // 1. Load lessons
  let lessons = []
  if (CONFIG.source === "jsonl" || CONFIG.source === "both") {
    const jsonlLessons = loadJsonlLessons()
    lessons = lessons.concat(jsonlLessons)
    console.log(`  📄 JSONL lessons: ${jsonlLessons.length}`)
  }
  if (CONFIG.source === "md" || CONFIG.source === "both") {
    const mdLessons = loadMdLessons()
    lessons = lessons.concat(mdLessons)
    console.log(`  📝 Markdown lessons: ${mdLessons.length}`)
  }

  // Deduplicate by title+summary
  const seen = new Set()
  lessons = lessons.filter((l) => {
    const key = `${l.title}|${l.summary.slice(0, 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`  🎯 Total unique lessons to migrate: ${lessons.length}`)
  console.log("")

  if (lessons.length === 0) {
    console.log("  ✨ No lessons to migrate.")
    return
  }

  if (CONFIG.dryRun) {
    console.log("  📋 DRY RUN — Would migrate these lessons:")
    lessons.slice(0, 10).forEach((l, i) => {
      console.log(`    ${i + 1}. [${l.memoryType}] ${l.title} (${l.tags.join(", ") || "no tags"})`)
    })
    if (lessons.length > 10) {
      console.log(`    ... and ${lessons.length - 10} more`)
    }
    console.log("\n  ✅ Dry run complete. Pass --dry-run to actually migrate.")
    return
  }

  // 2. Connect to database
  console.log("  🔌 Connecting to Postgres...")
  let pool
  try {
    pool = await connectDb()
    console.log("  ✓ Connected")
  } catch (err) {
    console.error(`  ✗ Failed to connect: ${err.message}`)
    console.log("\n  💡 Make sure Postgres with pgvector is running:")
    console.log("     docker compose -f cloud/docker/docker-compose.yml up -d postgres")
    process.exit(1)
  }

  // 3. Ensure schema
  console.log("  📦 Ensuring schema...")
  try {
    await ensureSchema(pool)
  } catch (err) {
    console.error(`  ✗ Schema error: ${err.message}`)
    await pool.end()
    process.exit(1)
  }

  // 4. Migrate in batches
  let migrated = 0
  let skipped = 0
  let failed = 0
  const total = lessons.length

  for (let i = 0; i < total; i += CONFIG.batchSize) {
    const batch = lessons.slice(i, i + CONFIG.batchSize)
    const batchStart = i + 1
    const batchEnd = Math.min(i + CONFIG.batchSize, total)

    console.log(`\n  📦 Batch ${batchStart}-${batchEnd}/${total}...`)

    for (const lesson of batch) {
      // Check if already exists
      if (!CONFIG.force) {
        try {
          const exists = await lessonExists(pool, lesson.id)
          if (exists) {
            skipped++
            continue
          }
        } catch {
          // Continue if check fails
        }
      }

      // Generate embedding
      const textForEmbedding = `${lesson.title}\n\n${lesson.summary}\n\n${lesson.content}`.slice(0, 8000)
      let embedding = null
      try {
        embedding = await generateEmbedding(textForEmbedding)
      } catch {
        // Proceed without embedding
      }

      // Insert
      try {
        await insertLesson(pool, lesson, embedding)
        migrated++
        process.stdout.write(".")
      } catch (err) {
        failed++
        process.stdout.write("x")
      }
    }
  }

  console.log("\n")

  // 5. Summary
  console.log("═".repeat(50))
  console.log("  ✅ Migration complete!")
  console.log(`     Migrated: ${migrated}`)
  console.log(`     Skipped:  ${skipped}`)
  console.log(`     Failed:   ${failed}`)
  console.log(`     Total:    ${total}`)

  // 6. Create recall log entries for migrated lessons
  if (migrated > 0) {
    try {
      await pool.query(
        `INSERT INTO brain_events (id, project_id, event_type, actor, payload)
         VALUES ($1, $2, 'migration.completed', 'migration-script',
                 $3::jsonb)`,
        [
          `migration-${Date.now()}`,
          CONFIG.project || "superroo2",
          JSON.stringify({
            migrated,
            skipped,
            failed,
            total,
            source: CONFIG.source,
            embeddingProvider: CONFIG.embeddingProvider,
            timestamp: new Date().toISOString(),
          }),
        ]
      )
      console.log("  📝 Migration event logged")
    } catch {
      // Non-critical
    }
  }

  await pool.end()
  console.log("  🔌 Disconnected")
  console.log("")
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
