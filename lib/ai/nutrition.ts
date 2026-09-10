/**
 * USDA FoodData Central API client
 * Docs: https://fdc.nal.usda.gov/api-guide.html
 * Free API key: https://api.data.gov/signup/
 */

import { searchOpenFoodFacts } from './openfoodfacts'

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
  foodPortions?: Array<{
    gramWeight: number
    amount?: number
    modifier?: string
    measureUnit?: { name: string }
  }>
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
 * Search FoodData Central — generic whole foods (Foundation + SR Legacy).
 */
export async function searchFood(query: string): Promise<Array<{ fdcId: number; description: string; dataType: string }>> {
  const url = new URL(`${FDC_BASE}/foods/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('pageSize', '5')
  url.searchParams.set('dataType', 'Foundation,SR Legacy')
  url.searchParams.set('api_key', process.env.USDA_FDC_API_KEY!)

  const res = await fetch(url.toString())
  if (!res.ok) { console.warn(`FDC search failed for "${query}": ${res.status}`); return [] }
  const data = (await res.json()) as FDCSearchResult
  return (data.foods ?? []).slice(0, 5).map(f => ({ fdcId: f.fdcId, description: f.description, dataType: f.dataType ?? 'Foundation' }))
}

/**
 * Search FoodData Central Branded Foods database.
 * Used when user notes or vision model identify a specific brand/product.
 */
export async function searchBrandedFood(query: string): Promise<Array<{ fdcId: number; description: string; dataType: string }>> {
  const url = new URL(`${FDC_BASE}/foods/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('pageSize', '8')
  url.searchParams.set('dataType', 'Branded')
  url.searchParams.set('api_key', process.env.USDA_FDC_API_KEY!)

  const res = await fetch(url.toString())
  if (!res.ok) { console.warn(`FDC branded search failed for "${query}": ${res.status}`); return [] }
  const data = (await res.json()) as FDCSearchResult
  return (data.foods ?? []).slice(0, 8).map(f => ({ fdcId: f.fdcId, description: f.description, dataType: 'Branded' }))
}

/**
 * Common food-world words that GPT may capitalise in sentence/title case
 * but that do NOT indicate a brand name.
 * Purpose: prevent "Whole Milk" or "Orange Juice" triggering branded USDA search.
 */
const GENERIC_FOOD_WORDS = new Set([
  // dairy descriptors
  'whole', 'skim', 'skimmed', 'reduced', 'lowfat', 'nonfat', 'fat', 'semi',
  'milk', 'cream', 'butter', 'cheese', 'yogurt', 'yoghurt', 'kefir', 'whey',
  // proteins
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'salmon', 'tuna',
  'cod', 'tilapia', 'shrimp', 'prawn', 'egg', 'eggs', 'tofu', 'tempeh', 'seitan',
  // grains & starches
  'rice', 'oats', 'oatmeal', 'bread', 'pasta', 'noodles', 'quinoa', 'barley',
  'rye', 'millet', 'corn', 'wheat', 'flour', 'tortilla', 'wrap', 'pita',
  'white', 'brown', 'jasmine', 'basmati', 'sourdough', 'gnocchi',
  // fruits
  'apple', 'banana', 'orange', 'grape', 'strawberry', 'blueberry', 'mango',
  'pear', 'peach', 'plum', 'cherry', 'kiwi', 'melon', 'watermelon',
  'pineapple', 'papaya', 'lemon', 'lime', 'avocado', 'tomato',
  // vegetables
  'spinach', 'kale', 'broccoli', 'carrot', 'potato', 'onion', 'garlic',
  'pepper', 'zucchini', 'cucumber', 'celery', 'lettuce', 'cabbage', 'beet',
  'cauliflower', 'asparagus', 'eggplant', 'mushroom', 'peas', 'corn',
  // legumes & nuts
  'lentils', 'chickpeas', 'beans', 'peanut', 'almond', 'walnut', 'cashew',
  'pistachio', 'pecan', 'sunflower', 'pumpkin', 'sesame', 'flaxseed', 'chia',
  // beverages & liquids
  'juice', 'water', 'broth', 'stock', 'oil', 'vinegar', 'tea', 'coffee',
  'sauce', 'dressing', 'gravy', 'syrup', 'honey', 'jam', 'jelly',
  // prep / cuisine descriptors
  'cooked', 'raw', 'grilled', 'baked', 'roasted', 'steamed', 'boiled',
  'fried', 'sauteed', 'stir', 'smoked', 'cured', 'pickled', 'dried',
  'fresh', 'frozen', 'canned',
  // size / type modifiers
  'large', 'small', 'medium', 'lean', 'extra', 'ground', 'sliced', 'diced',
  'chopped', 'minced', 'shredded', 'plain', 'original', 'classic', 'simple',
  'organic', 'natural', 'wild', 'low', 'high', 'full', 'light', 'dark',
  // cuisines / generics that sound proper-noun-ish
  'greek', 'italian', 'mexican', 'japanese', 'chinese', 'thai', 'indian',
  'french', 'american', 'mediterranean',
  // meal types / misc
  'salad', 'soup', 'stew', 'curry', 'mixed', 'blend', 'smoothie', 'shake',
  'bar', 'snack', 'mix', 'protein',   // "protein" alone is generic
])

/**
 * Heuristic: does this food name look like it contains a brand?
 * Returns true only when a capitalised word is NOT a common food/prep term.
 *
 * Examples:
 *   "Whole Milk"              → false  (both words are generic)
 *   "Mission Carb Balance"    → true   ("Mission" is not generic)
 *   "Fairlife Core Power"     → true   ("Fairlife" is not generic)
 *   "Greek Yogurt"            → false  (both generic)
 *   "Chobani Greek Yogurt"    → true   ("Chobani" is not generic)
 */
function looksLikeBrandedFood(name: string): boolean {
  const words = name.split(/\s+/)
  const capitalizedWords = words.filter(w => /^[A-Z][a-z]/.test(w))

  if (capitalizedWords.length >= 2) {
    // If EVERY capitalised word is a generic food term, this is NOT a brand
    const hasNonGenericWord = capitalizedWords.some(w => !GENERIC_FOOD_WORDS.has(w.toLowerCase()))
    return hasNonGenericWord
  }

  // Single capitalised word — only flag with explicit brand product signals
  const brandSignals = /\b(protein shake|protein bar|granola bar|energy drink|sports drink|meal replacement|protein cookie|core power|premier protein|muscle milk)\b/i
  return brandSignals.test(name)
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
      // Energy can appear under ID 1008 (Atwater general) OR 2047 (Atwater specific)
      const altEnergyId = key === 'energy_kcal' ? 2047 : null

      const nutrient = data.foodNutrients.find((n) =>
        (n.nutrient?.id === nutrientId) || (n.nutrientId === nutrientId) ||
        (altEnergyId !== null && ((n.nutrient?.id === altEnergyId) || (n.nutrientId === altEnergyId)))
      )
      if (nutrient) {
        const val = nutrient.amount ?? nutrient.value
        if (val !== undefined) {
          // FDC reports EPA/DHA (nutrient IDs 1278/1272) in grams, like other
          // fatty acids — but our key names (and the rest of the app) treat
          // omega3_epa_mg/omega3_dha_mg as milligrams. Without this conversion,
          // logged fish showed EPA/DHA ~1000x too small (e.g. sardines'
          // 0.473g EPA/100g stored as "0.473mg", rounding away to ~nothing).
          const isGramsReportedAsMg = key === 'omega3_epa_mg' || key === 'omega3_dha_mg'
          result[key] = isGramsReportedAsMg ? val * 1000 : val  // per 100g
        }
      }
    }

    // Sanity check: energy > 9 kcal/g is physically impossible (pure fat = ~9 kcal/g)
    // If we see this, the record is likely reporting per-serving not per-100g — discard it
    if (result.energy_kcal && result.energy_kcal > 900) {
      console.warn(`FDC fdcId ${fdcId} returned suspicious energy ${result.energy_kcal} kcal/100g — discarding`)
      return {}
    }

    return result  // per 100g
  } catch (err) {
    console.warn(`FDC fetch error for fdcId ${fdcId}:`, err)
    return {}
  }
}

