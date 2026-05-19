#!/bin/bash
# Generate Ollama embeddings for ollama_lessons entries missing them - v3
# Uses a Node.js script on the VPS to avoid shell quoting issues
# Run on VPS: bash /tmp/generate-ollama-lesson-embeddings-v3.sh

set -e

DB_CONTAINER="d2081035b419"
OLLAMA_URL="http://127.0.0.1:11434"
EMBEDDING_MODEL="nomic-embed-text"

echo "=== Generating missing Ollama embeddings for ollama_lessons (v3) ==="

# Write a Node.js script to do the work
cat > /tmp/generate-embeddings.mjs << 'NODESCRIPT'
import { execSync } from "child_process";
import fs from "fs";

const DB_CONTAINER = "d2081035b419";
const OLLAMA_URL = "http://127.0.0.1:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

function runPsql(query) {
  const result = execSync(
    `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo -t -A -c "${query.replace(/"/g, '\\"')}"`,
    { encoding: "utf-8", timeout: 30000 }
  );
  return result.trim();
}

// Get entries without embeddings
const rows = runPsql(
  "SELECT json_agg(json_build_object('id', id::text, 'text', COALESCE(topic, '') || ' ' || COALESCE(content, ''))) FROM ollama_lessons WHERE embedding IS NULL"
);

if (!rows || rows === "null" || rows === "") {
  console.log("No entries without embeddings found.");
  process.exit(0);
}

const entries = JSON.parse(rows);
console.log(`Found ${entries.length} entries without embeddings`);

if (entries.length === 0) {
  console.log("All entries have embeddings. Nothing to do.");
  process.exit(0);
}

let count = 0;
const sqlStatements = [];

for (const entry of entries) {
  const { id, text } = entry;
  
  try {
    const result = execSync(
      `curl -s ${OLLAMA_URL}/api/embeddings -d '{"model":"${EMBEDDING_MODEL}","prompt":${JSON.stringify(text)}}'`,
      { encoding: "utf-8", timeout: 60000 }
    );
    
    const parsed = JSON.parse(result);
    const embedding = parsed.embedding;
    
    if (embedding && Array.isArray(embedding)) {
      const vectorStr = `[${embedding.join(",")}]`;
      sqlStatements.push(
        `UPDATE ollama_lessons SET embedding = '${vectorStr}'::vector WHERE id = '${id}'::uuid;`
      );
      count++;
      
      if (count % 10 === 0) {
        console.log(`  Processed ${count}/${entries.length}...`);
      }
    } else {
      console.error(`  WARNING: No embedding returned for ${id}`);
    }
  } catch (err) {
    console.error(`  ERROR: Failed for ${id}: ${err.message}`);
  }
}

console.log(`Generated ${count} embeddings`);

// Execute SQL in batches
if (count > 0) {
  const BATCH_SIZE = 50;
  for (let i = 0; i < sqlStatements.length; i += BATCH_SIZE) {
    const batch = sqlStatements.slice(i, i + BATCH_SIZE).join("\n");
    const batchFile = `/tmp/embedding-batch-${Math.floor(i / BATCH_SIZE)}.sql`;
    fs.writeFileSync(batchFile, batch);
    console.log(`  Executing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(sqlStatements.length / BATCH_SIZE)}...`);
    execSync(
      `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo < ${batchFile}`,
      { encoding: "utf-8", timeout: 60000 }
    );
    fs.unlinkSync(batchFile);
  }
}

// Verify
const remaining = runPsql("SELECT COUNT(*) FROM ollama_lessons WHERE embedding IS NULL");
console.log(`=== Done. Remaining without embeddings: ${remaining} ===`);
NODESCRIPT

node /tmp/generate-embeddings.mjs
rm -f /tmp/generate-embeddings.mjs
