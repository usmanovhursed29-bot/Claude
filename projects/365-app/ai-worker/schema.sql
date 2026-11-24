-- База Kwantoww (Cloudflare D1): пользователи, события для статистики, записи из чата.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,          -- Telegram user id
  first_name TEXT,
  username TEXT,
  lang TEXT,
  first_seen INTEGER NOT NULL,     -- мс с 1970
  last_seen INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,              -- start, message, app_open, advice_*, left, returned
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cmd TEXT NOT NULL,               -- команда приложения: steps_14000, water_200, exp_500_cafe ...
  ts INTEGER NOT NULL,             -- когда человек написал (мс)
  done INTEGER NOT NULL DEFAULT 0  -- 1 = приложение уже записало
);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON inbox(user_id, done);
CREATE INDEX IF NOT EXISTS idx_inbox_ts ON inbox(ts);
