#!/bin/bash
# Post-processing script for migrated lessons
# Run this after Ollama and Central Brain services are available

set -e

echo "════════════════════════════════════════════════════════════"
echo "SuperRoo Legacy Intelligence Post-Processing"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check if Ollama is available
echo "🔍 Checking Ollama..."
if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama is running"
    
    # Ensure required models are available
    echo "📦 Checking required models..."
    
    if ! curl -s http://127.0.0.1:11434/api/tags | grep -q "qwen2.5"; then
        echo "⬇️  Pulling qwen2.5:3b for summarization..."
        curl -X POST http://127.0.0.1:11434/api/pull -d '{"name": "qwen2.5:3b"}'
    fi
    
    if ! curl -s http://127.0.0.1:11434/api/tags | grep -q "nomic-embed"; then
        echo "⬇️  Pulling nomic-embed-text for embeddings..."
        curl -X POST http://127.0.0.1:11434/api/pull -d '{"name": "nomic-embed-text"}'
    fi
    
    # Run Ollama summarization
    echo ""
    echo "📝 Running Ollama summarization..."
    node scripts/ollama-summarize-lesson.mjs memory/lessons-learned.md
    node scripts/ollama-summarize-lesson.mjs memory/bugs-fixed.md
    node scripts/ollama-summarize-lesson.mjs memory/model-decisions.md
else
    echo "❌ Ollama not available at http://127.0.0.1:11434"
    echo "   Start Ollama with: ollama serve"
fi

# Check if Central Brain is available
echo ""
echo "🔍 Checking Central Brain..."
if curl -s http://127.0.0.1:3417/health > /dev/null 2>&1 || curl -s http://127.0.0.1:8787/api/health > /dev/null 2>&1; then
    echo "✅ Central Brain is reachable"
    
    # Run Central Brain storage
    echo ""
    echo "🧠 Storing lessons in Central Brain..."
    node scripts/central-brain-store-lesson.mjs memory/lessons-learned.md
    node scripts/central-brain-store-lesson.mjs memory/bugs-fixed.md
    node scripts/central-brain-store-lesson.mjs memory/model-decisions.md
else
    echo "❌ Central Brain not available"
    echo "   Brain Daemon: http://127.0.0.1:3417"
    echo "   API Server: http://127.0.0.1:8787"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "Post-processing complete!"
echo "════════════════════════════════════════════════════════════"
