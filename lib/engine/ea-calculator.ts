/**
 * Energy Availability (EA) Calculator
 * Based on Loucks et al. / IOC RED-S consensus
 *
 * Formula: EA = (EI − EEE) / FFM
 * Optimal EA: ≥ 45 kcal/kg FFM
 * RED-S threshold: < 30 kcal/kg FFM
 *
 * Daily energy target = (45 × FFM_kg) + Exercise_EE_7day_avg + NEAT_kcal
 */

// ─── FFM Estimation ──────────────────────────────────────────────────────────

/**
 * Boer formula for Fat-Free Mass estimation
 * Boer P (1984) Seand J Urol Nephrol
 */
export function estimateFFM(params: {
  weight_kg: number
  height_cm: number
  sex: 'female' | 'male'
  body_fat_pct?: number  // if provided, overrides Boer formula
}): number {
  const { weight_kg, height_cm, sex, body_fat_pct } = params

  if (body_fat_pct !== undefined) {
    return weight_kg * (1 - body_fat_pct / 100)
  }

  if (sex === 'female') {
    return 0.252 * weight_kg + 0.473 * height_cm - 48.3
  } else {
    return 0.407 * weight_kg + 0.267 * height_cm - 19.2
  }
}

// ─── Exercise Energy Expenditure ─────────────────────────────────────────────

/**
 * MET values by activity type and intensity.
 * Source: Ainsworth et al. Compendium of Physical Activities (2011)
 */
export const MET_TABLE: Record<string, Record<string, number>> = {
  walking: { slow: 2.5, moderate: 3.5, brisk: 4.3, hiking: 6.0 },
  running: { jog: 7.0, moderate: 9.8, fast: 11.5, intervals: 10.0 },
  cycling: { leisure: 4.0, moderate: 8.0, vigorous: 12.0, spin: 8.5 },
  strength: { general: 3.5, vigorous: 5.0, circuit: 4.3, bodyweight: 3.8 },
  hiit_cardio: { hiit: 9.0, crossfit: 9.0, bootcamp: 7.5, boxing: 9.0 },
  swimming: { leisurely: 5.0, moderate: 7.0, vigorous: 10.0 },
  yoga_pilates: { yoga: 2.5, pilates: 3.0, stretching: 2.3 },
  team_sports: { basketball: 8.0, soccer: 7.0, tennis: 7.3, volleyball: 4.0 },
  rowing: { moderate: 7.0, vigorous: 8.5 },
  dance: { moderate: 5.0, vigorous: 7.8, zumba: 6.5 },
  other: { light: 3.0, moderate: 5.0, vigorous: 8.0 },
}

/**
 * Calculate energy expenditure for a single exercise session.
 * EE_kcal = MET × weight_kg × (duration_min / 60)
 */
export function calculateExerciseEE(params: {
  weight_kg: number
  met_value: number
  duration_min: number
}): number {
  const { weight_kg, met_value, duration_min } = params
  return met_value * weight_kg * (duration_min / 60)
}

/**
 * Get 7-day rolling average exercise energy expenditure.
 * Smooths out rest days so the daily target doesn't crash.
 */
export function get7DayAvgExerciseEE(
  exerciseLogs: Array<{ energy_kcal: number; logged_at: string }>,
  referenceDate: Date = new Date()
): number {
  const sevenDaysAgo = new Date(referenceDate)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const recent = exerciseLogs.filter(
    (log) => new Date(log.logged_at) >= sevenDaysAgo
  )

  if (recent.length === 0) return 0

  const totalEE = recent.reduce((sum, log) => sum + log.energy_kcal, 0)
  return totalEE / 7  // divide by 7 days, not number of sessions
}

// ─── NEAT Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate exercise steps from logged exercise sessions.
 * Used to avoid double-counting when computing lifestyle NEAT.
 * Approximation: running/walking sessions produce ~1400 steps/km,
 * other activities produce minimal steps but wearable counts them.
 */
export function estimateExerciseSteps(exerciseLogs: Array<{
  activity_type: string
  duration_min: number
}>): number {
  let steps = 0
  for (const log of exerciseLogs) {
    if (log.activity_type === 'running') {
      steps += log.duration_min * 150  // ~150 steps/min running
    } else if (log.activity_type === 'walking') {
      steps += log.duration_min * 100  // ~100 steps/min walking
    }
  }
  return steps
}

