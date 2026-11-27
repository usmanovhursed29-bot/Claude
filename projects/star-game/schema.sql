-- «Звёздный рейс»: игроки, полёты (для проверки очков), оплаты звёздами.
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,           -- Telegram user id
  name TEXT,
  created INTEGER,
  free_day TEXT, free_used INTEGER NOT NULL DEFAULT 0,   -- бесплатные запуски за день
  runs_extra INTEGER NOT NULL DEFAULT 0,                 -- купленные и выигранные запуски
  coins INTEGER NOT NULL DEFAULT 0, coin_day TEXT, free_spin INTEGER NOT NULL DEFAULT 0,
  shield INTEGER NOT NULL DEFAULT 0,                     -- щитов на старт
  best INTEGER NOT NULL DEFAULT 0, week TEXT, week_best INTEGER NOT NULL DEFAULT 0,
  skins TEXT NOT NULL DEFAULT '["classic"]', skin TEXT NOT NULL DEFAULT 'classic',
  username TEXT,                    -- ник в Telegram (для команды /luck)
  luck INTEGER                      -- шанс выигрыша в колесе, %; NULL = обычные 50
);
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_week ON players(week, week_best);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, started INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, score INTEGER, diff INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, item TEXT NOT NULL, stars INTEGER NOT NULL, ts INTEGER NOT NULL);
