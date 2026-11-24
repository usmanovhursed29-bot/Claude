-- Пользователи бота и их настройки.
CREATE TABLE IF NOT EXISTS users (
  chat_id INTEGER PRIMARY KEY,
  first_name TEXT,
  lang TEXT,
  lat REAL,
  lon REAL,
  tz TEXT,
  method TEXT NOT NULL DEFAULT 'mwl',
  madhab TEXT NOT NULL DEFAULT 'hanafi',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- Каждое действие пользователя: для статистики администратора.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_chat_ts ON events(chat_id, ts);

-- Счётчики зикров.
CREATE TABLE IF NOT EXISTS zikr (
  chat_id INTEGER NOT NULL,
  zikr TEXT NOT NULL,
  session INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, zikr)
);
