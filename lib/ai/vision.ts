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
