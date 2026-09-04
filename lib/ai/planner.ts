/**
 * Menu planner support: resolve a bare food name (no portion, no photo) to
 * per-100g macros, and estimate a sane gram range for that food so the
 * solver doesn't propose things like "600g of jam".
 */

import { lookupFoodNutrients } from './nutrition'

export type PlannerMacros = {
    energy_kcal: number
    protein_g: number
    fat_g: number
    carbohydrate_g: number
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

  return {
        energy_kcal: n.energy_kcal,
        protein_g: n.protein_g,
        fat_g: n.fat_g,
        carbohydrate_g: n.carbohydrate_g,
  }
}

// --- Portion sanity bounds --------------------------------------------------
// Keyword-classified [min, max] gram bounds per food category. Only the
// MIN keeps a food from reading as an unrealistically tiny portion (e.g.
// "5g of chicken"); there is no meaningful MAX anymore -- every category
// shares MAX_BOUND, a single very high ceiling that exists purely so the
// solver's box-constrained arithmetic has a finite number to work with,
// not to cap how much of a food the solver can actually recommend. A
// single food (sourdough, honey, whatever) can scale up to cover an
// entire macro target on its own when it's the only source of that
// macro -- the solver decides the real number, this file just gives it
// room to do that.
//
// Matching is substring-based on the lowercased food name, so variant
// phrasings of the same food (e.g. "90/10 beef", "lean ground beef") match
// automatically as long as they share the core keyword ("beef"). Add
// alternate spellings/names to a category's keyword list (e.g. "sourdough"
// alongside "bread") to fold them into the same bounds rather than falling
// through to DEFAULT_BOUNDS. Checked in order -- first match wins -- so
// more specific overrides (e.g. "egg") should come before broader
// categories.

type BoundRule = { keywords: string[]; min: number }

const MAX_BOUND = 2000

const BOUND_RULES: BoundRule[] = [
    // Small, count-like items
  { keywords: ['egg', 'eggs'], min: 40 },

    // Condiments, spreads, oils -- still start small, but can act as a real
    // carb/fat source when it's the only one (e.g. honey as the sole carb
    // source in a meal)
  { keywords: [
        'jam', 'jelly', 'honey', 'syrup', 'butter', 'peanut butter', 'almond butter',
        'nut butter', 'mayo', 'mayonnaise', 'dressing', 'oil', 'olive oil', 'sauce',
        'ketchup', 'mustard', 'hummus', 'nutella',
      ], min: 5 },

    // Nuts, seeds
  { keywords: ['nuts', 'almonds', 'walnuts', 'cashews', 'peanuts', 'pistachios', 'seeds', 'chia', 'flaxseed'],
      min: 10 },

    // Protein powders / bars
  { keywords: ['protein powder', 'whey', 'casein', 'protein bar'], min: 20 },

    // Cheese
  { keywords: ['cheese'], min: 10 },

    // Dairy (milk, yogurt)
  { keywords: ['milk', 'yogurt', 'yoghurt', 'kefir'], min: 50 },

    // Bread / wraps -- includes alternate names like "sourdough" on its own
    // (not just "sourdough bread") so they share bounds with the rest of
    // the category instead of falling through to the default
  { keywords: [
        'bread', 'toast', 'tortilla', 'wrap', 'pita', 'bagel', 'bun', 'sourdough',
        'baguette', 'ciabatta', 'rye bread', 'ryebread', 'brioche',
      ], min: 20 },

    // Animal protein mains -- covers phrasing variants ("90/10 beef",
    // "lean ground beef", "ground turkey") via the shared core keyword
  { keywords: [
        'chicken', 'beef', 'steak', 'pork', 'lamb', 'turkey', 'duck', 'bacon',
        'salmon', 'tuna', 'cod', 'tilapia', 'shrimp', 'prawn', 'fish', 'sardine',
        'tofu', 'tempeh', 'seitan',
      ], min: 50 },

    // Grains / starches / legumes
  { keywords: [
        'rice', 'pasta', 'noodles', 'quinoa', 'oats', 'oatmeal', 'barley', 'couscous',
        'potato', 'potatoes', 'sweet potato', 'gnocchi', 'lentils', 'chickpeas', 'beans',
      ], min: 30 },

    // Fruit
  { keywords: [
        'fruit', 'apple', 'banana', 'orange', 'grape', 'strawberry', 'blueberry',
        'mango', 'pear', 'peach', 'plum', 'cherry', 'kiwi', 'melon', 'watermelon',
        'pineapple', 'berries',
      ], min: 50 },

    // Vegetables
  { keywords: [
        'vegetable', 'broccoli', 'asparagus', 'spinach', 'kale', 'carrot', 'onion',
        'zucchini', 'cucumber', 'celery', 'lettuce', 'cabbage', 'cauliflower',
        'mushroom', 'peas', 'salad', 'tomato', 'pepper',
      ], min: 30 },
]

const DEFAULT_MIN = 20

export function estimatePortionBounds(name: string): [number, number] {
    const lower = name.toLowerCase()
    for (const rule of BOUND_RULES) {
          if (rule.keywords.some(k => lower.includes(k))) return [rule.min, MAX_BOUND]
    }
    return [DEFAULT_MIN, MAX_BOUND]
}
