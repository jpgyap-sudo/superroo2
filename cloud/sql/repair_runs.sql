-- SuperRoo repair_runs table
-- From the self-healing research gap (RepairAgent trajectory schema + VILA fingerprint escalation)
--
-- Run on Supabase:
--   psql $DATABASE_URL -f cloud/sql/repair_runs.sql
-- Or via Supabase dashboard SQL editor.

CREATE TABLE IF NOT EXISTS repair_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_at     timestamptz NOT NULL DEFAULT now(),
  incident_id      text,
  failure_signature text,                        -- SHA-256 fingerprint (16 hex chars)
  title            text,
  source           text,
  severity         text CHECK (severity IN ('low','medium','high','critical')),
  attempts_count   int NOT NULL DEFAULT 0,
  final_status     text CHECK (final_status IN ('fixed','escalated','failed','in_progress')),
  fix_applied      text,
  escalated_at     timestamptz,
  cycle_count      int NOT NULL DEFAULT 0,       -- trajectory length (SWE-agent health signal)
  metadata         jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS repair_runs_failure_signature_idx ON repair_runs (failure_signature);
CREATE INDEX IF NOT EXISTS repair_runs_triggered_at_idx     ON repair_runs (triggered_at DESC);
CREATE INDEX IF NOT EXISTS repair_runs_final_status_idx     ON repair_runs (final_status);

-- View: escalation rate per fingerprint (dashboard metric)
CREATE OR REPLACE VIEW repair_escalation_rate AS
SELECT
  failure_signature,
  title,
  COUNT(*)                                                         AS total_runs,
  COUNT(*) FILTER (WHERE final_status = 'escalated')              AS escalated_count,
  COUNT(*) FILTER (WHERE final_status = 'fixed')                  AS fixed_count,
  ROUND(
    COUNT(*) FILTER (WHERE final_status = 'escalated')::numeric /
    NULLIF(COUNT(*), 0) * 100, 1
  )                                                                AS escalation_rate_pct,
  AVG(cycle_count)                                                 AS avg_cycle_count,
  MAX(triggered_at)                                                AS last_seen
FROM repair_runs
GROUP BY failure_signature, title
ORDER BY escalated_count DESC, total_runs DESC;
