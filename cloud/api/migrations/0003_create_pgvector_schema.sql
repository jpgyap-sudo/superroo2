-- Migration: create_pgvector_schema
-- Description: Initial pgvector schema for SuperRoo memory & code indexing
-- Engine: postgres

-- UP

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT,
  repo_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  source TEXT,
  status TEXT DEFAULT 'pending',
  active BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  agent_name TEXT NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  status TEXT DEFAULT 'running',
  input_summary TEXT,
  output_summary TEXT,
  cost_usd NUMERIC DEFAULT 0,
  latency_ms INT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_path TEXT,
  title TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  tags TEXT[] DEFAULT '{}',
  importance INT DEFAULT 3,
  confidence NUMERIC DEFAULT 0.8,
  trust_score NUMERIC DEFAULT 0.7,
  is_archived BOOLEAN DEFAULT false,
  is_deprecated BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw_idx
ON memory_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS memory_chunks_project_idx ON memory_chunks(project_id);
CREATE INDEX IF NOT EXISTS memory_chunks_source_type_idx ON memory_chunks(source_type);
CREATE INDEX IF NOT EXISTS memory_chunks_tags_idx ON memory_chunks USING gin(tags);
CREATE INDEX IF NOT EXISTS memory_chunks_metadata_idx ON memory_chunks USING gin(metadata);

CREATE TABLE IF NOT EXISTS code_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  symbol_name TEXT,
  symbol_type TEXT,
  language TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  metadata JSONB DEFAULT '{}',
  embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS code_chunks_embedding_hnsw_idx
ON code_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS code_chunks_project_file_idx ON code_chunks(project_id, file_path);

CREATE TABLE IF NOT EXISTS tool_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id),
  agent_run_id UUID REFERENCES agent_runs(id),
  tool_name TEXT NOT NULL,
  args JSONB DEFAULT '{}',
  result_summary TEXT,
  status TEXT DEFAULT 'pending',
  safety_level TEXT DEFAULT 'safe',
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id),
  command TEXT,
  status TEXT,
  output TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learned_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  procedure_md TEXT NOT NULL,
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  confidence NUMERIC DEFAULT 0.5,
  metadata JSONB DEFAULT '{}',
  embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learned_skills_embedding_hnsw_idx
ON learned_skills USING hnsw (embedding vector_cosine_ops);

-- DOWN

DROP INDEX IF EXISTS learned_skills_embedding_hnsw_idx;
DROP TABLE IF EXISTS learned_skills;
DROP TABLE IF EXISTS test_runs;
DROP TABLE IF EXISTS tool_invocations;
DROP INDEX IF EXISTS code_chunks_project_file_idx;
DROP INDEX IF EXISTS code_chunks_embedding_hnsw_idx;
DROP TABLE IF EXISTS code_chunks;
DROP INDEX IF EXISTS memory_chunks_metadata_idx;
DROP INDEX IF EXISTS memory_chunks_tags_idx;
DROP INDEX IF EXISTS memory_chunks_source_type_idx;
DROP INDEX IF EXISTS memory_chunks_project_idx;
DROP INDEX IF EXISTS memory_chunks_embedding_hnsw_idx;
DROP TABLE IF EXISTS memory_chunks;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
