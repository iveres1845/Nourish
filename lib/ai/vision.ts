import OpenAI from 'openai'
import { VisionResponse } from '@/lib/types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { 'Accept-Encoding': 'identity' },
})

const SYSTEM_PROMPT = `You are a nutrition analysis AI. Given a meal photo, identify every visible food item and return a structured JSON response.

## Portion estimation — critical
Estimate accurate portions. The midpoint of your min/max range should be your honest best estimate — do not skew high or low. Use the range to express genuine uncertainty, not to pad numbers:
- Waffles vary a lot by type — a thin frozen waffle (e.g. Eggo) is ~35–40g; a thick homemade or Belgian waffle is 80–120g. Estimate based on visible thickness and size, and multiply by piece count.
- A spread (jam, butter, peanut butter) visibly applied to each piece: 10–15g per piece. Multiply by the number of pieces — don't assume one serving covers all.
- A slice of sandwich bread = 30–40g. Thick-cut = 50g.
- A palm-sized piece of meat or fish = 110–160g.
- A home serving of pasta or rice = 160–220g cooked.
- When uncertain about portion size, let the min/max range reflect that uncertainty — don't resolve it by picking the higher end.

## What to identify
- Every distinct food item visible
- Condiments, spreads, sauces, and dressings separately
- Cooking method (affects nutrient retention)
- Whether cooking oil was likely used

Return this exact JSON structure:
{
  "meal_type": "breakfast|lunch|dinner|snack|unknown",
  "meal_description": "brief 1-sentence description",
  "overall_confidence": 0.0–1.0,
  "foods": [
    {
      "name": "string (specific: 'buttermilk waffle' not 'waffle')",
      "portion_g_min": number,
      "portion_g_max": number,
      "prep_method": "string",
      "confidence": number,
      "visible_quantity": "string (e.g. '4 waffles', '2 slices')",
      "is_plant": boolean,
      "plant_name": "string or null"
    }
  ],
  "condiments_and_garnishes": [
    {
      "name": "string",
      "portion_g_min": number,
      "portion_g_max": number,
      "prep_method": "raw",
      "confidence": number,
      "visible_quantity": "string (e.g. '~4 tbsp across 4 waffles')",
      "is_plant": false,
      "plant_name": null
    }
  ],
  "mixed_dishes": [
    {
      "name": "string",
      "portion_g_min": number,
      "portion_g_max": number,
      "likely_base_ingredients": ["string"],
      "confidence": number
    }
  ],
  "cooking_context": {
    "oil_likely_used": boolean,
    "oil_type_guess": "olive oil|vegetable oil|butter|coconut oil|unknown|null",
    "oil_amount_g_min": number,
    "oil_amount_g_max": number,
    "confidence": number
  }
}

## Rules
- Use specific food names for accurate USDA lookup ("strawberry jam" not "jam", "maple syrup" not "syrup")
- When you see multiple pieces (4 waffles, 3 slices), the portion_g values should reflect the TOTAL for all pieces
- Aim for accuracy. A slight overestimate is better than a significant underestimate.
- Include everything visible, even low-confidence items
- **Brand names** — if the user note identifies a specific brand or product, use the full brand + product name in the food item's name field. Examples:
  - Note says "Fairlife protein shake" → name = "Fairlife Core Power protein shake"
  - Note says "Mission Carb Balance tortillas" → name = "Mission Carb Balance flour tortilla"
  - Note says "Chobani Greek yogurt" → name = "Chobani plain Greek yogurt"
  - This is critical — branded products have very different nutrition profiles than generics
- Return only valid JSON, no explanation`

/**
 * Analyse a meal photo using GPT-4o Vision.
 * Returns the structured VisionResponse or throws on failure.
 *
 * @param imageBase64 - base64-encoded image (with data URI prefix)
 * @param userContext - optional note from the user ("I added extra olive oil")
 * @param mealTypeHint - optional hint from time of day ("breakfast")
 */
export async function analyseMealPhoto(params: {
  imageBase64: string
  userContext?: string
  mealTypeHint?: string
}): Promise<VisionResponse> {
  const { imageBase64, userContext, mealTypeHint } = params

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: buildUserPrompt(userContext, mealTypeHint),
    },
    {
      type: 'image_url',
      image_url: {
        url: imageBase64,
        detail: 'auto',
      },
    },
  ]

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_tokens: 1500,
    temperature: 0.2,  // low temp — we want consistent, conservative estimates
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content
  if (!raw) throw new Error('Vision model returned empty response')

  const parsed = JSON.parse(raw) as VisionResponse

  // Basic sanity check
  if (!parsed.foods && !parsed.mixed_dishes) {
    throw new Error('Vision model response missing foods array')
  }

  return parsed
}

