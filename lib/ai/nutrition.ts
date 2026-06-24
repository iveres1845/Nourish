/**
 * USDA FoodData Central API client
 * Docs: https://fdc.nal.usda.gov/api-guide.html
 * Free API key: https://api.data.gov/signup/
 */

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1'

// ─── Nutrient ID map (USDA FDC nutrient IDs) ─────────────────────────────────
// These IDs are stable across the FDC database.

const NUTRIENT_ID_MAP: Record<string, number> = {
  energy_kcal:        1008,
  protein_g:          1003,
  fat_g:              1004,
  carbohydrate_g:     1005,
  fiber_g:            1079,
  sugar_g:            2000,
  vitamin_a_mcg:      1106,  // RAE
  vitamin_c_mg:       1162,
  vitamin_d_mcg:      1114,
  vitamin_e_mg:       1109,
  vitamin_k_mcg:      1185,
  vitamin_b1_mg:      1165,  // thiamine
  vitamin_b2_mg:      1166,  // riboflavin
  vitamin_b3_mg:      1167,  // niacin
  vitamin_b6_mg:      1175,
  vitamin_b12_mcg:    1178,
  folate_mcg:         1190,  // DFE
  choline_mg:         1180,
  calcium_mg:         1087,
  iron_mg:            1089,
  magnesium_mg:       1090,
  phosphorus_mg:      1091,
  potassium_mg:       1092,
  sodium_mg:          1093,
  zinc_mg:            1095,
  copper_mg:          1098,
  selenium_mcg:       1103,
  omega3_ala_g:       1404,
  omega3_epa_mg:      1278,
  omega3_dha_mg:      1272,
  saturated_fat_g:    1258,
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FDCFood {
  fdcId: number
  description: string
  dataType: string
  brandName?: string
  foodNutrients: Array<{
    // Foundation / SR Legacy foods use nested structure
    nutrient?: { id: number; name: string; unitName: string }
    amount?: number
    // Branded foods use flat structure
    nutrientId?: number
    nutrientName?: string
    unitName?: string
    value?: number
  }>
}

interface FDCSearchResult {
  foods: Array<{
    fdcId: number
    description: string
    dataType: string
    score: number
  }>
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Search FoodData Central for a food by name.
 * Returns top candidates, or empty array if not found.
 */
export async function searchFood(query: string): Promise<Array<{ fdcId: number; description: string }>> {
  const url = new URL(`${FDC_BASE}/foods/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('pageSize', '5')
  url.searchParams.set('dataType', 'Foundation,SR Legacy')  // prefer whole-food entries
  url.searchParams.set('api_key', process.env.USDA_FDC_API_KEY!)

  const res = await fetch(url.toString())
  if (!res.ok) {
    console.warn(`FDC search failed for "${query}": ${res.status}`)
    return []
  }

  const data = (await res.json()) as FDCSearchResult
  return (data.foods ?? []).slice(0, 5).map(f => ({ fdcId: f.fdcId, description: f.description }))
}

/**
 * Fetch full nutrient data for a food by fdcId.
 * Returns empty object if the food record is unavailable (404 / API error).
 */
export async function getFoodNutrients(fdcId: number): Promise<Record<string, number>> {
  try {
    const url = `${FDC_BASE}/food/${fdcId}?api_key=${process.env.USDA_FDC_API_KEY}`
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`FDC food fetch failed for fdcId ${fdcId}: ${res.status} — skipping`)
      return {}
    }

    const data = (await res.json()) as FDCFood
    const result: Record<string, number> = {}

    for (const [key, nutrientId] of Object.entries(NUTRIENT_ID_MAP)) {
      // FDC Foundation/SR Legacy: { nutrient: { id }, amount }
      // FDC Branded: { nutrientId, value }
      const nutrient = data.foodNutrients.find((n) =>
        (n.nutrient?.id === nutrientId) || (n.nutrientId === nutrientId)
      )
      if (nutrient) {
        const val = nutrient.amount ?? nutrient.value
        if (val !== undefined) result[key] = val  // per 100g
      }
    }

    return result  // per 100g
  } catch (err) {
    console.warn(`FDC fetch error for fdcId ${fdcId}:`, err)
    return {}
  }
}

/**
 * Scale nutrients from per-100g to actual portion size.
 */
export function scaleNutrients(
  nutrientsPer100g: Record<string, number>,
  portion_g: number
): Record<string, number> {
  const factor = portion_g / 100
  const scaled: Record<string, number> = {}
  for (const [key, value] of Object.entries(nutrientsPer100g)) {
    scaled[key] = Math.round(value * factor * 100) / 100
  }
  return scaled
}

// ─── Prep method adjustments ─────────────────────────────────────────────────
// Nutrient retention factors — USDA Table of Nutrient Retention Factors (2007)

const PREP_ADJUSTMENTS: Record<string, Record<string, number>> = {
  boiled:   { vitamin_c_mg: 0.50, folate_mcg: 0.70, vitamin_b1_mg: 0.70, vitamin_b2_mg: 0.75, potassium_mg: 0.70 },
  steamed:  { vitamin_c_mg: 0.80, folate_mcg: 0.85 },
  roasted:  { vitamin_c_mg: 0.60, vitamin_a_mcg: 1.10 },  // beta-carotene availability increases
  sauteed:  { vitamin_c_mg: 0.70, folate_mcg: 0.80 },
  fried:    { vitamin_c_mg: 0.40, vitamin_b1_mg: 0.70 },
  grilled:  { vitamin_c_mg: 0.65 },
  baked:    { vitamin_c_mg: 0.60, folate_mcg: 0.80 },
  toasted:  { vitamin_b1_mg: 0.85 },
  raw:      {},  // baseline — no adjustment
  blended:  {},  // no significant loss vs raw
  fermented: {}, // negligible loss; some B vitamins may increase
  unknown:  {},  // no adjustment applied
}

/**
 * Apply prep method retention factors to scaled nutrient values.
 */
export function applyPrepAdjustments(
  nutrients: Record<string, number>,
  prepMethod: string
): Record<string, number> {
  const adjustments = PREP_ADJUSTMENTS[prepMethod] ?? {}
  const result = { ...nutrients }

  for (const [key, factor] of Object.entries(adjustments)) {
    if (result[key] !== undefined) {
      result[key] = Math.round(result[key] * factor * 100) / 100
    }
  }

  return result
}

/**
 * Full pipeline: search → fetch nutrients → scale to portion → apply prep adjustment.
 * Returns min/max nutrient maps based on portion range.
 */
export async function lookupFoodNutrients(params: {
  name: string
  portion_g_min: number
  portion_g_max: number
  prep_method: string
}): Promise<{
  fdcId: number | null
  nutrients_min: Record<string, number>
  nutrients_max: Record<string, number>
  nutrients_mid: Record<string, number>
} | null> {
  const { name, portion_g_min, portion_g_max, prep_method } = params

  const candidates = await searchFood(name)
  if (candidates.length === 0) return null

  // Try each candidate until we find one with actual nutrient data
  for (const candidate of candidates) {
    const per100g = await getFoodNutrients(candidate.fdcId)
    if (Object.keys(per100g).length === 0) continue  // no nutrients — try next

    const mid = (portion_g_min + portion_g_max) / 2
    return {
      fdcId: candidate.fdcId,
      nutrients_min: applyPrepAdjustments(scaleNutrients(per100g, portion_g_min), prep_method),
      nutrients_max: applyPrepAdjustments(scaleNutrients(per100g, portion_g_max), prep_method),
      nutrients_mid: applyPrepAdjustments(scaleNutrients(per100g, mid), prep_method),
    }
  }

  console.warn(`No nutrient data found for "${name}" across ${candidates.length} USDA candidates`)
  return null
}
