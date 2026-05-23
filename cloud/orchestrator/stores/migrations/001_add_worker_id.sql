-- ============================================================
-- Migration 001: Add worker_id column to tasks table
--
-- Enables atomic task claim via UPDATE ... RETURNING *,
-- replacing the two-statement SELECT-then-UPDATE race condition.
-- ============================================================

ALTER TABLE tasks ADD COLUMN worker_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(worker_id);
