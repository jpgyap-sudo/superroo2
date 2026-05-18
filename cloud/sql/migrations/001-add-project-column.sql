-- Migration 001: Add project column to ollama_lessons
-- Run: docker exec -i superroo-postgres psql -U superroo -d superroo < cloud/sql/migrations/001-add-project-column.sql

-- Add project column with default 'superroo2' for backward compatibility
ALTER TABLE ollama_lessons
ADD COLUMN IF NOT EXISTS project TEXT DEFAULT 'superroo2';

-- Create index for project-based queries
CREATE INDEX IF NOT EXISTS idx_ollama_lessons_project ON ollama_lessons(project);

-- Update the match function to include project in results
CREATE OR REPLACE FUNCTION match_ollama_lessons(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.6,
    match_count int DEFAULT 5
)
RETURNS TABLE(
    id UUID,
    lesson_type TEXT,
    topic TEXT,
    content TEXT,
    project TEXT,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ollama_lessons.id,
        ollama_lessons.lesson_type,
        ollama_lessons.topic,
        ollama_lessons.content,
        ollama_lessons.project,
        1 - (ollama_lessons.embedding <=> query_embedding) AS similarity
    FROM ollama_lessons
    WHERE 1 - (ollama_lessons.embedding <=> query_embedding) > match_threshold
    ORDER BY ollama_lessons.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
