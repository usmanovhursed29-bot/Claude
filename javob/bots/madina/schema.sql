CREATE TABLE IF NOT EXISTS sessions (
  chat_id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  data TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  name TEXT,
  branch TEXT NOT NULL,
  when_text TEXT NOT NULL,
  guests INTEGER NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_branch ON bookings(branch);
