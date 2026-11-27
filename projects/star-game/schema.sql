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
  luck INTEGER,                     -- везение, %; NULL = обычные 50
  played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0  -- для профиля
);
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_week ON players(week, week_best);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, started INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, score INTEGER, diff INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, item TEXT NOT NULL, stars INTEGER NOT NULL, ts INTEGER NOT NULL);
-- «Мины»: расстановка мин хранится только на сервере, игрок видит её после конца игры.
CREATE TABLE IF NOT EXISTS mines_games (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, stake INTEGER NOT NULL, m INTEGER NOT NULL, mines TEXT NOT NULL, opened TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mines_user ON mines_games(user_id, status);
-- «Ракетка»: точка взрыва хранится только на сервере.
CREATE TABLE IF NOT EXISTS crash_games (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, stake INTEGER NOT NULL, crash REAL NOT NULL, start INTEGER NOT NULL, status TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_crash_user ON crash_games(user_id, status);
