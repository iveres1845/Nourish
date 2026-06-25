import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lookupFoodNutrients } from '@/lib/ai/nutrition'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { 'Accept-Encoding': 'identity' },
})

/**
 * POST /api/meals/analyse-text
 *
 * Body: JSON { description: string, meal_type_hint?: string }
 *
 * Parses a natural-language meal description into structured food items,
 * then enriches each with USDA nutrient data.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const description: string = body.description?.trim()
    const mealTypeHint: string = body.meal_type_hint ?? 'unknown'

    if (!description || description.length < 5) {
      return NextResponse.json({ error: 'Please describe your meal' }, { status: 400 })
    }

    // Ask GPT-4o to parse the description into food items
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a nutrition analysis AI. Given a natural-language meal description, identify every food item and estimate portions.

Return this exact JSON structure:
{
  "meal_description": "1-sentence summary of the meal",
  "meal_type": "${mealTypeHint}",
  "overall_confidence": 0.0–1.0,
  "foods": [
    {
      "name": "specific food name (e.g. 'jasmine rice' not 'rice')",
      "portion_g_min": number,
      "portion_g_max": number,
      "prep_method": "raw|boiled|steamed|sauteed|roasted|grilled|baked|fried|unknown",
      "confidence": 0.0–1.0
    }
  ],
  "oil_likely_used": boolean,
  "oil_type_guess": "olive oil|vegetable oil|butter|null",
  "oil_amount_g_min": number,
  "oil_amount_g_max": number
}

Portion estimation rules:
- "a cup of rice" = ~180–200g cooked
- "half plate of salad" = ~120–180g vegetables
- "quarter plate of chicken thighs" = ~120–160g cooked
- 1 tablespoon of oil/dressing = ~13–15g
- Be realistic, not conservative — people tend to eat more than label serving sizes
- If oil/dressing is mentioned, include it in the oil fields
- Set confidence 0.6–0.8 for text-described meals (lower than photo analysis)`,
        },
        {
          role: 'user',
          content: `Meal description: "${description}"`,
        },
      ],
    })

    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}')

    // Enrich each food with USDA nutrient data (same as photo route)
    const enrichedFoods = await Promise.all(
      (parsed.foods ?? []).map(async (food: any) => {
        const nutrients = await lookupFoodNutrients({
          name: food.name,
          portion_g_min: food.portion_g_min,
          portion_g_max: food.portion_g_max,
          prep_method: food.prep_method,
        })
        return {
          ...food,
          portion_g_mid: (food.portion_g_min + food.portion_g_max) / 2,
          fdc_id: nutrients?.fdcId ?? null,
          nutrients_min: nutrients?.nutrients_min ?? {},
          nutrients_max: nutrients?.nutrients_max ?? {},
          nutrients_mid: nutrients?.nutrients_mid ?? {},
          is_synthetic_oil: false,
        }
      })
    )

    // Oil as synthetic item
    let oilItem = null
    if (parsed.oil_likely_used && parsed.oil_amount_g_max > 0) {
      const oilName = parsed.oil_type_guess ?? 'olive oil'
      const oilNutrients = await lookupFoodNutrients({
        name: oilName,
        portion_g_min: parsed.oil_amount_g_min ?? 5,
        portion_g_max: parsed.oil_amount_g_max ?? 15,
        prep_method: 'raw',
      })
      oilItem = {
        name: oilName,
        is_synthetic_oil: true,
        portion_g_min: parsed.oil_amount_g_min ?? 5,
        portion_g_max: parsed.oil_amount_g_max ?? 15,
        portion_g_mid: ((parsed.oil_amount_g_min ?? 5) + (parsed.oil_amount_g_max ?? 15)) / 2,
        confidence: 0.6,
        nutrients_min: oilNutrients?.nutrients_min ?? {},
        nutrients_max: oilNutrients?.nutrients_max ?? {},
        nutrients_mid: oilNutrients?.nutrients_mid ?? {},
      }
    }

    return NextResponse.json({
      vision: {
        meal_type: parsed.meal_type ?? mealTypeHint,
        overall_confidence: parsed.overall_confidence ?? 0.65,
        meal_description: parsed.meal_description ?? description,
      },
      enriched_foods: enrichedFoods,
      oil_item: oilItem,
      enriched_mixed_dishes: [],
      text_mode: true,
    })

  } catch (error) {
    console.error('[/api/meals/analyse-text]', error)
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 })
  }
}
