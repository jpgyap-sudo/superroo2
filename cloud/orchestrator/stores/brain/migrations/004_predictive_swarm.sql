-- ============================================================
-- 13. brain_failure_patterns — historical failure signatures for
--     predictive risk assessment (Phase 3 Predictive Swarm)
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_failure_patterns (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    pattern_type    TEXT NOT NULL,
    signature       TEXT NOT NULL,           -- Keyword/signature to match against filesChanged + logs
    description     TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'medium'
                        CHECK (severity IN ('low','medium','high','critical')),
    suggested_fix   TEXT,
    occurrences     INTEGER NOT NULL DEFAULT 1,
    source          TEXT,                    -- 'self-healing', 'manual', 'swarm-debug', 'migration'
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failure_patterns_project ON brain_failure_patterns(project_id);
CREATE INDEX IF NOT EXISTS idx_failure_patterns_type ON brain_failure_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_failure_patterns_severity ON brain_failure_patterns(severity);
CREATE INDEX IF NOT EXISTS idx_failure_patterns_last_seen ON brain_failure_patterns(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_patterns_occurrences ON brain_failure_patterns(occurrences DESC);

-- ============================================================
-- 14. brain_risk_assessments — every risk assessment scored by
--     the PredictiveFailureEngine
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_risk_assessments (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    task_id         TEXT,
    action_type     TEXT NOT NULL
                        CHECK (action_type IN ('deploy','docker_build','db_migration','send_message','delete','large_refactor','config_change','restart')),
    risk_score      REAL NOT NULL,          -- 0.0 to 1.0
    risk_level      TEXT NOT NULL
                        CHECK (risk_level IN ('low','medium','high','critical')),
    reasons         JSONB NOT NULL DEFAULT '[]'::jsonb,
    matched_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of matched brain_failure_patterns
    swarm_run_id    TEXT,                    -- Linked swarm debug run if triggered
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_project ON brain_risk_assessments(project_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_level ON brain_risk_assessments(risk_level);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_action ON brain_risk_assessments(action_type);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created ON brain_risk_assessments(created_at DESC);

-- ============================================================
-- 15. brain_swarm_runs — parallel multi-agent debug sessions
--     triggered by high-risk assessments
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_swarm_runs (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT 'default',
    task_id         TEXT,
    risk_assessment_id TEXT,                 -- Linked brain_risk_assessments that triggered this run
    problem         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','completed','failed','cancelled')),
    agents          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of {name, focus}
    findings        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of {agent, focus, finding, confidence, suggestedFix}
    final_summary   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_swarm_runs_project ON brain_swarm_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_swarm_runs_status ON brain_swarm_runs(status);
CREATE INDEX IF NOT EXISTS idx_swarm_runs_created ON brain_swarm_runs(created_at DESC);

-- ============================================================
-- Schema version tracking
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES (5, 'Central Brain v5 — predictive failure engine, risk assessments, swarm debugging')
ON CONFLICT DO NOTHING;