function buildUserPrompt(userContext?: string, mealTypeHint?: string): string {
  let prompt = 'Analyse this meal photo and return the structured JSON response.'

  if (userContext) {
    prompt += `\n\nUser note: "${userContext}"`
    // Check if note likely contains brand mentions
    const brandPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+|fairlife|mission|chobani|oikos|fage|siggi|rx bar|rxbar|kind bar|quest|clif|larabar|skyr|activia|yoplait|tropicana|simply|naked juice|muscle milk|premier protein|core power|garden of life|orgain|vega|sunwarrior)\b/i
    if (brandPattern.test(userContext)) {
      prompt += '\n\n⚠️ IMPORTANT: The user note mentions a specific brand. Use the full brand + product name in the food item name field for accurate nutrition lookup.'
    }
  }
  if (mealTypeHint) {
    prompt += `\n\nMeal time: ${mealTypeHint}`
  }

  prompt += '\n\nReturn only valid JSON. No preamble, no explanation.'
  return prompt
}

/**
 * For mixed dishes that can't be decomposed by vision,
 * call a text-only LLM to estimate nutrition.
 */
export async function estimateMixedDishNutrition(params: {
  name: string
  likely_base_ingredients: string[]
  portion_g_min: number
  portion_g_max: number
}): Promise<Record<string, { min: number; max: number }>> {
  const { name, likely_base_ingredients, portion_g_min, portion_g_max } = params

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',  // cheaper for text-only estimation
    messages: [
      {
        role: 'user',
        content: `Estimate the typical nutritional breakdown of a ${portion_g_min}–${portion_g_max}g serving of "${name}", which likely contains: ${likely_base_ingredients.join(', ')}.

Return macro and key micronutrient estimates as min/max ranges in JSON:
{
  "energy_kcal": { "min": 0, "max": 0 },
  "protein_g": { "min": 0, "max": 0 },
  "fat_g": { "min": 0, "max": 0 },
  "carbohydrate_g": { "min": 0, "max": 0 },
  "fiber_g": { "min": 0, "max": 0 },
  "iron_mg": { "min": 0, "max": 0 },
  "vitamin_c_mg": { "min": 0, "max": 0 },
  "calcium_mg": { "min": 0, "max": 0 },
  "zinc_mg": { "min": 0, "max": 0 }
}

JSON only. No explanation.`,
      },
    ],
    max_tokens: 400,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content
  if (!raw) throw new Error('Nutrition estimation returned empty response')
  return JSON.parse(raw)
}

/**
 * GPT-4o-mini fallback: estimate per-100g nutrients for a single food when
 * USDA lookup returns no usable data (e.g. gnocchi, niche foods, branded items
 * not in FDC). Returns the same flat Record shape as getFoodNutrients().
 */
export async function estimateFoodNutrientsPer100g(foodName: string): Promise<Record<string, number>> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Give me the nutritional content of "${foodName}" per 100 GRAMS (not per serving, not per cup, not per piece — strictly per 100g of the food as consumed).

Reference checks:
- Whole milk per 100g ≈ 61 kcal, 3.3g protein, 3.5g fat, 4.8g carbohydrate
- Cooked white rice per 100g ≈ 130 kcal, 2.7g protein, 0.3g fat, 28g carbohydrate
- Chicken breast cooked per 100g ≈ 165 kcal, 31g protein, 3.6g fat, 0g carbohydrate
- Olive oil per 100g ≈ 884 kcal, 0g protein, 100g fat, 0g carbohydrate

Every food has protein, fat, AND carbohydrate — even foods that are low in one (e.g. milk is low in fat, chicken is ~0 carbohydrate). Never leave carbohydrate_g at 0 for foods that genuinely contain carbs (dairy, fruit, grains, legumes, vegetables).

