-- Migration: create_telegram_learner
-- Description: Initial schema for Telegram Learner SQLite database
-- Engine: sqlite

-- UP

CREATE TABLE IF NOT EXISTS learner_state (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id     TEXT,
	chat_id     TEXT,
	message     TEXT,
	intent      TEXT,
	response    TEXT,
	response_time_ms INTEGER,
	user_satisfied  INTEGER,
	created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_intent ON conversations(intent);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);

CREATE TABLE IF NOT EXISTS patterns (
	pattern_key TEXT PRIMARY KEY,
	intent      TEXT NOT NULL,
	keyword     TEXT NOT NULL,
	confidence  REAL NOT NULL DEFAULT 0.0,
	first_seen  TEXT NOT NULL,
	occurrences INTEGER NOT NULL DEFAULT 0,
	updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patterns_intent ON patterns(intent);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);

CREATE TABLE IF NOT EXISTS user_preferences (
	user_id     TEXT PRIMARY KEY,
	favorite_commands TEXT DEFAULT '[]',
	favorite_projects TEXT DEFAULT '[]',
	workflows   TEXT DEFAULT '[]',
	last_active TEXT,
	decayed     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS frustration_log (
	user_id          TEXT PRIMARY KEY,
	count            INTEGER DEFAULT 0,
	last_frustration TEXT,
	contexts         TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS response_quality (
	intent      TEXT PRIMARY KEY,
	scores      TEXT DEFAULT '[]',
	average     REAL DEFAULT 0.0,
	sample_size INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS intent_accuracy (
	intent   TEXT PRIMARY KEY,
	correct  INTEGER DEFAULT 0,
	total    INTEGER DEFAULT 0,
	accuracy REAL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS intent_counts (
	intent TEXT PRIMARY KEY,
	count  INTEGER DEFAULT 0
);

-- DOWN

DROP TABLE IF EXISTS intent_counts;
DROP TABLE IF EXISTS intent_accuracy;
DROP TABLE IF EXISTS response_quality;
DROP TABLE IF EXISTS frustration_log;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS patterns;
DROP INDEX IF EXISTS idx_conversations_created_at;
DROP INDEX IF EXISTS idx_conversations_user_id;
DROP INDEX IF EXISTS idx_conversations_intent;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS learner_state;