/**
 * Fetch a real-world "standard serving" gram weight for a food, straight
 * from USDA's own household-measure data (foodPortions) instead of
 * inventing one. Used by the menu planner to round its suggested portions
 * to something that reads like an actual serving ("2 slices", "1 medium
 * fruit") rather than a raw solver output like "137g".
 *
 * Preference order:
 *   1. The FDA's own "NLEA serving" -- the reference amount used on the
 *      Nutrition Facts label, the closest thing to a universal "one
 *      serving" that exists across food types.
 *   2. The median of whatever household measures ARE listed, which is a
 *      reasonable single-unit estimate without letting one outlier (e.g.
 *      "1 cup, mashed" for a fruit normally eaten whole) skew the pick.
 * Returns null if the food has no portion data at all (some Foundation
 * records don't) -- callers should fall back to a formula-based estimate.
 */
export async function getServingSizeG(fdcId: number): Promise<number | null> {
  try {
    const url = `${FDC_BASE}/food/${fdcId}?api_key=${process.env.USDA_FDC_API_KEY}`
    const res = await fetch(url)
    if (!res.ok) return null

    const data = (await res.json()) as FDCFood
    const portions = (data.foodPortions ?? []).filter(p => p.gramWeight > 0)
    if (portions.length === 0) return null

    const nlea = portions.find(p => p.modifier?.toLowerCase().includes('nlea serving'))
    if (nlea) return nlea.gramWeight

    const weights = portions.map(p => p.gramWeight).sort((a, b) => a - b)
    return weights[Math.floor(weights.length / 2)]
  } catch (err) {
    console.warn(`FDC serving-size fetch error for fdcId ${fdcId}:`, err)
    return null
  }
}

