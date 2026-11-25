-- База Kwantoww (Cloudflare D1): пользователи, события для статистики, записи из чата.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,          -- Telegram user id
  first_name TEXT,
  username TEXT,
  lang TEXT,
  first_seen INTEGER NOT NULL,     -- мс с 1970
  last_seen INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  tz TEXT,                         -- часовой пояс из приложения, например Asia/Dushanbe
  checkin_on INTEGER NOT NULL DEFAULT 1, -- утренний вопрос про сон (у всех по умолчанию)
  morning_h INTEGER NOT NULL DEFAULT 10,
  evening_h INTEGER NOT NULL DEFAULT 21,
  last_m TEXT,                     -- дата последнего утреннего вопроса
  last_e TEXT,
  goals TEXT,                      -- цели из приложения JSON {water, steps, sleep}
  synced_at INTEGER,               -- когда приложение последний раз присылало данные
  premium_until INTEGER,           -- подписка Plus активна до (мс)
  ai_style TEXT,                   -- характер ИИ (Plus): friend, coach, fun
  last_w TEXT                      -- дата последнего отчёта недели
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
-- Напоминания о событиях календаря (за REMIND_MINUTES до начала).
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,               -- id события в приложении, или c<id записи> для события из чата
  title TEXT NOT NULL,
  at INTEGER NOT NULL,             -- начало события, мс UTC
  time TEXT,                       -- местное время для текста напоминания, HH:MM
  sent INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent, at);
-- Сводка дней из приложения (для похвалы, закономерностей и челленджей).
CREATE TABLE IF NOT EXISTS days (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD по времени человека
  sleep INTEGER, water INTEGER, steps INTEGER, mood INTEGER, energy INTEGER,
  spend INTEGER, cafe INTEGER, kcal INTEGER,
  PRIMARY KEY (user_id, date)
);
-- Челленджи шагов с друзьями.
CREATE TABLE IF NOT EXISTS challenges (
  code TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  started_at INTEGER,
  ends_at INTEGER NOT NULL,
  announced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS challenge_members (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON challenge_members(user_id);
-- Оплаты подписки Kwantoww Plus звёздами Telegram (charge_id нужен для возврата).
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0
);
