-- Central Brain v2 — pgvector Schema
-- Adapted for Ollama nomic-embed-text (768 dims) with OpenAI fallback (1536 dims)
-- Uses flexible vector dimensions; Ollama is default

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. agent_tasks — tracks every task an agent is asked to do
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_tasks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    goal            TEXT NOT NULL,
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed','cancelled')),
    priority        INTEGER NOT NULL DEFAULT 0,
    tags            TEXT[] DEFAULT '{}',
    files           TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON agent_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent);

-- ============================================================
-- 2. agent_runs — each execution of a task by an agent
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_runs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','completed','failed','cancelled')),
    input_summary   TEXT,
    output_summary  TEXT,
    lesson_id       TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent);

-- ============================================================
-- 3. agent_memory — the core memory store with pgvector
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_memory (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    agent           TEXT NOT NULL DEFAULT 'unknown',
    model           TEXT,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    content         TEXT NOT NULL,
    embedding       vector(768),          -- Ollama nomic-embed-text default
    embedding_model TEXT DEFAULT 'ollama/nomic-embed-text',
    embedding_dims  INTEGER DEFAULT 768,
    memory_type     TEXT NOT NULL DEFAULT 'lesson'
                        CHECK (memory_type IN ('lesson','bug','pattern','decision','insight','reference')),
    status          TEXT NOT NULL DEFAULT 'approved'
                        CHECK (status IN ('candidate','approved','archived','rejected')),
    importance      REAL NOT NULL DEFAULT 0.5
                        CHECK (importance >= 0 AND importance <= 1),
    confidence      REAL NOT NULL DEFAULT 0.7
                        CHECK (confidence >= 0 AND confidence <= 1),
    tags            TEXT[] DEFAULT '{}',
    files           TEXT[] DEFAULT '{}',
    use_count       INTEGER NOT NULL DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    source_task_id  TEXT,
    source_run_id   TEXT,
    parent_id       TEXT,                 -- for merged/derived memories
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vector similarity index (cosine distance)
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding
    ON agent_memory
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_status ON agent_memory(status);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent);
CREATE INDEX IF NOT EXISTS idx_agent_memory_tags ON agent_memory USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_agent_memory_files ON agent_memory USING gin(files);
CREATE INDEX IF NOT EXISTS idx_agent_memory_importance ON agent_memory(importance DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_use_count ON agent_memory(use_count DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON agent_memory(created_at DESC);

-- Full-text search index for text fallback
CREATE INDEX IF NOT EXISTS idx_agent_memory_fts
    ON agent_memory
    USING gin(to_tsvector('english', title || ' ' || summary || ' ' || content));

-- ============================================================
-- 4. memory_recall_logs — audit trail for every memory recall
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_recall_logs (
    id              TEXT PRIMARY KEY,
    memory_id       TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL DEFAULT 'default',
    agent           TEXT NOT NULL,
    model           TEXT,
    task_id         TEXT,
    run_id          TEXT,
    similarity      REAL,
    latency_ms      INTEGER,
    recalled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recall_logs_memory ON memory_recall_logs(memory_id);
CREATE INDEX IF NOT EXISTS idx_recall_logs_project ON memory_recall_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_recall_logs_agent ON memory_recall_logs(agent);
CREATE INDEX IF NOT EXISTS idx_recall_logs_recalled ON memory_recall_logs(recalled_at DESC);

-- ============================================================
-- 5. agent_scores — tracks agent/model performance over time
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_scores (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    agent           TEXT NOT NULL,
    model           TEXT,
    task_type       TEXT,
    score           REAL NOT NULL DEFAULT 0,
    total_tasks     INTEGER NOT NULL DEFAULT 0,
    success_count   INTEGER NOT NULL DEFAULT 0,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    avg_duration_ms INTEGER,
    last_task_at    TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, agent, model, task_type)
);

CREATE INDEX IF NOT EXISTS idx_agent_scores_project ON agent_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_scores_agent ON agent_scores(agent);
CREATE INDEX IF NOT EXISTS idx_agent_scores_score ON agent_scores(score DESC);

-- ============================================================
-- 6. brain_events — event log for system-wide brain activity
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_events (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    event_type      TEXT NOT NULL,
    actor           TEXT NOT NULL DEFAULT 'system',
    payload         JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_events_project ON brain_events(project_id);
CREATE INDEX IF NOT EXISTS idx_brain_events_type ON brain_events(event_type);
CREATE INDEX IF NOT EXISTS idx_brain_events_actor ON brain_events(actor);
CREATE INDEX IF NOT EXISTS idx_brain_events_created ON brain_events(created_at DESC);

-- ============================================================
-- 7. memory_approval_queue — pending memories needing approval
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_approval_queue (
    id              TEXT PRIMARY KEY,
    memory_id       TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL DEFAULT 'default',
    requested_by    TEXT NOT NULL,
    reason          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON memory_approval_queue(status);
CREATE INDEX IF NOT EXISTS idx_approval_queue_memory ON memory_approval_queue(memory_id);

-- ============================================================
-- Schema version tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER NOT NULL,
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_version (version, description)
VALUES (2, 'Central Brain v2 — pgvector memory with Ollama embeddings')
ON CONFLICT DO NOTHING;
