// ─── User / Profile ──────────────────────────────────────────────────────────

export type Goal = 'general_wellness' | 'hormonal' | 'athletic' | 'gut_health'
export type Sex = 'female' | 'male'
export type DietaryPattern = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'other'

export interface UserProfile {
  id: string
  email: string
  created_at: string

  // Onboarding — required for EA calculation
  weight_kg: number
  height_cm: number
  sex: Sex
  age: number
  avg_daily_steps: number

  // Onboarding — optional
  body_fat_pct?: number
  dietary_pattern: DietaryPattern
  goals: Goal[]

  // Computed and cached — recalculated quarterly or on change
  ffm_kg: number           // Fat-free mass (Boer formula or body_fat_pct override)
  ea_base_kcal: number     // 45 × FFM_kg
  daily_energy_target: number  // ea_base + 7-day avg exercise EE + NEAT
}

// ─── Energy / Exercise ───────────────────────────────────────────────────────

export interface ExerciseLog {
  id: string
  user_id: string
  logged_at: string         // ISO date
  activity_type: string     // e.g. "running", "cycling"
  activity_subtype?: string // e.g. "moderate", "vigorous"
  duration_min: number
  met_value: number         // looked up from DRI table
  energy_kcal: number       // MET × weight_kg × (duration_min / 60)
}

// ─── Meals ───────────────────────────────────────────────────────────────────

export type PrepMethod =
  | 'raw' | 'boiled' | 'steamed' | 'sauteed' | 'roasted'
  | 'grilled' | 'baked' | 'fried' | 'toasted' | 'blended'
  | 'fermented' | 'unknown'

export interface FoodItem {
  id: string
  meal_id: string
  name: string
  category_keys: string[]     // matched keys from nourish_rules.yaml food_categories
  usda_fdc_id?: number
  portion_g_min: number
  portion_g_max: number
  portion_g_mid: number       // (min + max) / 2 — used for daily totals
  prep_method: PrepMethod
  confidence: number          // from vision model
  nutrients_min: NutrientMap
  nutrients_max: NutrientMap
  nutrients_mid: NutrientMap
  is_synthetic_oil: boolean   // true if created from cooking_context estimate
  notes?: string
}

export interface Meal {
  id: string
  user_id: string
  logged_at: string
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink_only' | 'unknown'
  photo_url?: string
  photo_storage_path?: string
  vision_confidence: number
  food_items: FoodItem[]
  nutrient_totals_min: NutrientMap
  nutrient_totals_max: NutrientMap
  nutrient_totals_mid: NutrientMap
  user_note?: string          // optional note user added before photo analysis
  insights?: Insight[]
}

// ─── Nutrients ───────────────────────────────────────────────────────────────

export interface NutrientMap {
  // Macros
  energy_kcal?: number
  protein_g?: number
  fat_g?: number
  carbohydrate_g?: number
  fiber_g?: number
  sugar_g?: number

  // Fat-soluble vitamins
  vitamin_a_mcg?: number       // RAE
  vitamin_d_mcg?: number
  vitamin_e_mg?: number
  vitamin_k_mcg?: number

  // Water-soluble vitamins
  vitamin_c_mg?: number
  vitamin_b1_mg?: number       // thiamine
  vitamin_b2_mg?: number       // riboflavin
  vitamin_b3_mg?: number       // niacin
  vitamin_b6_mg?: number
  vitamin_b12_mcg?: number
  folate_mcg?: number          // DFE
  choline_mg?: number
  biotin_mcg?: number
  pantothenic_acid_mg?: number

  // Minerals
  calcium_mg?: number
  iron_mg?: number
  magnesium_mg?: number
  phosphorus_mg?: number
  potassium_mg?: number
  sodium_mg?: number
  zinc_mg?: number
  copper_mg?: number
  manganese_mg?: number
  selenium_mcg?: number
  iodine_mcg?: number
  chromium_mcg?: number
  fluoride_mg?: number

  // Fatty acids
  omega3_ala_g?: number
  omega3_epa_mg?: number
  omega3_dha_mg?: number
  omega6_la_g?: number
  saturated_fat_g?: number
  trans_fat_g?: number
}

// ─── Daily Log ───────────────────────────────────────────────────────────────

export interface DailyLog {
  id: string
  user_id: string
  date: string                 // YYYY-MM-DD
  nutrient_totals: NutrientMap
  energy_target: number
  plant_count: number          // distinct plants logged this day
  meal_count: number
  insights?: Insight[]
}

// ─── Insights ────────────────────────────────────────────────────────────────

export type InsightType = 'pairing' | 'inhibitor' | 'blood_sugar' | 'pattern' | 'underfueling'
export type InsightScope = 'meal' | 'daily' | 'weekly'
export type InsightPriority = 'high' | 'medium' | 'low'

export interface Insight {
  id: string
  user_id: string
  rule_id: string
  scope: InsightScope
  meal_id?: string
  daily_log_id?: string
  created_at: string
  dismissed_at?: string
  dismiss_until?: string       // suppression expiry

  type: InsightType
  priority: InsightPriority
  headline: string
  copy: string
  foods_to_suggest?: string[]
  action_label?: string
}

// ─── Vision API ──────────────────────────────────────────────────────────────

export interface VisionFood {
  name: string
  category_hints: string[]
  portion_g_min: number
  portion_g_max: number
  confidence: number
  prep_method: PrepMethod
  visible_quantity: string
  notes?: string
}

export interface VisionResponse {
  meal_confidence: number
  meal_type_guess: string
  foods: VisionFood[]
  mixed_dishes: Array<{
    name: string
    likely_base_ingredients: string[]
    portion_g_min: number
    portion_g_max: number
    confidence: number
    notes?: string
  }>
  beverages: Array<{
    name: string
    volume_ml_min: number
    volume_ml_max: number
    added_items: string[]
    confidence: number
  }>
  cooking_context: {
    oil_likely_used: boolean
    oil_type_guess?: string
    oil_amount_guess: 'none' | 'light' | 'moderate' | 'heavy'
    oil_amount_g_min: number
    oil_amount_g_max: number
    confidence: number
    notes?: string
  }
  condiments_and_garnishes: VisionFood[]
  visibility_flags: {
    partially_obscured: boolean
    lighting_poor: boolean
    angle_challenging: boolean
    plate_crowded: boolean
    image_blurry: boolean
  }
  uncertain_items: VisionFood[]
}
