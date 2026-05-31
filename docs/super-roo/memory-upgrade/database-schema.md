# Database Schema (SQLite)

## Tables

### 1. summaries

Stores project summaries, session summaries, and architecture notes.

```sql
CREATE TABLE summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'project', 'session', 'architecture'
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    project_id TEXT, -- Optional: identifier for the project
    tags TEXT -- Comma-separated tags or JSON array
);
```

### 2. cache

Cached responses from Central Brain to reduce latency and token usage.

```sql
CREATE TABLE cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL, -- 'lesson', 'architecture', 'bug', 'feature'
    key TEXT NOT NULL, -- Unique key for the cached item
    value TEXT NOT NULL, -- JSON string of the cached data
    source TEXT NOT NULL, -- 'central_brain'
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP, -- Optional expiration
    hit_count INTEGER DEFAULT 0
);

CREATE INDEX idx_cache_category ON cache(category);
CREATE INDEX idx_cache_key ON cache(key);
```

### 3. temporary_lessons

Lessons learned during a session that await review and potential promotion to Central Brain.

```sql
CREATE TABLE temporary_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id TEXT UNIQUE, -- UUID or similar
    project TEXT NOT NULL,
    tags TEXT, -- Comma-separated tags
    category TEXT NOT NULL, -- architecture, bug, deployment, testing, security, performance, product, ui, database
    risk_level TEXT, -- low, medium, high
    confidence REAL, -- 0.0 to 1.0
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL, -- e.g., 'kilo', 'codex'
    summary TEXT NOT NULL,
    content TEXT NOT NULL, -- Full lesson details
    files_affected TEXT, -- JSON array of file paths
    promoted BOOLEAN DEFAULT FALSE, -- Whether promoted to Central Brain
    promoted_at TIMESTAMP
);

CREATE INDEX idx_temp_lessons_project ON temporary_lessons(project);
CREATE INDEX idx_temp_lessons_category ON temporary_lessons(category);
CREATE INDEX idx_temp_lessons_confidence ON temporary_lessons(confidence);
```

### 4. agent_state

Tracks active tasks, working context, and session-specific data.

```sql
CREATE TABLE agent_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name TEXT NOT NULL, -- 'kilo', 'codex', etc.
    session_id TEXT NOT NULL, -- Unique session identifier
    key TEXT NOT NULL, -- e.g., 'active_task', 'working_context'
    value TEXT NOT NULL, -- JSON string
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_state_session ON agent_state(session_id);
CREATE INDEX idx_agent_state_key ON agent_state(key);
```

### 5. file_relationships

Maps relationships between files in the project (e.g., imports, dependencies).

```sql
CREATE TABLE file_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source_file TEXT NOT NULL,
    target_file TEXT NOT NULL,
    relationship_type TEXT NOT NULL, -- 'import', 'dependency', 'similarity'
    strength REAL, -- 0.0 to 1.0 for similarity, 1.0 for definite relationships
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_file_relationships_project ON file_relationships(project_id);
CREATE INDEX idx_file_relationships_source ON file_relationships(source_file);
CREATE INDEX idx_file_relationships_target ON file_relationships(target_file);
```

### 6. config

Local brain configuration.

```sql
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```
