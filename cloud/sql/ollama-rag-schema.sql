-- SuperRoo Ollama RAG Learning Loop — Database Schema
-- Run: docker exec -i superroo-postgres psql -U superroo -d superroo < cloud/sql/ollama-rag-schema.sql

-- ── Bug Knowledge Base ─────────────────────────────────────────────────────────
-- Stores every bug fix from DeepSeek/OpenAI with embeddings for RAG retrieval

CREATE TABLE IF NOT EXISTS bug_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id TEXT NOT NULL UNIQUE,
    agent_type TEXT NOT NULL,           -- 'deepseek', 'openai', 'ollama', 'anthropic'
    error_type TEXT,                    -- 'syntax', 'logic', 'api', 'test', 'runtime', 'config', 'unknown'
    error_summary TEXT NOT NULL,        -- brief description of the bug
    instruction TEXT NOT NULL,          -- original user instruction
    prompt TEXT,                        -- the LLM prompt that fixed it
    diff TEXT,                          -- git diff of the fix
    logs TEXT,                          -- relevant logs/output
    result TEXT NOT NULL,               -- final result / fix description
    files_changed TEXT[],               -- array of file paths
    test_commands TEXT[],               -- commands used to verify
    test_passed BOOLEAN DEFAULT NULL,   -- NULL=unknown, TRUE=pass, FALSE=fail
    embedding vector(768),              -- nomic-embed-text: 768 dims
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_bug_knowledge_embedding
    ON bug_knowledge USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

CREATE INDEX IF NOT EXISTS idx_bug_knowledge_error_type ON bug_knowledge(error_type);
CREATE INDEX IF NOT EXISTS idx_bug_knowledge_task_id ON bug_knowledge(task_id);
CREATE INDEX IF NOT EXISTS idx_bug_knowledge_created_at ON bug_knowledge(created_at DESC);

-- ── Ollama Lessons ────────────────────────────────────────────────────────────
-- Stores extracted patterns, best practices, and reusable knowledge

CREATE TABLE IF NOT EXISTS ollama_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_type TEXT NOT NULL,          -- 'pattern', 'fix', 'best_practice', 'anti_pattern'
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    source_task_id TEXT,
    project TEXT DEFAULT 'superroo2',   -- project name for cross-project learning
    embedding vector(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ollama_lessons_embedding
    ON ollama_lessons USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

CREATE INDEX IF NOT EXISTS idx_ollama_lessons_type ON ollama_lessons(lesson_type);
CREATE INDEX IF NOT EXISTS idx_ollama_lessons_project ON ollama_lessons(project);

-- ── Vector Search Functions ───────────────────────────────────────────────────

-- Search bug knowledge by vector similarity
CREATE OR REPLACE FUNCTION match_bug_knowledge(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.6,
    match_count int DEFAULT 5
)
RETURNS TABLE(
    id UUID,
    error_type TEXT,
    error_summary TEXT,
    result TEXT,
    diff TEXT,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        bug_knowledge.id,
        bug_knowledge.error_type,
        bug_knowledge.error_summary,
        bug_knowledge.result,
        bug_knowledge.diff,
        1 - (bug_knowledge.embedding <=> query_embedding) AS similarity
    FROM bug_knowledge
    WHERE 1 - (bug_knowledge.embedding <=> query_embedding) > match_threshold
    ORDER BY bug_knowledge.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Search lessons by vector similarity
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

-- Hybrid search: vector + keyword
CREATE OR REPLACE FUNCTION hybrid_search_bug_knowledge(
    query_embedding vector(768),
    query_text text,
    match_count int DEFAULT 5,
    vector_weight float DEFAULT 0.6
)
RETURNS TABLE(
    id UUID,
    error_type TEXT,
    error_summary TEXT,
    result TEXT,
    diff TEXT,
    score float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        bk.id,
        bk.error_type,
        bk.error_summary,
        bk.result,
        bk.diff,
        (vector_weight * (1 - (bk.embedding <=> query_embedding)) +
         (1 - vector_weight) * ts_rank(to_tsvector('english', coalesce(bk.error_summary, '') || ' ' || coalesce(bk.result, '')), plainto_tsquery('english', query_text)))
        AS score
    FROM bug_knowledge bk
    WHERE
        (1 - (bk.embedding <=> query_embedding)) > 0.4
        OR to_tsvector('english', coalesce(bk.error_summary, '') || ' ' || coalesce(bk.result, '')) @@ plainto_tsquery('english', query_text)
    ORDER BY score DESC
    LIMIT match_count;
END;
$$;

-- ── Stats View ────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW bug_knowledge_stats AS
SELECT
    COUNT(*) AS total_entries,
    COUNT(DISTINCT error_type) AS error_types,
    COUNT(DISTINCT agent_type) AS agent_types,
    COUNT(*) FILTER (WHERE test_passed = TRUE) AS tests_passed,
    COUNT(*) FILTER (WHERE test_passed = FALSE) AS tests_failed,
    COUNT(*) FILTER (WHERE test_passed IS NULL) AS untested,
    MAX(created_at) AS latest_entry
FROM bug_knowledge;
