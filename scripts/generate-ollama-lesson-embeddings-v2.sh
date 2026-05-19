#!/bin/bash
# Generate Ollama embeddings for ollama_lessons entries missing them - v2
# Uses JSON output from psql to avoid delimiter issues
# Run on VPS: bash /tmp/generate-ollama-lesson-embeddings-v2.sh

set -e

DB_CONTAINER="d2081035b419"
OLLAMA_URL="http://127.0.0.1:11434"
EMBEDDING_MODEL="nomic-embed-text"

echo "=== Generating missing Ollama embeddings for ollama_lessons (v2) ==="

# Get entries without embeddings as JSON
docker exec -i "$DB_CONTAINER" psql -U superroo -d superroo -t -A \
  -c "SELECT json_agg(json_build_object('id', id::text, 'text', COALESCE(topic, '') || ' ' || COALESCE(content, ''))) FROM ollama_lessons WHERE embedding IS NULL;" \
  > /tmp/missing-embeddings.json 2>/dev/null

# Check if we got valid JSON
if ! jq -e '. | length > 0' /tmp/missing-embeddings.json > /dev/null 2>&1; then
  echo "No entries without embeddings found or empty result."
  cat /tmp/missing-embeddings.json
  rm -f /tmp/missing-embeddings.json
  exit 0
fi

TOTAL=$(jq length /tmp/missing-embeddings.json)
echo "Found $TOTAL entries without embeddings"

if [ "$TOTAL" -eq "0" ] || [ "$TOTAL" = "null" ]; then
  echo "All entries have embeddings. Nothing to do."
  rm -f /tmp/missing-embeddings.json
  exit 0
fi

# Process in batches
BATCH_SIZE=5
COUNT=0
SQL_FILE="/tmp/embedding-updates-v2.sql"
> "$SQL_FILE"

for row in $(jq -c '.[]' /tmp/missing-embeddings.json); do
  ID=$(echo "$row" | jq -r '.id')
  TEXT=$(echo "$row" | jq -r '.text')
  
  # Generate embedding via Ollama
  EMBEDDING=$(curl -s "$OLLAMA_URL/api/embeddings" \
    -d "{\"model\":\"$EMBEDDING_MODEL\",\"prompt\":$(echo "$TEXT" | jq -Rs .)}" \
    | jq -r '.embedding // empty' 2>/dev/null)
  
  if [ -n "$EMBEDDING" ] && [ "$EMBEDDING" != "null" ]; then
    # Format as pgvector string - use double brackets for single array
    VECTOR_STR="[$EMBEDDING]"
    echo "UPDATE ollama_lessons SET embedding = '$(echo "$VECTOR_STR" | sed "s/'/''/g")'::vector WHERE id = '$ID'::uuid;" >> "$SQL_FILE"
    COUNT=$((COUNT + 1))
    
    if [ $((COUNT % BATCH_SIZE)) -eq 0 ]; then
      echo "  Processed $COUNT/$TOTAL..."
    fi
  else
    echo "  WARNING: Failed to generate embedding for $ID"
  fi
done

echo "Generated $COUNT embeddings"

# Execute SQL updates in batches
if [ "$COUNT" -gt "0" ]; then
  echo "Executing SQL updates..."
  split -l 50 "$SQL_FILE" /tmp/embedding-batch-v2-
  for batch in /tmp/embedding-batch-v2-*; do
    echo "  Running batch: $batch"
    docker exec -i "$DB_CONTAINER" psql -U superroo -d superroo < "$batch" 2>&1 | grep -v "UPDATE 1" || true
    rm -f "$batch"
  done
fi

# Cleanup
rm -f /tmp/missing-embeddings.json "$SQL_FILE"

# Verify
REMAINING=$(docker exec -i "$DB_CONTAINER" psql -U superroo -d superroo -t -A \
  -c "SELECT COUNT(*) FROM ollama_lessons WHERE embedding IS NULL;")
echo "=== Done. Remaining without embeddings: $REMAINING ==="