Return ONLY a JSON object with numeric values — all per 100g:
{
  "energy_kcal": 0,
  "protein_g": 0,
  "fat_g": 0,
  "carbohydrate_g": 0,
  "fiber_g": 0,
  "sugar_g": 0,
  "calcium_mg": 0,
  "iron_mg": 0,
  "magnesium_mg": 0,
  "potassium_mg": 0,
  "sodium_mg": 0,
  "zinc_mg": 0,
  "vitamin_c_mg": 0,
  "vitamin_a_mcg": 0,
  "folate_mcg": 0,
  "saturated_fat_g": 0
}
JSON only. energy_kcal must be ≤ 900 (nothing edible exceeds 900 kcal/100g).`,
      }],
      max_tokens: 300,
    })
    const raw = response.choices[0]?.message?.content
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // Ensure all values are numbers
    const result: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && v >= 0) result[k] = v
    }
    console.log(`✓ GPT fallback nutrition for "${foodName}": ${result.energy_kcal} kcal/100g`)
    return result
  } catch {
    console.warn(`GPT nutrition fallback failed for "${foodName}"`)
    return {}
  }
}

/**
 * Corrected per-100g macro/energy values GPT proposes for a food whose
 * USDA- or GPT-sourced estimate failed the plausibility check. `null` means
 * the original estimate passed and needs no correction.
 */
export type MacroCorrection = {
  energy_kcal: number
  protein_g: number
  fat_g: number
  carbohydrate_g: number
} | null

/**
 * Sanity-check all enriched food items in one GPT call, checking TWO
 * independent things per food:
 *
 *  1. Magnitude — is kcal/100g roughly right for this food type?
 *  2. Composition — does the protein/fat/carbohydrate SPLIT make sense for
 *     this specific food? This is the check that catches a food silently
 *     matched to the wrong database record: e.g. "Whole Milk" resolving to
 *     a mozzarella cheese record (protein=fat≈11g, carb≈1g instead of
 *     milk's balanced ~8/8/12g split), or "Whey Protein" resolving to a
 *     carb-heavy record instead of its expected ~70-90g protein/100g. Both
 *     of those cases can still sum to a plausible total kcal via 4/4/9
 *     Atwater math, so a magnitude-only check (the old version of this
 *     function) doesn't catch them — only checking the ratio does.
 *
 * When either check fails, GPT returns its own corrected per-100g estimate
 * for that food (not just a flag) — the caller scales this to the actual
 * logged portion and uses it in place of the original min/mid/max values.
 * Silently skips (no corrections) if GPT fails — better an uncorrected
 * estimate than a broken meal log.
 */
export async function validateNutritionEstimates(
  foods: Array<{ name: string; portion_g_mid: number; nutrients_mid: Record<string, number> }>
): Promise<MacroCorrection[]> {
  const results: MacroCorrection[] = foods.map(() => null)
  if (foods.length === 0) return results

  try {
    const foodList = foods
      .map((f, i) => {
        const grams = f.portion_g_mid || 1
        const per100 = (key: string) => Math.round(((f.nutrients_mid[key] ?? 0) / grams) * 1000) / 10
        return `${i + 1}. ${f.name} — logged as ${Math.round(grams)}g total. Current per-100g: ${per100('energy_kcal')} kcal, ${per100('protein_g')}g protein, ${per100('fat_g')}g fat, ${per100('carbohydrate_g')}g carbohydrate`
      })
      .join('\n')

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are a nutrition fact-checker. For each food below, check its per-100g values against TWO independent things:

1. MAGNITUDE — is kcal/100g roughly right for this food type? Reference (kcal/100g): milk/juice/broth 30–70, cooked vegetables 15–80, fruit 40–80, cooked grains/pasta/rice 100–180, cooked legumes 80–150, bread/tortilla 200–280, cooked meat/fish/poultry 100–300, eggs 140–160, cheese 280–420, yogurt 50–120, nuts/seeds 500–650, oils/butter 700–900, protein powder 350–420.

2. COMPOSITION — does the protein/fat/carbohydrate SPLIT make sense for this specific food, regardless of whether the total kcal looks right? This is the important check: a food can be silently matched to the WRONG database record and still sum to a plausible total kcal, while the macro split is nonsensical for what the food actually is. Examples: whey protein powder should be protein-dominant (~70–90g protein per 100g, low carb/fat) — if it instead shows low protein and high carbs, that's wrong even if kcal/100g looks fine. Milk should have a roughly balanced split (~3g protein, ~3g fat, ~5g carb per 100g) — if it instead shows cheese-like high protein+fat with near-zero carbs, that's wrong. A lean meat showing significant carbs is wrong. Olive oil showing anything but ~0g protein/carb and ~100g fat is wrong.

Foods to check:
${foodList}

For each food that fails EITHER check, respond with your own best correct per-100g estimate (energy_kcal, protein_g, fat_g, carbohydrate_g) for what that food should actually contain — replace it, don't just flag it.

Return JSON: { "corrections": [ { "index": 1, "per_100g": { "energy_kcal": 400, "protein_g": 80, "fat_g": 6, "carbohydrate_g": 8 }, "reason": "whey protein powder should be protein-dominant, not carb-dominant" } ] }
Only include foods that actually need correction. Empty array if all look fine.`,
      }],
      max_tokens: 600,
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) return results
    const parsed = JSON.parse(raw)

    for (const correction of (parsed.corrections ?? [])) {
      const idx = (correction.index ?? 0) - 1  // 1-based to 0-based
      if (idx < 0 || idx >= foods.length) continue
      const p = correction.per_100g
      if (
        !p ||
        typeof p.energy_kcal !== 'number' || typeof p.protein_g !== 'number' ||
        typeof p.fat_g !== 'number' || typeof p.carbohydrate_g !== 'number' ||
        p.energy_kcal <= 0 || p.energy_kcal > 900  // never trust GPT's own correction blindly either
      ) continue

      results[idx] = {
        energy_kcal: p.energy_kcal,
        protein_g: p.protein_g,
        fat_g: p.fat_g,
        carbohydrate_g: p.carbohydrate_g,
      }
      console.log(`✓ Nutrition correction for "${foods[idx].name}": ${correction.reason} — now ${p.energy_kcal}kcal / ${p.protein_g}p / ${p.fat_g}f / ${p.carbohydrate_g}c per 100g`)
    }

    return results
  } catch (err) {
    console.warn('Nutrition validation failed — using uncorrected estimates:', err)
    return results
  }
}
