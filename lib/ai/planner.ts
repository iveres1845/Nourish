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
// Keyword-classified [min, max] gram bounds per food category, used so the
// solver's output ranges stay realistic (e.g. never "5g of chicken" or
// "500g of jam") instead of only being constrained by the macro targets.
// Checked in order -- first match wins -- so more specific overrides (e.g.
// "egg") should come before broader categories.

type BoundRule = { keywords: string[]; bounds: [number, number] }

const BOUND_RULES: BoundRule[] = [
    // Small, count-like items
  { keywords: ['egg', 'eggs'], bounds: [40, 150] },

    // Condiments, spreads, oils -- small quantities even at generous portions
  { keywords: [
          'jam', 'jelly', 'honey', 'syrup', 'butter', 'peanut butter', 'almond butter',
          'nut butter', 'mayo', 'mayonnaise', 'dressing', 'oil', 'olive oil', 'sauce',
          'ketchup', 'mustard', 'hummus', 'nutella',
        ], bounds: [5, 50] },

    // Nuts, seeds -- energy-dense, eaten in small handfuls
  { keywords: ['nuts', 'almonds', 'walnuts', 'cashews', 'peanuts', 'pistachios', 'seeds', 'chia', 'flaxseed'],
       bounds: [10, 60] },

    // Protein powders / bars
  { keywords: ['protein powder', 'whey', 'casein', 'protein bar'], bounds: [20, 60] },

    // Cheese -- dense, eaten in smaller amounts than other dairy
  { keywords: ['cheese'], bounds: [10, 120] },

    // Dairy (milk, yogurt)
  { keywords: ['milk', 'yogurt', 'yoghurt', 'kefir'], bounds: [50, 400] },

    // Bread / wraps -- count-like, capped lower than loose grains
  { keywords: ['bread', 'toast', 'tortilla', 'wrap', 'pita', 'bagel', 'bun'], bounds: [20, 150] },

    // Animal protein mains
  { keywords: [
          'chicken', 'beef', 'steak', 'pork', 'lamb', 'turkey', 'duck', 'bacon',
          'salmon', 'tuna', 'cod', 'tilapia', 'shrimp', 'prawn', 'fish', 'sardine',
          'tofu', 'tempeh', 'seitan',
        ], bounds: [50, 300] },

    // Grains / starches / legumes
  { keywords: [
          'rice', 'pasta', 'noodles', 'quinoa', 'oats', 'oatmeal', 'barley', 'couscous',
          'potato', 'potatoes', 'sweet potato', 'gnocchi', 'lentils', 'chickpeas', 'beans',
        ], bounds: [30, 350] },

    // Fruit
  { keywords: [
          'fruit', 'apple', 'banana', 'orange', 'grape', 'strawberry', 'blueberry',
          'mango', 'pear', 'peach', 'plum', 'cherry', 'kiwi', 'melon', 'watermelon',
          'pineapple', 'berries',
        ], bounds: [50, 300] },

    // Vegetables
  { keywords: [
          'vegetable', 'broccoli', 'asparagus', 'spinach', 'kale', 'carrot', 'onion',
          'zucchini', 'cucumber', 'celery', 'lettuce', 'cabbage', 'cauliflower',
          'mushroom', 'peas', 'salad', 'tomato', 'pepper',
        ], bounds: [30, 350] },
  ]

const DEFAULT_BOUNDS: [number, number] = [20, 300]

export function estimatePortionBounds(name: string): [number, number] {
    const lower = name.toLowerCase()
    for (const rule of BOUND_RULES) {
          if (rule.keywords.some(k => lower.includes(k))) return rule.bounds
    }
    return DEFAULT_BOUNDS
}
