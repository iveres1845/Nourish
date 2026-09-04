-- Migration 003: Configurable macro targets
-- Run this in your Supabase project -> SQL Editor -> New Query
--
-- Adds user-configurable macro-distribution settings to profiles:
--   - Protein target as g per kg bodyweight (not tied to calories at all,
--     per current sports-nutrition guidance of ~1.8-2.8 g/kg)
--   - Fat and carbohydrate targets as a % of the daily calorie range
-- Defaults match Isabella's requested starting point (1.8-2.8 g/kg protein,
-- 20-30% fat, 45-65% carb) but are per-user and editable from Profile.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS protein_g_per_kg_low  NUMERIC(3,1) DEFAULT 1.8,
  ADD COLUMN IF NOT EXISTS protein_g_per_kg_high NUMERIC(3,1) DEFAULT 2.8,
  ADD COLUMN IF NOT EXISTS fat_pct_low            NUMERIC(4,1) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS fat_pct_high           NUMERIC(4,1) DEFAULT 30,
  ADD COLUMN IF NOT EXISTS carb_pct_low           NUMERIC(4,1) DEFAULT 45,
  ADD COLUMN IF NOT EXISTS carb_pct_high          NUMERIC(4,1) DEFAULT 65;
