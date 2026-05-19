#!/usr/bin/env node
/**
 * Fix remaining 5 ollama_lessons entries without embeddings.
 * Run on VPS: node /tmp/fix-remaining-embeddings.mjs
 */
import { execSync } from "child_process";
import fs from "fs";

const DB_CONTAINER = "d2081035b419";
const OLLAMA_URL = "http://127.0.0.1:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

function runPsql(query) {
  return execSync(
    `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo -t -A -c "${query}"`,
    { encoding: "utf-8", timeout: 30000, shell: "/bin/bash" }
  ).trim();
}

// Get entries without embeddings as JSON array
const jsonResult = execSync(
  `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo -t -A -c "SELECT json_agg(json_build_object('id', id::text, 'text', COALESCE(topic, '') || ' ' || COALESCE(content, ''))) FROM ollama_lessons WHERE embedding IS NULL;"`,
  { encoding: "utf-8", timeout: 30000, shell: "/bin/bash" }
).trim();

const entries = JSON.parse(jsonResult);
console.log(`Found ${entries.length} entries without embeddings`);

for (const entry of entries) {
  const { id, text } = entry;
  console.log(`Processing ${id}...`);
  
  // Write text to temp file to avoid shell quoting issues
  const textFile = `/tmp/embed-text-${id}.txt`;
  fs.writeFileSync(textFile, text, "utf-8");
  
  try {
    // Read text from file and pass to curl via stdin
    const result = execSync(
      `TEXT=$(cat ${textFile}) && curl -s ${OLLAMA_URL}/api/embeddings -d "{\\"model\\":\\"${EMBEDDING_MODEL}\\",\\"prompt\\":\\"$TEXT\\"}"`,
      { encoding: "utf-8", timeout: 60000, shell: "/bin/bash" }
    );
    
    const parsed = JSON.parse(result);
    const embedding = parsed.embedding;
    
    if (embedding && Array.isArray(embedding)) {
      const vectorStr = `[${embedding.join(",")}]`;
      const updateSql = `UPDATE ollama_lessons SET embedding = '${vectorStr}'::vector WHERE id = '${id}'::uuid;`;
      
      // Write SQL to temp file and execute
      const sqlFile = `/tmp/embed-update-${id}.sql`;
      fs.writeFileSync(sqlFile, updateSql, "utf-8");
      execSync(
        `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo < ${sqlFile}`,
        { encoding: "utf-8", timeout: 30000, shell: "/bin/bash" }
      );
      fs.unlinkSync(sqlFile);
      console.log(`  ✅ Embedding stored for ${id}`);
    } else {
      console.error(`  ❌ No embedding returned for ${id}`);
    }
  } catch (err) {
    console.error(`  ❌ Failed for ${id}: ${err.message}`);
  } finally {
    try { fs.unlinkSync(textFile); } catch {}
  }
}

// Verify
const remaining = runPsql("SELECT COUNT(*) FROM ollama_lessons WHERE embedding IS NULL");
console.log(`\n=== Done. Remaining without embeddings: ${remaining} ===`);
