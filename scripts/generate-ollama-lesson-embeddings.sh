#!/bin/bash
# Generate Ollama embeddings for ollama_lessons entries missing them
# Run on VPS: bash /tmp/generate-ollama-lesson-embeddings.sh

set -e

DB_CONTAINER="d2081035b419"
OLLAMA_URL="http://127.0.0.1:11434"
EMBEDDING_MODEL="nomic-embed-text"

echo "=== Generating missing Ollama embeddings for ollama_lessons ==="

# Get entries without embeddings
docker exec -i "$DB_CONTAINER" psql -U superroo -d superroo -t -A -F'|' \
  -c "SELECT id, COALESCE(topic, '') || ' ' || COALESCE(content, '') AS text FROM ollama_lessons WHERE embedding IS NULL;" \
  > /tmp/missing-embeddings.txt

TOTAL=$(wc -l < /tmp/missing-embeddings.txt)
echo "Found $TOTAL entries without embeddings"

if [ "$TOTAL" -eq "0" ]; then
  echo "All entries have embeddings. Nothing to do."
  rm -f /tmp/missing-embeddings.txt
  exit 0
fi

# Process in batches
BATCH_SIZE=10
COUNT=0
SQL_FILE="/tmp/embedding-updates.sql"
> "$SQL_FILE"

while IFS='|' read -r id text; do
  if [ -z "$id" ]; then continue; fi
  
  # Generate embedding via Ollama
  EMBEDDING=$(curl -s "$OLLAMA_URL/api/embeddings" \
    -d "{\"model\":\"$EMBEDDING_MODEL\",\"prompt\":$(echo "$text" | jq -Rs .)}" \
    | jq -r '.embedding // empty' 2>/dev/null)
  
  if [ -n "$EMBEDDING" ] && [ "$EMBEDDING" != "null" ]; then
    # Format as pgvector string
    VECTOR_STR="[$(echo "$EMBEDDING" | jq -c '.')]"
    echo "UPDATE ollama_lessons SET embedding = '$VECTOR_STR'::vector WHERE id = '$id';" >> "$SQL_FILE"
    COUNT=$((COUNT + 1))
    
    if [ $((COUNT % BATCH_SIZE)) -eq 0 ]; then
      echo "  Processed $COUNT/$TOTAL..."
    fi
  else
    echo "  WARNING: Failed to generate embedding for $id"
  fi
done < /tmp/missing-embeddings.txt

echo "Generated $COUNT embeddings"

# Execute SQL updates in batches
if [ "$COUNT" -gt "0" ]; then
  echo "Executing SQL updates..."
  split -l 50 "$SQL_FILE" /tmp/embedding-batch-
  for batch in /tmp/embedding-batch-*; do
    docker exec -i "$DB_CONTAINER" psql -U superroo -d superroo < "$batch"
    rm -f "$batch"
  done
fi

# Cleanup
rm -f /tmp/missing-embeddings.txt "$SQL_FILE"

# Verify
REMAINING=$(docker exec -i "$DB_CONTAINER" psql -U superroo -d superroo -t -A \
  -c "SELECT COUNT(*) FROM ollama_lessons WHERE embedding IS NULL;")
echo "=== Done. Remaining without embeddings: $REMAINING ==="