/**
 * A USDA record is only usable if it has a complete macro profile.
 * Some Foundation/SR Legacy records report energy but are missing one or more
 * of protein/fat/carbohydrate (e.g. a derived "carbohydrate, by difference"
 * value that wasn't computed for that record). Accepting those silently turns
 * missing values into 0 downstream, which skews the macro breakdown badly
 * (protein/fat inflated, carbs collapsed to ~0) while the calorie total still
 * looks roughly right. Treat incomplete records as unusable so the caller
 * falls through to the next candidate — or to the GPT fallback, which always
 * returns a complete profile.
 */
export function hasCompleteMacroProfile(per100g: Record<string, number>): boolean {
  return (
    typeof per100g.protein_g === 'number' &&
    typeof per100g.fat_g === 'number' &&
    typeof per100g.carbohydrate_g === 'number'
  )
}

/**
 * Known-problematic USDA searches: short, common staple-food names where
 * FDC's text-relevance ranking surfaces unrelated products ahead of the
 * actual generic food. Confirmed live: searching "Whole Milk" (and even
 * "milk" alone) ranks "Cheese, mozzarella, whole milk" and "Yogurt, plain,
 * whole milk" above the real "Milk, whole, 3.25% milkfat" record — both
 * contain "whole"/"milk" as descriptor words, which is enough for FDC's
 * search to rank them higher than the true match. This silently produced
 * cheese-level protein/fat with near-zero carbs for a logged glass of milk.
 * For these known staples we bypass search entirely and fetch the verified
 * correct fdcId directly. fdcId 746782 confirmed via a live FDC lookup as
 * "Milk, whole, 3.25% milkfat, with added vitamin D" (Foundation).
 */
const STAPLE_FOOD_OVERRIDES: Record<string, number> = {
  'milk': 746782,
  'whole milk': 746782,
  'cow milk': 746782,
  "cow's milk": 746782,
  'dairy milk': 746782,
  'regular milk': 746782,
}

/**
 * Reject USDA candidates whose category + immediate descriptor — the first
 * TWO comma-separated segments in FDC's "Category, descriptor, descriptor…"
 * naming convention — share no core word with the query. This is what should
 * have caught the milk→cheese mismatch: "Cheese, mozzarella, whole milk" has
 * category+descriptor "cheese, mozzarella", which has nothing in common with
 * a "milk" query, even though the full description contains "milk" further
 * along. Applied as a cheap pre-filter before spending an API call fetching
 * nutrient data.
 *
 * Checking two segments (not just the first) matters: FDC often puts the
 * broad category first and the specific species/variety second — e.g.
 * "Fish, sardine, Atlantic, canned in oil…" for sardines, or "Milk,
 * buttermilk, fluid, whole" for buttermilk. A first-segment-only check
 * rejected these correct matches (category word "fish"/"milk" alone doesn't
 * contain "sardines"/"buttermilk"), silently forcing a fallback to GPT
 * estimation that doesn't even ask for omega-3 fields — which is why logged
 * sardines showed no omega-3 data at all despite USDA having good EPA/DHA
 * numbers for the correct record.
 */
