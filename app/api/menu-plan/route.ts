import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveFoodMacrosPer100g, estimatePortionBounds } from '@/lib/ai/planner'
import { solveFeasible, findRange, achievableRange, type RangeConstraint, type Bounds } from '@/lib/engine/planner-solver'

type PlannerFoodInput = { name: string; meal: string }

/**
 * POST /api/menu-plan
 *
 * Body: { foods: Array<{ name: string; meal: string }> }
 *
 * Given a menu of foods (no portions -- just what's on the plate for each
 * meal), works out a gram range per food such that ANY quantity choice
 * within that range still leaves room for the rest of the day to land in
 * the user's calorie/macro targets. Whole-day solve, not per-meal -- a
 * lighter breakfast can be balanced by a heavier dinner.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const inputFoods: PlannerFoodInput[] = (body.foods ?? [])
      .map((f: any) => ({ name: String(f.name ?? '').trim(), meal: String(f.meal ?? 'unknown') }))
      .filter((f: PlannerFoodInput) => f.name.length > 0)

    if (inputFoods.length === 0) {
      return NextResponse.json({ error: 'Add at least one food to plan.' }, { status: 400 })
    }
    if (inputFoods.length > 20) {
      return NextResponse.json({ error: 'Please plan 20 foods or fewer at a time.' }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('daily_energy_target, energy_range_low, energy_range_high, sex')
      .eq('id', user.id)
      .single()

    const target = profile?.daily_energy_target ?? 0
    if (!target && !profile?.energy_range_low) {
      return NextResponse.json(
        { error: 'Finish setting up your profile (calorie target) before planning a menu.' },
        { status: 400 }
      )
    }
    const kcalLow = profile?.energy_range_low ?? target * 0.9
    const kcalHigh = profile?.energy_range_high ?? target * 1.1

    // Resolve every food to per-100g macros using the same lookup waterfall
    // (staple overrides, branded USDA, Open Food Facts, generic USDA, GPT
    // fallback) the photo/text logging flow already uses and has been
    // debugged against this session.
    const resolved = await Promise.all(
      inputFoods.map(async f => ({ ...f, macros: await resolveFoodMacrosPer100g(f.name) }))
    )
    const unresolved = resolved.filter(f => !f.macros).map(f => f.name)
    if (unresolved.length > 0) {
      return NextResponse.json({
        error: `Couldn't find nutrition data for: ${unresolved.join(', ')}. Try a more specific name (e.g. "chicken breast" instead of "chicken").`,
      }, { status: 400 })
    }

    const foods = resolved as Array<PlannerFoodInput & { macros: NonNullable<typeof resolved[number]['macros']> }>
    // Bounds are derived from each food's own resolved macros (calorie
    // density), not a manually maintained keyword list -- see planner.ts.
    const bounds: Bounds[] = foods.map(f => estimatePortionBounds(f.name, f.macros))

    // Default macro split derived from the profile's own calorie range --
    // there's no separate macro-target field on the profile yet, so this
    // uses a standard evidence-based band (protein 25-35%, carb 35-50%,
    // fat 25-35% of calories) rather than a single fixed ratio, which keeps
    // it consistent with the calorie range already being a range and not
    // a single number.
    const targets = {
      kcal: [kcalLow, kcalHigh] as [number, number],
      protein: [(kcalLow * 0.25) / 4, (kcalHigh * 0.35) / 4] as [number, number],
      carb: [(kcalLow * 0.35) / 4, (kcalHigh * 0.50) / 4] as [number, number],
      fat: [(kcalLow * 0.25) / 9, (kcalHigh * 0.35) / 9] as [number, number],
    }

    const coeffsFor = (macro: keyof typeof foods[number]['macros']): number[] =>
      foods.map(f => f.macros[macro] / 100)

    const constraints: RangeConstraint[] = [
      { coeffs: coeffsFor('energy_kcal'), lo: targets.kcal[0], hi: targets.kcal[1], label: 'calories' },
      { coeffs: coeffsFor('protein_g'), lo: targets.protein[0], hi: targets.protein[1], label: 'protein' },
      { coeffs: coeffsFor('carbohydrate_g'), lo: targets.carb[0], hi: targets.carb[1], label: 'carbohydrate' },
      { coeffs: coeffsFor('fat_g'), lo: targets.fat[0], hi: targets.fat[1], label: 'fat' },
    ]

    // Cheap, exact pre-check per resource: is the target range even reachable
    // given each food's own box bounds, ignoring the other constraints? If
    // not, we can name the specific shortfall instead of a generic failure.
    const issues: string[] = []
    for (const c of constraints) {
      const achievable = achievableRange(bounds, c.coeffs)
      if (achievable.max < c.lo) {
        issues.push(
          `Max ${c.label} achievable with this list is ${Math.round(achievable.max)}${c.label === 'calories' ? ' kcal' : 'g'}, ` +
          `but your target minimum is ${Math.round(c.lo)}${c.label === 'calories' ? ' kcal' : 'g'}. Try adding a ${suggestionFor(c.label)}.`
        )
      } else if (achievable.min > c.hi) {
        issues.push(
          `Even at the smallest realistic portions, ${c.label} comes to ${Math.round(achievable.min)}${c.label === 'calories' ? ' kcal' : 'g'}, ` +
          `above your target maximum of ${Math.round(c.hi)}${c.label === 'calories' ? ' kcal' : 'g'}. Try removing or reducing a ${suggestionFor(c.label)} food.`
        )
      }
    }
    if (issues.length > 0) {
      return NextResponse.json({ feasible: false, issues })
    }

    // Full cross-check -- the per-resource pre-check above can miss
    // infeasibility caused by correlations between constraints (e.g. every
    // protein source in the list also happens to be fat-heavy).
    const base = solveFeasible(bounds, constraints)
    if (!base.feasible) {
      return NextResponse.json({
        feasible: false,
        issues: ["This combination can't quite hit all your targets together -- try adjusting the foods on the list, or widen your calorie/macro range in your profile."],
      })
    }

    const planned = foods.map((f, i) => {
      const range = findRange(bounds, constraints, i)
      const round5 = (v: number) => Math.max(1, Math.round(v / 5) * 5)
      return {
        name: f.name,
        meal: f.meal,
        per100g: f.macros,
        min_g: range ? round5(range.min) : round5(bounds[i][0]),
        max_g: range ? round5(range.max) : round5(bounds[i][1]),
        suggested_g: range ? round5(range.suggested) : round5((bounds[i][0] + bounds[i][1]) / 2),
      }
    })

    return NextResponse.json({ feasible: true, targets, foods: planned })
  } catch (error) {
    console.error('[/api/menu-plan]', error)
    return NextResponse.json({ error: 'Planning failed. Please try again.' }, { status: 500 })
  }
}

function suggestionFor(label: string | undefined): string {
  switch (label) {
    case 'protein': return 'protein-rich (chicken, fish, eggs, Greek yogurt)'
    case 'carbohydrate': return 'higher-carb (rice, potatoes, bread, fruit)'
    case 'fat': return 'higher-fat (olive oil, nuts, avocado)'
    case 'calories': return 'more energy-dense'
    default: return 'different'
  }
}
