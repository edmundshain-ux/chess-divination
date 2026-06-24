-- 在 Supabase SQL Editor 執行此檔案

CREATE TABLE records (
  id BIGINT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT,
  qtype TEXT,
  question TEXT,
  pieces JSONB,
  self_color TEXT,
  score INTEGER,
  note TEXT,
  teacher_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  UNIQUE(user_id, key)
);

ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all" ON records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON settings FOR ALL USING (true) WITH CHECK (true);
