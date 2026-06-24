-- ============================================================
-- Nourish — Supabase Database Schema
-- Run this in your Supabase project → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension (already on by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users with Nourish-specific data.
-- Created automatically on first sign-in via trigger below.

CREATE TABLE IF NOT EXISTS public.profiles (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                 TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  -- EA calculation inputs (required)
  weight_kg             NUMERIC(5,1),
  height_cm             NUMERIC(5,1),
  sex                   TEXT CHECK (sex IN ('female', 'male')),
  age                   INTEGER,
  avg_daily_steps       INTEGER DEFAULT 7000,

  -- EA calculation inputs (optional)
  body_fat_pct          NUMERIC(4,1),

  -- Goals & dietary context
  goals                 TEXT[] DEFAULT '{"general_wellness"}',
  dietary_pattern       TEXT DEFAULT 'omnivore',

  -- Cached EA results (recomputed quarterly or on weight/steps change)
  ffm_kg                NUMERIC(5,1),
  ea_base_kcal          INTEGER,
  daily_energy_target   INTEGER,

  -- Onboarding state
  onboarding_completed  BOOLEAN DEFAULT FALSE
);

-- Trigger: auto-create profile row on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Exercise Logs ───────────────────────────────────────────────────────────
-- Used for 7-day rolling average exercise EE in EA calculation.

CREATE TABLE IF NOT EXISTS public.exercise_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  logged_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  activity_type   TEXT NOT NULL,       -- e.g. "running"
  activity_subtype TEXT,               -- e.g. "moderate"
  duration_min    INTEGER NOT NULL,
  met_value       NUMERIC(4,1) NOT NULL,
  energy_kcal     NUMERIC(7,1) NOT NULL
);

CREATE INDEX IF NOT EXISTS exercise_logs_user_date ON public.exercise_logs(user_id, logged_at DESC);

-- ─── Meals ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meals (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  logged_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meal_date             DATE NOT NULL DEFAULT CURRENT_DATE,  -- for grouping
  meal_type             TEXT DEFAULT 'unknown',
  created_at            TIMESTAMPTZ DEFAULT NOW(),

  -- Photo
  photo_url             TEXT,
  photo_storage_path    TEXT,

  -- Vision model metadata
  vision_confidence     NUMERIC(3,2),
  user_note             TEXT,

  -- Nutrient totals (sum of all food_items) — stored as JSONB for flexibility
  nutrient_totals_min   JSONB DEFAULT '{}',
  nutrient_totals_max   JSONB DEFAULT '{}',
  nutrient_totals_mid   JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS meals_user_date ON public.meals(user_id, meal_date DESC);

-- ─── Food Items ──────────────────────────────────────────────────────────────
-- Individual foods within a meal.

CREATE TABLE IF NOT EXISTS public.food_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meal_id             UUID NOT NULL REFERENCES public.meals(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  name                TEXT NOT NULL,
  category_keys       TEXT[] DEFAULT '{}',  -- matched food_categories from rules.yaml
  usda_fdc_id         INTEGER,
  plant_name          TEXT,  -- if this is a plant (for diversity count)

  portion_g_min       NUMERIC(7,1),
  portion_g_max       NUMERIC(7,1),
  portion_g_mid       NUMERIC(7,1),

  prep_method         TEXT DEFAULT 'unknown',
  confidence          NUMERIC(3,2),
  visible_quantity    TEXT,
  is_synthetic_oil    BOOLEAN DEFAULT FALSE,
  notes               TEXT,

  nutrients_min       JSONB DEFAULT '{}',
  nutrients_max       JSONB DEFAULT '{}',
  nutrients_mid       JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS food_items_meal ON public.food_items(meal_id);

-- ─── Daily Logs ──────────────────────────────────────────────────────────────
-- Aggregated per-day nutrition. Computed at end-of-day or on-demand.

CREATE TABLE IF NOT EXISTS public.daily_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  nutrient_totals     JSONB DEFAULT '{}',  -- mid-range values summed across meals
  energy_target       INTEGER,             -- snapshot of target on this date
  plant_count         INTEGER DEFAULT 0,   -- distinct plants this day
  meal_count          INTEGER DEFAULT 0,

  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS daily_logs_user_date ON public.daily_logs(user_id, date DESC);

-- ─── Weekly Plant Diversity ──────────────────────────────────────────────────
-- Tracks 30-plants-per-week goal (British Gut Project / McDonald et al. 2018)

CREATE TABLE IF NOT EXISTS public.weekly_plant_diversity (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,  -- Monday of the week
  plant_names TEXT[] DEFAULT '{}',
  plant_count INTEGER DEFAULT 0,

  UNIQUE(user_id, week_start)
);

-- ─── Insights ────────────────────────────────────────────────────────────────
-- Polymorphic: linked to a meal OR a daily_log (not both, not neither).

CREATE TABLE IF NOT EXISTS public.insights (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),

  -- Source link (one or the other)
  meal_id           UUID REFERENCES public.meals(id) ON DELETE CASCADE,
  daily_log_id      UUID REFERENCES public.daily_logs(id) ON DELETE CASCADE,

  -- Rule metadata
  rule_id           TEXT NOT NULL,  -- e.g. "iron_vitamin_c_synergy"
  scope             TEXT NOT NULL CHECK (scope IN ('meal', 'daily', 'weekly')),
  type              TEXT NOT NULL,
  priority          TEXT DEFAULT 'medium',

  -- Content
  headline          TEXT NOT NULL,
  copy              TEXT NOT NULL,
  foods_to_suggest  TEXT[] DEFAULT '{}',
  action_label      TEXT,

  -- Dismissal / suppression
  dismissed_at      TIMESTAMPTZ,
  dismiss_until     TIMESTAMPTZ,   -- rule won't fire again until this date

  CONSTRAINT insight_has_source CHECK (
    (meal_id IS NOT NULL AND daily_log_id IS NULL) OR
    (meal_id IS NULL AND daily_log_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS insights_user ON public.insights(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS insights_meal ON public.insights(meal_id);

-- ─── Row Level Security (RLS) ─────────────────────────────────────────────────
-- Users can only see and modify their own data.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_plant_diversity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Exercise logs
CREATE POLICY "Users can manage own exercise logs" ON public.exercise_logs
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Meals
CREATE POLICY "Users can manage own meals" ON public.meals
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Food items
CREATE POLICY "Users can manage own food items" ON public.food_items
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Daily logs
CREATE POLICY "Users can manage own daily logs" ON public.daily_logs
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Plant diversity
CREATE POLICY "Users can manage own plant diversity" ON public.weekly_plant_diversity
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Insights
CREATE POLICY "Users can manage own insights" ON public.insights
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Storage Bucket ──────────────────────────────────────────────────────────
-- Run this separately in Supabase Storage if not done via the dashboard.
-- INSERT INTO storage.buckets (id, name, public) VALUES ('meal-photos', 'meal-photos', false);

-- Storage policy: users can only access their own photos
-- CREATE POLICY "Users can upload own meal photos" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'meal-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Users can view own meal photos" ON storage.objects
--   FOR SELECT USING (bucket_id = 'meal-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
