import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── GET /api/meals/[id] — fetch meal + food items ─────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: meal, error: mealError } = await supabase
      .from('meals')
      .select('*, food_items(*)')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (mealError || !meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    return NextResponse.json({ meal })
  } catch (err) {
    console.error('[GET /api/meals/[id]]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH /api/meals/[id] — update food item portions ────────────────────────
// Body: { food_items: Array<{ id: string; portion_g_mid: number; portion_g_min: number; portion_g_max: number; nutrients_mid: Record<string,number>; nutrients_min: Record<string,number>; nutrients_max: Record<string,number> }> }
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify meal belongs to user
    const { data: meal } = await supabase
      .from('meals')
      .select('id, meal_date')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (!meal) return NextResponse.json({ error: 'Meal not found' }, { status: 404 })

    const body = await request.json()
    const updatedItems: Array<{
      id: string
      portion_g_mid: number
      portion_g_min: number
      portion_g_max: number
      nutrients_mid: Record<string, number>
      nutrients_min: Record<string, number>
      nutrients_max: Record<string, number>
    }> = body.food_items ?? []

    // Update each food item
    for (const item of updatedItems) {
      await supabase
        .from('food_items')
        .update({
          portion_g_mid: item.portion_g_mid,
          portion_g_min: item.portion_g_min,
          portion_g_max: item.portion_g_max,
          nutrients_mid: item.nutrients_mid,
          nutrients_min: item.nutrients_min,
          nutrients_max: item.nutrients_max,
        })
        .eq('id', item.id)
        .eq('meal_id', params.id)
    }

    // Recalculate meal nutrient totals from updated food items
    const { data: allItems } = await supabase
      .from('food_items')
      .select('nutrients_mid')
      .eq('meal_id', params.id)

    const newTotals: Record<string, number> = {}
    for (const fi of (allItems ?? [])) {
      for (const [k, v] of Object.entries(fi.nutrients_mid ?? {})) {
        newTotals[k] = (newTotals[k] ?? 0) + (v as number)
      }
    }

    await supabase
      .from('meals')
      .update({ nutrient_totals_mid: newTotals })
      .eq('id', params.id)

    // Recalculate daily_logs for this date by re-summing all meals
    const mealDate = meal.meal_date
    const { data: dayMeals } = await supabase
      .from('meals')
      .select('nutrient_totals_mid')
      .eq('user_id', user.id)
      .eq('meal_date', mealDate)

    const dayTotals: Record<string, number> = {}
    for (const dm of (dayMeals ?? [])) {
      // Use updated totals for THIS meal, stored totals for others
      const src = dm.nutrient_totals_mid === meal.id ? newTotals : (dm.nutrient_totals_mid ?? {})
      for (const [k, v] of Object.entries(src)) {
        dayTotals[k] = (dayTotals[k] ?? 0) + (v as number)
      }
    }

    // Re-fetch to get the latest totals (including this update)
    const { data: freshMeals } = await supabase
      .from('meals')
      .select('nutrient_totals_mid')
      .eq('user_id', user.id)
      .eq('meal_date', mealDate)

    const freshTotals: Record<string, number> = {}
    for (const fm of (freshMeals ?? [])) {
      for (const [k, v] of Object.entries(fm.nutrient_totals_mid ?? {})) {
        freshTotals[k] = (freshTotals[k] ?? 0) + (v as number)
      }
    }

    await supabase
      .from('daily_logs')
      .upsert({
        user_id: user.id,
        date: mealDate,
        nutrient_totals: freshTotals,
      }, { onConflict: 'user_id,date' })

    return NextResponse.json({ ok: true, nutrient_totals_mid: newTotals })
  } catch (err) {
    console.error('[PATCH /api/meals/[id]]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
