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
--     Extended in v4 with hallucination tracking, cost, and latency
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
    hallucination_count INTEGER NOT NULL DEFAULT 0,  -- v4: track hallucination frequency
    avg_cost_usd    REAL,                              -- v4: average cost per task in USD
    avg_latency_ms  INTEGER,                           -- v4: average response latency
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
-- 8. brain_memory_versions — version history for every memory edit
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_memory_versions (
    id              TEXT PRIMARY KEY,
    memory_id       TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
    version_no      INTEGER NOT NULL,
    content         TEXT NOT NULL,
    summary         TEXT,
    content_delta   TEXT,                  -- delta/patch from previous version (optional, for storage efficiency)
    change_reason   TEXT NOT NULL DEFAULT 'update',
    created_by_agent TEXT NOT NULL DEFAULT 'system',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(memory_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_memory_versions_memory ON brain_memory_versions(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_versions_created ON brain_memory_versions(created_at DESC);
-- Composite index for efficient version history queries (ORDER BY version_no DESC)
CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_version
    ON brain_memory_versions(memory_id, version_no DESC);

-- ============================================================
-- 9. brain_memory_feedback — outcome-based feedback scoring
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_memory_feedback (
    id              TEXT PRIMARY KEY,
    memory_id       TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
    task_id         TEXT,
    agent_name      TEXT,
    outcome         TEXT NOT NULL DEFAULT 'neutral'
                        CHECK (outcome IN ('success','failure','neutral')),
    score           REAL NOT NULL DEFAULT 0,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory ON brain_memory_feedback(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_feedback_outcome ON brain_memory_feedback(outcome);

-- ============================================================
-- 10. brain_memory_usefulness — aggregated usefulness metrics per memory
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_memory_usefulness (
    memory_id       TEXT PRIMARY KEY REFERENCES agent_memory(id) ON DELETE CASCADE,
    usefulness      REAL NOT NULL DEFAULT 0.5
                        CHECK (usefulness >= 0 AND usefulness <= 1),
    total_feedback  INTEGER NOT NULL DEFAULT 0,
    success_count   INTEGER NOT NULL DEFAULT 0,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    last_feedback_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_usefulness_score ON brain_memory_usefulness(usefulness DESC);

-- ============================================================
-- 11. brain_consensus_decisions — audit trail for multi-agent
--     weighted consensus voting (v4)
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_consensus_decisions (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    decision_type   TEXT NOT NULL
                        CHECK (decision_type IN ('deploy','memory_approval','task_approval','model_selection','custom')),
    context_id      TEXT,                  -- ID of the thing being decided (deployment_id, memory_id, task_id)
    votes           JSONB NOT NULL DEFAULT '[]',  -- Array of {agent, model, decision, confidence, reason, riskFlags}
    score           REAL NOT NULL,         -- Normalized weighted score (-1 to 1)
    final_decision  TEXT NOT NULL
                        CHECK (final_decision IN ('approve','revise','needs_human','block')),
    risk_flags      TEXT[] DEFAULT '{}',   -- Risk flags raised during voting
    agent_count     INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT NOT NULL DEFAULT 'system',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consensus_decisions_project ON brain_consensus_decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_consensus_decisions_type ON brain_consensus_decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_consensus_decisions_final ON brain_consensus_decisions(final_decision);
CREATE INDEX IF NOT EXISTS idx_consensus_decisions_context ON brain_consensus_decisions(context_id);
CREATE INDEX IF NOT EXISTS idx_consensus_decisions_created ON brain_consensus_decisions(created_at DESC);

-- ============================================================
-- 12. brain_model_routing_logs — audit trail for every model
--     routing decision (v4)
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_model_routing_logs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    task_type       TEXT NOT NULL,
    task_id         TEXT,
    run_id          TEXT,
    agent           TEXT NOT NULL,
    model_selected  TEXT NOT NULL,
    fallback_chain  JSONB DEFAULT '[]',    -- Ordered list of {agent, model, estCost} tried
    attempt         INTEGER NOT NULL DEFAULT 1,
    success         BOOLEAN,
    duration_ms     INTEGER,
    cost_usd        REAL,
    hallucinated    BOOLEAN DEFAULT FALSE,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_logs_project ON brain_model_routing_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_routing_logs_task_type ON brain_model_routing_logs(task_type);
CREATE INDEX IF NOT EXISTS idx_routing_logs_agent ON brain_model_routing_logs(agent);
CREATE INDEX IF NOT EXISTS idx_routing_logs_model ON brain_model_routing_logs(model_selected);
CREATE INDEX IF NOT EXISTS idx_routing_logs_created ON brain_model_routing_logs(created_at DESC);

-- ============================================================
-- Schema version tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER NOT NULL,
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_version (version, description)
VALUES (3, 'Central Brain v3 — memory versioning, feedback scoring, auto-trust, usefulness metrics')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES (4, 'Central Brain v4 — multi-agent consensus voting, model routing audit trail, agent scorecard extensions')
ON CONFLICT DO NOTHING;