/**
 * NEAT from lifestyle steps (total steps minus exercise steps).
 * Formula: NEAT_kcal = (lifestyle_steps / 1000) × (weight_kg × 0.75)
 * Source: Tudor-Locke et al. / Winkler et al.
 */
export function calculateNEAT(params: {
  total_daily_steps: number
  weight_kg: number
  exercise_steps_today: number
}): number {
  const { total_daily_steps, weight_kg, exercise_steps_today } = params
  const lifestyle_steps = Math.max(0, total_daily_steps - exercise_steps_today)
  return (lifestyle_steps / 1000) * (weight_kg * 0.75)
}

// ─── Daily Energy Target ─────────────────────────────────────────────────────

export interface EAResult {
  ffm_kg: number
  ea_base_kcal: number        // 45 × FFM
  exercise_ee_7day_avg: number
  neat_kcal: number
  daily_energy_target: number

  // Range (asymmetric — see design spec)
  range_low: number
  range_high: number
  flag_direction: 'low_only'
}

const GOAL_RANGES: Record<string, { low_pct: number; high_pct: number }> = {
  general_wellness: { low_pct: 0.90, high_pct: 1.20 },
  hormonal:        { low_pct: 0.92, high_pct: 1.25 },
  athletic:        { low_pct: 0.95, high_pct: 1.30 },
  gut_health:      { low_pct: 0.90, high_pct: 1.20 },
}

/**
 * Compute the full EA-based energy target with range.
 * When multiple goals are active, use the most conservative low end (highest pct).
 */
export function computeDailyEnergyTarget(params: {
  weight_kg: number
  height_cm: number
  sex: 'female' | 'male'
  body_fat_pct?: number
  avg_daily_steps: number
  exercise_logs_7day: Array<{ energy_kcal: number; logged_at: string; activity_type: string; duration_min: number }>
  goals: string[]
}): EAResult {
  const { weight_kg, height_cm, sex, body_fat_pct, avg_daily_steps, exercise_logs_7day, goals } = params

  const ffm_kg = estimateFFM({ weight_kg, height_cm, sex, body_fat_pct })
  const ea_base_kcal = 45 * ffm_kg

  const exercise_ee_7day_avg = get7DayAvgExerciseEE(exercise_logs_7day)

  const exercise_steps_today = estimateExerciseSteps(
    exercise_logs_7day.filter((l) => {
      const d = new Date(l.logged_at)
      const today = new Date()
      return d.toDateString() === today.toDateString()
    })
  )

  const neat_kcal = calculateNEAT({
    total_daily_steps: avg_daily_steps,
    weight_kg,
    exercise_steps_today,
  })

  const daily_energy_target = ea_base_kcal + exercise_ee_7day_avg + neat_kcal

  // For multiple goals: use most conservative low end (highest low_pct)
  const activeGoals = goals.filter((g) => GOAL_RANGES[g])
  const low_pct = activeGoals.length
    ? Math.max(...activeGoals.map((g) => GOAL_RANGES[g].low_pct))
    : 0.90
  const high_pct = activeGoals.length
    ? Math.max(...activeGoals.map((g) => GOAL_RANGES[g].high_pct))
    : 1.20

  return {
    ffm_kg: Math.round(ffm_kg * 10) / 10,
    ea_base_kcal: Math.round(ea_base_kcal),
    exercise_ee_7day_avg: Math.round(exercise_ee_7day_avg),
    neat_kcal: Math.round(neat_kcal),
    daily_energy_target: Math.round(daily_energy_target),
    range_low: Math.round(daily_energy_target * low_pct),
    range_high: Math.round(daily_energy_target * high_pct),
    flag_direction: 'low_only',
  }
}

// ─── RED-S Check ─────────────────────────────────────────────────────────────

/**
 * Check if Energy Availability is in the RED-S danger zone.
 * EA < 30 kcal/kg FFM = clinical RED-S threshold.
 * This is distinct from the daily target check and should trigger a
 * more urgent insight regardless of goal.
 */
export function checkREDS(params: {
  energy_intake_kcal: number
  exercise_ee_kcal: number
  ffm_kg: number
}): { ea: number; is_reds_risk: boolean } {
  const ea = (params.energy_intake_kcal - params.exercise_ee_kcal) / params.ffm_kg
  return {
    ea: Math.round(ea * 10) / 10,
    is_reds_risk: ea < 30,
  }
}