function isPlausibleCandidate(queryName: string, candidateDescription: string): boolean {
  const segments = candidateDescription.toLowerCase().split(',').slice(0, 2).map(s => s.trim())
  const combined = segments.join(' ')
  const queryWords = queryName.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (queryWords.length === 0) return true
  return queryWords.some(w => {
    // naive singularization so "sardines" matches FDC's "sardine"
    const singular = w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w
    return combined.includes(w) || combined.includes(singular)
  })
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
/**
 * Normalize butcher's "lean/fat" ratio shorthand (e.g. "90/10", "80/20
 * ground beef") into the wording USDA's own food descriptions use ("90%
 * lean"). FDC's text search doesn't handle the raw "NN/MM" notation well —
 * a query like "90/10 beef" was returning no usable candidates even though
 * the equivalent USDA record exists under "Beef, ground, 90% lean meat /
 * 10% fat, raw". Only the first number is kept (the lean percentage), since
 * that's the half that actually shows up in FDC's naming convention.
 */
function normalizeLeanFatRatio(name: string): string {
  return name.replace(/\b(\d{1,3})\s*\/\s*\d{1,3}\b/, '$1% lean')
}

/**
 * Map foreign/regional cheese names to the English words USDA's own FDC
 * descriptions use, so text search actually finds the matching record.
 * Confirmed live: "parmigiano" and "parmigiano reggiano" returned no usable
 * candidates even though the equivalent record exists under "Cheese,
 * parmesan" -- FDC indexes by the English name, not the Italian one.
 * Checked as whole-word matches (not substrings) so this doesn't clobber
 * unrelated names that happen to contain these words.
 */
const CHEESE_NAME_ALIASES: Record<string, string> = {
  'parmigiano reggiano': 'parmesan',
  'parmigiano-reggiano': 'parmesan',
  'parmigiano': 'parmesan',
  'grana padano': 'parmesan',
  'pecorino romano': 'romano',
  'pecorino': 'romano',
  'mozzarella di bufala': 'mozzarella',
  'fresh mozzarella': 'mozzarella',
}

function normalizeCheeseName(name: string): string {
  const lower = name.toLowerCase()
  for (const [alias, canonical] of Object.entries(CHEESE_NAME_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) {
      return lower.replace(new RegExp(`\\b${alias}\\b`), canonical)
    }
  }
  return name
}

/**
 * Words that mark a USDA record as a processed/concentrated FORM of a food
 * rather than the whole/fresh version -- e.g. "Bananas, dehydrated, or
 * banana powder" outranking "Bananas, raw" for a plain "banana" query.
 * Confirmed live: FDC's relevance search puts the dehydrated record first
 * (score 376 vs raw's lower score), so a bare "130g banana" was coming back
 * as ~450 kcal (dehydrated is ~346 kcal/100g) instead of the correct ~115
 * kcal (raw is ~89 kcal/100g) -- nearly 4x too high.
 */
const PROCESSED_FORM_KEYWORDS = [
  'dehydrated', 'powder', 'dried', 'chips', 'flour', 'juice',
  'concentrate', 'extract', 'syrup', 'crystals', 'flakes', 'freeze-dried',
]

/**
 * Push processed-form candidates (see above) to the back of the candidate
 * list, unless the query itself asked for that form -- "banana chips"
 * should still be able to match "Banana chips". Otherwise-equal ordering
 * (FDC's own relevance rank) is preserved within each group.
 */
function preferWholeForm<T extends { description: string }>(queryName: string, candidates: T[]): T[] {
  const queryLower = queryName.toLowerCase()
  if (PROCESSED_FORM_KEYWORDS.some(k => queryLower.includes(k))) return candidates
  const isProcessed = (c: T) => PROCESSED_FORM_KEYWORDS.some(k => c.description.toLowerCase().includes(k))
  const whole = candidates.filter(c => !isProcessed(c))
  const processed = candidates.filter(isProcessed)
  return [...whole, ...processed]
}

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
  source: 'branded' | 'generic'
} | null> {
  const { name: rawName, portion_g_min, portion_g_max, prep_method } = params
  // Rewrite butcher's-ratio shorthand ("90/10 beef") into USDA's own wording
  // ("90% lean beef") before it ever reaches search — see
  // normalizeLeanFatRatio for why the raw "NN/MM" notation doesn't match.
  const name = normalizeCheeseName(normalizeLeanFatRatio(rawName.trim()))
  const normalizedName = name.toLowerCase().replace(/\s+/g, ' ')

  // ── Step 0: Known-staple override — bypasses unreliable USDA text search ──
  const overrideFdcId = STAPLE_FOOD_OVERRIDES[normalizedName]
  if (overrideFdcId) {
    const per100g = await getFoodNutrients(overrideFdcId)
    if (per100g.energy_kcal && hasCompleteMacroProfile(per100g)) {
      const mid = (portion_g_min + portion_g_max) / 2
      console.log(`✓ Staple override match for "${name}": fdcId ${overrideFdcId}`)
      return {
        fdcId: overrideFdcId,
        nutrients_min: applyPrepAdjustments(scaleNutrients(per100g, portion_g_min), prep_method),
        nutrients_max: applyPrepAdjustments(scaleNutrients(per100g, portion_g_max), prep_method),
        nutrients_mid: applyPrepAdjustments(scaleNutrients(per100g, mid), prep_method),
        source: 'generic',
      }
    }
    console.warn(`Staple override fdcId ${overrideFdcId} for "${name}" failed to return usable data — falling back to search`)
  }

  // ── Step 1: Try branded search first if name looks brand-specific ──────────
  if (looksLikeBrandedFood(name)) {
    const brandedCandidates = await searchBrandedFood(name)
    for (const candidate of brandedCandidates) {
      const per100g = await getFoodNutrients(candidate.fdcId)
      if (!per100g.energy_kcal || per100g.energy_kcal === 0) continue
      if (!hasCompleteMacroProfile(per100g)) {
        console.warn(`Incomplete macro profile for branded "${name}" (${candidate.fdcId}) — skipping candidate`)
        continue
      }
      const mid = (portion_g_min + portion_g_max) / 2
      console.log(`✓ Branded USDA match for "${name}": ${candidate.description} (${candidate.fdcId})`)
      return {
        fdcId: candidate.fdcId,
        nutrients_min: applyPrepAdjustments(scaleNutrients(per100g, portion_g_min), prep_method),
        nutrients_max: applyPrepAdjustments(scaleNutrients(per100g, portion_g_max), prep_method),
        nutrients_mid: applyPrepAdjustments(scaleNutrients(per100g, mid), prep_method),
        source: 'branded',
      }
    }
    console.log(`No branded USDA match for "${name}" — trying Open Food Facts`)

    // ── Step 1b: Open Food Facts — free, open branded/packaged database. ────
    // Only reached because `name` already looked brand-specific AND USDA's
    // own Branded Foods search came up empty; generic foods never reach this.
    const offCandidates = await searchOpenFoodFacts(name)
    for (const candidate of offCandidates) {
      if (!candidate.per100g.energy_kcal || candidate.per100g.energy_kcal === 0) continue
      if (!hasCompleteMacroProfile(candidate.per100g)) {
        console.warn(`Incomplete macro profile for Open Food Facts "${name}" (${candidate.code}) — skipping candidate`)
        continue
      }
      const mid = (portion_g_min + portion_g_max) / 2
      console.log(`✓ Open Food Facts match for "${name}": ${candidate.description} (${candidate.code})`)
      return {
        fdcId: null,
        nutrients_min: applyPrepAdjustments(scaleNutrients(candidate.per100g, portion_g_min), prep_method),
        nutrients_max: applyPrepAdjustments(scaleNutrients(candidate.per100g, portion_g_max), prep_method),
        nutrients_mid: applyPrepAdjustments(scaleNutrients(candidate.per100g, mid), prep_method),
        source: 'branded',
      }
    }
    console.log(`No Open Food Facts match for "${name}" either — falling back to generic`)
  }

  // ── Step 2: Generic USDA search (Foundation / SR Legacy) ──────────────────
  const rawCandidates = await searchFood(name)
  if (rawCandidates.length === 0) return null
  const candidates = preferWholeForm(name, rawCandidates)

  for (const candidate of candidates) {
    // Reject candidates whose primary food category doesn't plausibly match
    // the query (e.g. a "milk" query matching "Cheese, mozzarella, whole milk")
    if (!isPlausibleCandidate(name, candidate.description)) {
      console.warn(`Skipping implausible candidate for "${name}": ${candidate.description}`)
      continue
    }
    const per100g = await getFoodNutrients(candidate.fdcId)
    // Must have energy_kcal specifically — a record without it is useless
    if (!per100g.energy_kcal || per100g.energy_kcal === 0) continue
    // Must also have all three core macros — a record missing one (e.g. no
    // carbohydrate value) skews the breakdown even though kcal looks fine
    if (!hasCompleteMacroProfile(per100g)) {
      console.warn(`Incomplete macro profile for "${name}" (${candidate.fdcId}: ${candidate.description}) — trying next candidate`)
      continue
    }

    const mid = (portion_g_min + portion_g_max) / 2
    return {
      fdcId: candidate.fdcId,
      nutrients_min: applyPrepAdjustments(scaleNutrients(per100g, portion_g_min), prep_method),
      nutrients_max: applyPrepAdjustments(scaleNutrients(per100g, portion_g_max), prep_method),
      nutrients_mid: applyPrepAdjustments(scaleNutrients(per100g, mid), prep_method),
      source: 'generic',
    }
  }

  console.warn(`No nutrient data found for "${name}" across USDA candidates`)
  return null
}
