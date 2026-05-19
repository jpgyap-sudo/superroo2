#!/usr/bin/env node
/**
 * Generate Ollama embeddings for memory_chunks entries that lack them.
 * Writes SQL to a file on the VPS and executes it there.
 *
 * Usage:
 *   node scripts/generate-pg-embeddings.cjs
 */

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const SSH_TARGET = "root@100.64.175.88"
const OLLAMA_URL = "http://127.0.0.1:11434"
const EMBEDDING_MODEL = "nomic-embed-text"

function ssh(command) {
  return execSync(`ssh ${SSH_TARGET} ${JSON.stringify(command)}`, {
    encoding: "utf-8",
    timeout: 60000,
  }).trim()
}

function main() {
  // Get entries without embeddings
  const raw = ssh(
    `docker exec superroo-postgres psql -U superroo -d superroo -t -A -F'|' -c "SELECT id, project_id, title, left(content, 500) FROM memory_chunks WHERE embedding IS NULL ORDER BY created_at"`
  )

  const lines = raw.split("\n").filter(Boolean)
  console.log(`Found ${lines.length} entries without embeddings\n`)

  const sqlStatements = []

  for (const line of lines) {
    const parts = line.split("|")
    const id = parts[0]
    const projectId = parts[1]
    const title = parts[2] || ""
    const content = parts.slice(3).join("|") || ""

    const text = `${title}\n${content}`.substring(0, 2000)
    process.stdout.write(`[${projectId}] ${id} -> generating embedding... `)

    // Generate embedding via Ollama on the VPS
    const embedResult = ssh(
      `curl -s ${OLLAMA_URL}/api/embeddings -d '{"model":"${EMBEDDING_MODEL}","prompt":${JSON.stringify(text)}}'`
    )

    try {
      const embedData = JSON.parse(embedResult)
      if (!embedData.embedding) {
        console.log(`FAILED: no embedding in response`)
        continue
      }

      const vectorStr = `[${embedData.embedding.join(",")}]`
      // Escape single quotes in the vector string (they shouldn't appear, but just in case)
      const escapedVector = vectorStr.replace(/'/g, "''")
      sqlStatements.push(
        `UPDATE memory_chunks SET embedding = '${escapedVector}'::vector WHERE id = '${id}';`
      )
      console.log(`OK (${embedData.embedding.length} dims)`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
  }

  if (sqlStatements.length === 0) {
    console.log("\nNo embeddings to update.")
    return
  }

  // Write SQL to a temp file
  const sqlContent = sqlStatements.join("\n")
  const tmpFile = path.join(os.tmpdir(), `pg-embeddings-${Date.now()}.sql`)
  fs.writeFileSync(tmpFile, sqlContent, "utf-8")
  console.log(`\nWrote ${sqlStatements.length} SQL statements to ${tmpFile}`)

  // SCP the SQL file to VPS
  console.log("Copying SQL file to VPS...")
  execSync(`scp -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "${tmpFile}" ${SSH_TARGET}:/tmp/pg-embeddings.sql`, {
    stdio: "inherit",
    timeout: 30000,
  })

  // Execute the SQL on the VPS
  console.log("Executing SQL on VPS...")
  execSync(
    `ssh ${SSH_TARGET} "docker exec -i superroo-postgres psql -U superroo -d superroo < /tmp/pg-embeddings.sql"`,
    { stdio: "inherit", timeout: 60000 }
  )

  // Clean up
  fs.unlinkSync(tmpFile)
  console.log("Cleaned up temp file")

  // Verify
  const remaining = ssh(
    `docker exec superroo-postgres psql -U superroo -d superroo -t -A -c "SELECT COUNT(*) FROM memory_chunks WHERE embedding IS NULL"`
  )
  console.log(`\nRemaining without embeddings: ${remaining.trim()}`)

  if (remaining.trim() === "0") {
    console.log("✅ All embeddings generated successfully!")
  }
}

main()
