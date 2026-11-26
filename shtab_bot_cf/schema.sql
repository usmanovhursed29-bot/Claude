CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- ideas / launch / task
  input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / running / done / error
  result TEXT,
  log TEXT NOT NULL DEFAULT '[]',  -- JSON: [{agent, text}]
  chat_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
