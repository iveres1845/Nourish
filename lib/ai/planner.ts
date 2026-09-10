/**
 * Menu planner support: resolve a bare food name (no portion, no photo) to
 * per-100g macros, and estimate a sane gram range for that food so the
 * solver doesn't propose things like "600g of jam".
 */

import { lookupFoodNutrients } from './nutrition'

export type PlannerMacros = Record<string, number> & {
    // A real-world "standard serving" in grams, pulled from USDA's own
    // household-measure data when available. Used to round the menu
    // planner's suggested portion to something that reads like an actual
    // serving instead of a raw solver output. Undefined when the food came
    // from a source without portion data (branded/Open Food Facts matches,
    // or a USDA record with none listed).
    serving_g?: number
}

/**
   * Resolve a food name to per-100g macros using the exact same
   * staple-override -> branded USDA -> Open Food Facts -> generic USDA -> GPT
   * fallback waterfall the photo/text logging flow uses, so this feature
   * inherits every accuracy fix already made there (plausibility filtering,
   * complete-macro-profile checks, unit conversions, etc.) instead of
   * re-implementing food lookup from scratch.
   *
   * Portion is fixed at 100/100 with prep_method 'raw' -- 'raw' applies zero
   * nutrient-retention adjustment (see PREP_ADJUSTMENTS in nutrition.ts), and
   * a 100g portion has a scale factor of 1, so nutrients_mid comes back as
   * the untouched per-100g values, which is exactly the coefficient the
   * solver needs for each gram of that food.
   */
export async function resolveFoodMacrosPer100g(name: string): Promise<PlannerMacros | null> {
    const trimmed = name.trim()
    if (!trimmed) return null

  const result = await lookupFoodNutrients({
        name: trimmed,
        portion_g_min: 100,
        portion_g_max: 100,
        prep_method: 'raw',
  })
    if (!result) return null

  const n = result.nutrients_mid
    if (
          typeof n.energy_kcal !== 'number' ||
          typeof n.protein_g !== 'number' ||
          typeof n.fat_g !== 'number' ||
          typeof n.carbohydrate_g !== 'number'
        ) {
          return null
    }

  // Carry the FULL resolved nutrient profile (not just the 4 macros) so
  // menu-planner-saved meals retain fiber/vitamins/minerals just like meals
  // logged via photo/text -- otherwise Nudge's nutrient insights silently
  // understate micronutrient intake on any day containing a planned meal.
  // serving_g now comes from the same lookupFoodNutrients call (via
  // getFoodDetail in nutrition.ts) instead of a separate USDA fetch, so a
  // multi-food plan no longer doubles its request volume to the FDC API.
  return {
        ...n,
        serving_g: result.serving_g ?? undefined,
  }
}

// --- Portion sanity bounds --------------------------------------------------
// Bounds are DERIVED from the food's own resolved nutrition profile instead
// of a manually maintained keyword-to-category list. That means "sourdough"
// vs "sourdough bread" vs "wonder bread", or "90/10 beef" vs "lean ground
// beef" vs "ribeye", all get sensible bounds automatically -- there's no
// keyword list to keep extending by hand every time a new food or phrasing
// shows up.
//
// MIN is calculated from calorie density: a calorie-dense food (oil, honey,
// nut butter) gets a small floor because even a small gram amount is
// nutritionally meaningful, while a calorie-sparse food (leafy greens,
// broth) gets a larger floor -- capped at MAX_FLOOR_G so watery vegetables
// don't get pushed to an absurd minimum. This replaces per-category minimums
// with one formula that works for any food, known or not.
//
// MAX is a single high ceiling shared by everything -- it exists purely so
// the solver's box-constrained arithmetic has a finite number to work with,
// not to cap how much of a food the solver can actually recommend. A single
// food can scale up to cover an entire macro target on its own when it's
// the only source of that macro -- the solver decides the real number.
//
// The one deliberate exception is eggs: they're bought and eaten as whole
// units, so a calorie-density floor would let the solver suggest something
// like "12g of egg" -- numerically fine, but it reads as broken. Keeping a
// single explicit override for that one count-like case is simpler than
// trying to generalize "sold in discrete units" into the formula.

const MAX_BOUND = 2000
const TARGET_FLOOR_KCAL = 15
const MIN_FLOOR_G = 5
const MAX_FLOOR_G = 60
const EGG_BOUNDS: [number, number] = [40, MAX_BOUND]

export function estimatePortionBounds(name: string, macros: PlannerMacros): [number, number] {
    if (name.toLowerCase().includes('egg')) return EGG_BOUNDS

  const kcalPerGram = macros.energy_kcal / 100
    if (!(kcalPerGram > 0)) return [MAX_FLOOR_G, MAX_BOUND]

  const rawMin = TARGET_FLOOR_KCAL / kcalPerGram
    const min = Math.round(Math.min(MAX_FLOOR_G, Math.max(MIN_FLOOR_G, rawMin)))
    return [min, MAX_BOUND]
}
