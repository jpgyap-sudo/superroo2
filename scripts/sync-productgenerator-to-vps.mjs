/**
 * Sync productgenerator lessons to VPS PostgreSQL database and local files.
 * 
 * This script:
 * 1. Reads productgenerator lessons from local memory/lesson-index.jsonl
 * 2. Generates a SQL file and SCPs it to the VPS for execution
 * 3. Inserts them into the VPS PostgreSQL memory_chunks table
 * 4. Syncs lessons-learned.md to the VPS
 */
import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import crypto from "crypto"

const SSH_TARGET = "root@100.64.175.88"
const SSH_OPTS = "-o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3"

function ssh(command) {
  return execSync(`ssh ${SSH_OPTS} ${SSH_TARGET} ${JSON.stringify(command)}`, {
    encoding: "utf8",
    timeout: 30000,
  })
}

function scpTo(localPath, remotePath) {
  execSync(`scp ${SSH_OPTS} ${localPath} ${SSH_TARGET}:${remotePath}`, {
    encoding: "utf8",
    timeout: 30000,
  })
}

// 1. Read productgenerator lessons from local JSONL
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

console.log(`Found ${pgLessons.length} productgenerator lessons in local JSONL`)

// 2. Generate SQL file with proper escaping using dollar-quoting
const sqlLines = []
sqlLines.push("-- Productgenerator lessons sync")
sqlLines.push(`-- Generated: ${new Date().toISOString()}`)
sqlLines.push("")

for (const lesson of pgLessons) {
  const id = lesson.id || crypto.randomUUID()
  const title = lesson.topic || lesson.title || "Untitled"
  const content = lesson.content || lesson.summary || ""
  const summary = lesson.summary || ""
  const tags = lesson.tags || []
  const project = "productgenerator"
  const sourceType = "lesson"
  const importance = lesson.importance || 5
  const confidence = lesson.confidence ?? 0.7
  const trustScore = lesson.trust_score ?? 0.7

  // Use dollar-quoting ($$) to avoid escaping issues with single quotes
  // PostgreSQL dollar-quoting: $tag$content$tag$ where tag is optional
  sqlLines.push(`INSERT INTO memory_chunks (id, project_id, title, content, summary, tags, source_type, importance, confidence, trust_score)`)
  sqlLines.push(`VALUES (`)
  sqlLines.push(`  '${id}'::uuid,`)
  sqlLines.push(`  '${project}',`)
  sqlLines.push(`  $title$${title}$title$,`)
  sqlLines.push(`  $content$${content}$content$,`)
  sqlLines.push(`  $summary$${summary}$summary$,`)
  sqlLines.push(`  ARRAY[${tags.map(t => `$$tag$${t}$tag$`).join(", ")}],`)
  sqlLines.push(`  '${sourceType}',`)
  sqlLines.push(`  ${importance},`)
  sqlLines.push(`  ${confidence},`)
  sqlLines.push(`  ${trustScore}`)
  sqlLines.push(`)`)
  sqlLines.push(`ON CONFLICT (id) DO UPDATE SET`)
  sqlLines.push(`  title = EXCLUDED.title,`)
  sqlLines.push(`  content = EXCLUDED.content,`)
  sqlLines.push(`  summary = EXCLUDED.summary,`)
  sqlLines.push(`  tags = EXCLUDED.tags,`)
  sqlLines.push(`  updated_at = NOW();`)
  sqlLines.push("")
}

// 3. Write SQL file locally and SCP to VPS
const sqlContent = sqlLines.join("\n")
const localSqlPath = path.resolve("memory/_sync_productgenerator.sql")
fs.writeFileSync(localSqlPath, sqlContent, "utf8")
console.log(`Generated SQL file (${sqlLines.length} lines)`)

// SCP to VPS
const remoteSqlPath = "/tmp/sync_productgenerator.sql"
scpTo(localSqlPath, remoteSqlPath)
console.log("SCP'd SQL file to VPS")

// Execute on VPS
try {
  const result = ssh(`docker exec -i superroo-postgres psql -U superroo -d superroo -f ${remoteSqlPath}`)
  console.log("SQL execution result:")
  console.log(result)
} catch (err) {
  console.error(`SQL execution failed: ${err.message}`)
  console.error(err.stdout || "")
}

// Clean up remote SQL file
try {
  ssh(`rm -f ${remoteSqlPath}`)
} catch {}

// Clean up local SQL file
try {
  fs.unlinkSync(localSqlPath)
} catch {}

// 4. Verify
try {
  const result = ssh(`docker exec superroo-postgres psql -U superroo -d superroo -c "SELECT project_id, COUNT(*) FROM memory_chunks GROUP BY project_id ORDER BY project_id;"`)
  console.log(`\nVerification:\n${result.trim()}`)
} catch (err) {
  console.error(`Verification failed: ${err.message}`)
}

// 5. Sync lessons-learned.md to VPS
console.log("\nSyncing lessons-learned.md to VPS...")
try {
  scpTo(path.resolve("memory/lessons-learned.md"), "/opt/superroo2/memory/lessons-learned.md")
  console.log("  ✓ lessons-learned.md synced")
} catch (err) {
  console.error(`  ✗ Failed to sync lessons-learned.md: ${err.message}`)
}

// 6. Sync lesson-index.jsonl to VPS
console.log("Syncing lesson-index.jsonl to VPS...")
try {
  scpTo(path.resolve("memory/lesson-index.jsonl"), "/opt/superroo2/memory/lesson-index.jsonl")
  console.log("  ✓ lesson-index.jsonl synced")
} catch (err) {
  console.error(`  ✗ Failed to sync lesson-index.jsonl: ${err.message}`)
}

console.log("\nDone!")
