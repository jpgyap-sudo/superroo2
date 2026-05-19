#!/usr/bin/env node
/**
 * Fix remaining ollama_lessons entries without embeddings.
 * Uses Node.js fetch() to call Ollama API directly (no shell quoting issues).
 * Run on VPS: node /tmp/fix-remaining-embeddings-v2.mjs
 */
import { execSync } from "child_process";
import fs from "fs";

const DB_CONTAINER = "d2081035b419";
const OLLAMA_URL = "http://127.0.0.1:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

function runPsql(query) {
  return execSync(
    `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo -t -A -c "${query}"`,
    { encoding: "utf-8", timeout: 30000 }
  ).trim();
}

async function getEmbedding(text) {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.embedding;
}

async function main() {
  // Get entries without embeddings as JSON
  const jsonResult = runPsql(
    `SELECT json_agg(json_build_object('id', id::text, 'text', COALESCE(topic, '') || ' ' || COALESCE(content, ''))) FROM ollama_lessons WHERE embedding IS NULL`
  );

  if (!jsonResult || jsonResult === "null" || jsonResult === "") {
    console.log("No entries without embeddings found.");
    return;
  }

  const entries = JSON.parse(jsonResult);
  console.log(`Found ${entries.length} entries without embeddings`);

  if (entries.length === 0) {
    console.log("All entries have embeddings. Nothing to do.");
    return;
  }

  let count = 0;
  const sqlStatements = [];

  for (const entry of entries) {
    const { id, text } = entry;
    process.stdout.write(`Processing ${id.slice(0, 8)}... `);

    try {
      const embedding = await getEmbedding(text);
      if (embedding && Array.isArray(embedding)) {
        const vectorStr = `[${embedding.join(",")}]`;
        sqlStatements.push(
          `UPDATE ollama_lessons SET embedding = '${vectorStr}'::vector WHERE id = '${id}'::uuid;`
        );
        count++;
        console.log("✅");
      } else {
        console.log("❌ No embedding returned");
      }
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(`\nGenerated ${count} embeddings`);

  // Execute SQL in batches
  if (count > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < sqlStatements.length; i += BATCH_SIZE) {
      const batch = sqlStatements.slice(i, i + BATCH_SIZE).join("\n");
      const batchFile = `/tmp/embed-batch-final-${Math.floor(i / BATCH_SIZE)}.sql`;
      fs.writeFileSync(batchFile, batch);
      console.log(`Executing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);
      execSync(
        `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo < ${batchFile}`,
        { encoding: "utf-8", timeout: 60000 }
      );
      fs.unlinkSync(batchFile);
    }
  }

  // Verify
  const remaining = runPsql("SELECT COUNT(*) FROM ollama_lessons WHERE embedding IS NULL");
  console.log(`\n=== Done. Remaining without embeddings: ${remaining} ===`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
