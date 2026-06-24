import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyseMealPhoto, estimateMixedDishNutrition } from '@/lib/ai/vision'
import { lookupFoodNutrients } from '@/lib/ai/nutrition'

/**
 * POST /api/meals/analyse
 *
 * Body: multipart/form-data
 *   - image: File (JPEG/PNG, max 10MB)
 *   - user_note?: string
 *   - meal_type_hint?: string
 *
 * Returns the structured meal analysis ready to display in the UI.
 * The frontend confirms food items, then calls POST /api/meals to save.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse form data
    const formData = await request.formData()
    const imageFile = formData.get('image') as File | null
    const userNote = formData.get('user_note') as string | undefined
    const mealTypeHint = formData.get('meal_type_hint') as string | undefined

    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    // Validate file size (10MB max)
    if (imageFile.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 400 })
    }

    // 3. Convert to base64 for OpenAI
    const buffer = await imageFile.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // Detect HEIC/HEIF — OpenAI rejects these regardless of MIME type claimed
    // HEIC files start with bytes: 00 00 00 XX 66 74 79 70 (ftyp box)
    const bytes = new Uint8Array(buffer.slice(0, 12))
    const ftypSignature = bytes.slice(4, 8)
    const ftypString = String.fromCharCode(...ftypSignature)
    const subtype = String.fromCharCode(...bytes.slice(8, 12))
    const isHeic = ftypString === 'ftyp' && (
      subtype.startsWith('heic') || subtype.startsWith('heis') ||
      subtype.startsWith('hevc') || subtype.startsWith('mif1') ||
      subtype.startsWith('msf1')
    )
    if (isHeic) {
      return NextResponse.json({
        error: 'iPhone HEIC photos aren\'t supported yet. On your iPhone: Settings → Camera → Formats → Most Compatible. Then retake the photo and try again.',
        code: 'HEIC_NOT_SUPPORTED',
      }, { status: 415 })
    }

    let mimeType = imageFile.type || 'image/jpeg'
    const supportedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!supportedTypes.includes(mimeType.toLowerCase())) {
      mimeType = 'image/jpeg'
    }
    const imageBase64 = `data:${mimeType};base64,${base64}`

    // 4. Call vision model
    const visionResult = await analyseMealPhoto({
      imageBase64,
      userContext: userNote,
      mealTypeHint,
    })

    // 5. Enrich each food with USDA nutrient data
    const enrichedFoods = await Promise.all(
      [...visionResult.foods, ...visionResult.condiments_and_garnishes].map(async (food) => {
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
        }
      })
    )

    // 6. Handle cooking oil as synthetic food item
    let oilItem = null
    if (visionResult.cooking_context.oil_likely_used) {
      const oilName = visionResult.cooking_context.oil_type_guess ?? 'olive oil'
      const oilNutrients = await lookupFoodNutrients({
        name: oilName,
        portion_g_min: visionResult.cooking_context.oil_amount_g_min,
        portion_g_max: visionResult.cooking_context.oil_amount_g_max,
        prep_method: 'raw',
      })

      oilItem = {
        name: oilName,
        is_synthetic_oil: true,
        portion_g_min: visionResult.cooking_context.oil_amount_g_min,
        portion_g_max: visionResult.cooking_context.oil_amount_g_max,
        portion_g_mid: (visionResult.cooking_context.oil_amount_g_min + visionResult.cooking_context.oil_amount_g_max) / 2,
        confidence: visionResult.cooking_context.confidence,
        nutrients_min: oilNutrients?.nutrients_min ?? {},
        nutrients_max: oilNutrients?.nutrients_max ?? {},
        nutrients_mid: oilNutrients?.nutrients_mid ?? {},
      }
    }

    // 7. Handle mixed dishes (second LLM call)
    const enrichedMixedDishes = await Promise.all(
      visionResult.mixed_dishes.map(async (dish) => {
        const nutrients = await estimateMixedDishNutrition({
          name: dish.name,
          likely_base_ingredients: dish.likely_base_ingredients,
          portion_g_min: dish.portion_g_min,
          portion_g_max: dish.portion_g_max,
        })

        return {
          ...dish,
          nutrients,
          confidence_note: 'LLM-estimated — lower confidence than USDA-backed items',
        }
      })
    )

    // 8. Return enriched result (not yet saved — user confirms first)
    return NextResponse.json({
      vision: visionResult,
      enriched_foods: enrichedFoods,
      oil_item: oilItem,
      enriched_mixed_dishes: enrichedMixedDishes,
    })

  } catch (error) {
    console.error('[/api/meals/analyse]', error)
    return NextResponse.json(
      { error: 'Analysis failed. Please try again.' },
      { status: 500 }
    )
  }
}
