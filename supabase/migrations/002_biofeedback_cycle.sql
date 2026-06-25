-- ── Biofeedback daily check-ins ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biofeedback_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date          date NOT NULL,
  energy        smallint CHECK (energy BETWEEN 1 AND 5),
  mood          smallint CHECK (mood BETWEEN 1 AND 5),
  sleep_quality smallint CHECK (sleep_quality BETWEEN 1 AND 5),
  sleep_hours   numeric(3,1),
  recovery      smallint CHECK (recovery BETWEEN 1 AND 5),
  digestion     smallint CHECK (digestion BETWEEN 1 AND 5),
  notes         text,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE biofeedback_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own biofeedback" ON biofeedback_logs
  FOR ALL USING (auth.uid() = user_id);

-- ── Cycle tracking ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cycle_logs (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period_start       date NOT NULL,
  period_end         date,
  cycle_length_days  smallint,
  notes              text,
  created_at         timestamptz DEFAULT now()
);

ALTER TABLE cycle_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own cycle logs" ON cycle_logs
  FOR ALL USING (auth.uid() = user_id);

-- ── Cycle daily symptoms ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cycle_symptoms (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date      date NOT NULL,
  symptoms  text[] DEFAULT '{}',
  flow      text CHECK (flow IN ('none','spotting','light','medium','heavy')),
  notes     text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE cycle_symptoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own cycle symptoms" ON cycle_symptoms
  FOR ALL USING (auth.uid() = user_id);

-- ── Profile additions ──────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_calories boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS typical_week_sessions jsonb DEFAULT '[]'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS energy_range_low numeric;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS energy_range_high numeric;
