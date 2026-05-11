-- Cloud Orchestrator SQLite Schema
-- Stores task lifecycle, events, and module state

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  input TEXT NOT NULL,
  output TEXT,
  error TEXT,
  agent TEXT,
  session_id TEXT,
  parent_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  task_id TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  health TEXT NOT NULL DEFAULT 'healthy',
  version TEXT,
  owner TEXT,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_health_check_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_features_name ON features(name);
CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
CREATE INDEX IF NOT EXISTS idx_features_health ON features(health);

CREATE TABLE IF NOT EXISTS bugs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'medium',
  source TEXT,
  feature_id TEXT,
  stack_trace TEXT,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status);
CREATE INDEX IF NOT EXISTS idx_bugs_severity ON bugs(severity);
CREATE INDEX IF NOT EXISTS idx_bugs_feature ON bugs(feature_id);

CREATE TABLE IF NOT EXISTS bug_fixes (
  id TEXT PRIMARY KEY,
  bug_id TEXT NOT NULL,
  description TEXT NOT NULL,
  patch TEXT,
  applied_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  verified_at INTEGER,
  FOREIGN KEY (bug_id) REFERENCES bugs(id)
);

CREATE INDEX IF NOT EXISTS idx_bug_fixes_bug ON bug_fixes(bug_id);

CREATE TABLE IF NOT EXISTS healing_incidents (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  severity TEXT NOT NULL DEFAULT 'medium',
  source TEXT,
  task_id TEXT,
  metadata TEXT DEFAULT '{}',
  repair_plan TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  escalated_at INTEGER,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_healing_fingerprint ON healing_incidents(fingerprint);
CREATE INDEX IF NOT EXISTS idx_healing_status ON healing_incidents(status);
CREATE INDEX IF NOT EXISTS idx_healing_category ON healing_incidents(category);

CREATE TABLE IF NOT EXISTS healing_actions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  description TEXT,
  actor TEXT NOT NULL,
  result TEXT,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES healing_incidents(id)
);

CREATE INDEX IF NOT EXISTS idx_healing_actions_incident ON healing_actions(incident_id);

CREATE TABLE IF NOT EXISTS agent_bus_messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT,
  payload TEXT NOT NULL,
  reply_to TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bus_messages_recipient ON agent_bus_messages(recipient);
CREATE INDEX IF NOT EXISTS idx_bus_messages_type ON agent_bus_messages(type);
CREATE INDEX IF NOT EXISTS idx_bus_messages_status ON agent_bus_messages(status);

CREATE TABLE IF NOT EXISTS ml_observations (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  features TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ml_observations_type ON ml_observations(task_type);
CREATE INDEX IF NOT EXISTS idx_ml_observations_success ON ml_observations(success);

CREATE TABLE IF NOT EXISTS memory_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_store(category);
