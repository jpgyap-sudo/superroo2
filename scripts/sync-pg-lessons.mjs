/**
 * Generate SQL to insert productgenerator lessons into PostgreSQL.
 * Usage: node scripts/sync-pg-lessons.mjs | ssh root@100.64.175.88 "docker exec -i superroo-postgres psql -U superroo -d superroo"
 */
import fs from "fs"
import path from "path"
import crypto from "crypto"

const jsonlPath = path.resolve("memory/lesson-index.jsonl")
const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean)

const pgLessons = []
for (const line of lines) {
  try {
    const obj = JSON.parse(line)
    if (obj.project === "productgenerator") {
      pgLessons.push(obj)
    }
  } catch {}
}

function confidenceToNumeric(conf) {
  if (typeof conf === "number") return conf
  if (typeof conf === "string") {
    const map = { high: 0.9, medium: 0.6, low: 0.3 }
    return map[conf.toLowerCase()] ?? 0.7
  }
  return 0.7
}

console.log(`-- Productgenerator lessons sync (${pgLessons.length} lessons)`)

for (const lesson of pgLessons) {
  // Generate a deterministic UUID from the string ID
  const id = crypto.createHash("md5").update(lesson.id || lesson.topic || Math.random().toString()).digest("hex")
  const uuid = `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20,32)}`
  const title = (lesson.topic || lesson.title || "Untitled").replace(/'/g, "''")
  const content = (lesson.content || lesson.summary || "").replace(/'/g, "''")
  const summary = (lesson.summary || "").replace(/'/g, "''")
  const tags = lesson.tags || []
  const importance = typeof lesson.importance === "number" ? lesson.importance : 5
  const confidence = confidenceToNumeric(lesson.confidence)
  const trustScore = typeof lesson.trust_score === "number" ? lesson.trust_score : 0.7

  console.log(`INSERT INTO memory_chunks (id, project_id, title, content, summary, tags, source_type, importance, confidence, trust_score)`)
  console.log(`VALUES (`)
  console.log(`  '${uuid}'::uuid,`)
  console.log(`  'productgenerator',`)
  console.log(`  '${title}',`)
  console.log(`  '${content}',`)
  console.log(`  '${summary}',`)
  console.log(`  ARRAY[${tags.map(t => `'${t.replace(/'/g, "''")}'`).join(", ")}],`)
  console.log(`  'lesson',`)
  console.log(`  ${importance},`)
  console.log(`  ${confidence},`)
  console.log(`  ${trustScore}`)
  console.log(`)`)
  console.log(`ON CONFLICT (id) DO UPDATE SET`)
  console.log(`  title = EXCLUDED.title,`)
  console.log(`  content = EXCLUDED.content,`)
  console.log(`  summary = EXCLUDED.summary,`)
  console.log(`  tags = EXCLUDED.tags,`)
  console.log(`  updated_at = NOW();`)
  console.log(``)
}
