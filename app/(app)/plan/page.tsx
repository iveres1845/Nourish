'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { localDate } from '@/lib/utils/date'

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
}

type PlannedFood = {
  name: string
  meal: string
  per100g: { energy_kcal: number; protein_g: number; fat_g: number; carbohydrate_g: number }
  min_g: number
  max_g: number
  suggested_g: number
}

type PlanResponse =
  | { feasible: true; targets: Record<string, [number, number]>; foods: PlannedFood[] }
  | { feasible: false; issues: string[] }
  | { error: string }

export default function PlanMenuPage() {
  const router = useRouter()
  const supabase = createClient()

  const [stage, setStage] = useState<'input' | 'generating' | 'result' | 'saving' | 'done'>('input')
  const [mealInputs, setMealInputs] = useState<Record<MealType, string[]>>({
    breakfast: [], lunch: [], dinner: [], snack: [],
  })
  const [draft, setDraft] = useState<Record<MealType, string>>({
    breakfast: '', lunch: '', dinner: '', snack: '',
  })
  const [date, setDate] = useState(localDate())
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<string[] | null>(null)
  const [planned, setPlanned] = useState<PlannedFood[]>([])
  const [quantities, setQuantities] = useState<Record<number, number>>({})

  function addFood(meal: MealType) {
    const name = draft[meal].trim()
    if (!name) return
    setMealInputs(prev => ({ ...prev, [meal]: [...prev[meal], name] }))
    setDraft(prev => ({ ...prev, [meal]: '' }))
  }

  function removeFood(meal: MealType, index: number) {
    setMealInputs(prev => ({ ...prev, [meal]: prev[meal].filter((_, i) => i !== index) }))
  }

  const totalFoodCount = MEAL_TYPES.reduce((sum, m) => sum + mealInputs[m].length, 0)

  async function handleGenerate() {
    setError('')
    setIssues(null)
    setStage('generating')
    try {
      const foods = MEAL_TYPES.flatMap(meal => mealInputs[meal].map(name => ({ name, meal })))
      const res = await fetch('/api/menu-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foods }),
      })
      const data: PlanResponse = await res.json()

      if ('error' in data) {
        setError(data.error)
        setStage('input')
        return
      }
      if (!data.feasible) {
        setIssues(data.issues)
        setStage('input')
        return
      }

      setPlanned(data.foods)
      const initialQ: Record<number, number> = {}
      data.foods.forEach((f, i) => { initialQ[i] = f.suggested_g })
      setQuantities(initialQ)
      setStage('result')
    } catch {
      setError('Planning failed. Please try again.')
      setStage('input')
    }
  }

  function setQuantity(index: number, grams: number) {
    setQuantities(prev => ({ ...prev, [index]: grams }))
  }

  // Live totals from current (possibly edited) quantities
  const totals = planned.reduce(
    (acc, f, i) => {
      const g = quantities[i] ?? f.suggested_g
      acc.kcal += (f.per100g.energy_kcal * g) / 100
      acc.protein += (f.per100g.protein_g * g) / 100
      acc.carb += (f.per100g.carbohydrate_g * g) / 100
      acc.fat += (f.per100g.fat_g * g) / 100
      return acc
    },
    { kcal: 0, protein: 0, carb: 0, fat: 0 }
  )

  async function handleSaveToLog() {
    setStage('saving')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const foodRowsByMeal: Record<string, ReturnType<typeof buildFoodRow>[]> = {}
      for (let i = 0; i < planned.length; i++) {
        const f = planned[i]
        const grams = quantities[i] ?? f.suggested_g
        const row = buildFoodRow(f, grams)
        if (!foodRowsByMeal[f.meal]) foodRowsByMeal[f.meal] = []
        foodRowsByMeal[f.meal].push(row)
      }

      const dayTotals: Record<string, number> = {}

      for (const [mealType, rows] of Object.entries(foodRowsByMeal)) {
        const mealTotals: Record<string, number> = {}
        for (const row of rows) {
          for (const [k, v] of Object.entries(row.nutrients_mid)) {
            mealTotals[k] = (mealTotals[k] ?? 0) + v
            dayTotals[k] = (dayTotals[k] ?? 0) + v
          }
        }

        const { data: meal, error: mealError } = await supabase
          .from('meals')
          .insert({
            user_id: user.id,
            meal_date: date,
            meal_type: MEAL_TYPES.includes(mealType as MealType) ? mealType : 'snack',
            user_note: 'Planned via Plan the menu',
            nutrient_totals_mid: mealTotals,
            nutrient_totals_min: mealTotals,
            nutrient_totals_max: mealTotals,
          })
          .select()
          .single()
        if (mealError) throw mealError

        await supabase.from('food_items').insert(
          rows.map(row => ({ ...row, meal_id: meal.id, user_id: user.id }))
        )
      }

      const { data: existingLog } = await supabase
        .from('daily_logs')
        .select('nutrient_totals, meal_count')
        .eq('user_id', user.id)
        .eq('date', date)
        .single()

      const addedMealCount = Object.keys(foodRowsByMeal).length

      if (existingLog) {
        const merged: Record<string, number> = { ...(existingLog.nutrient_totals as Record<string, number> ?? {}) }
        for (const [k, v] of Object.entries(dayTotals)) merged[k] = (merged[k] ?? 0) + v
        await supabase.from('daily_logs')
          .update({ nutrient_totals: merged, meal_count: (existingLog.meal_count ?? 0) + addedMealCount, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('date', date)
      } else {
        await supabase.from('daily_logs').insert({
          user_id: user.id, date, nutrient_totals: dayTotals, meal_count: addedMealCount,
        })
      }

      setStage('done')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.')
      setStage('result')
    }
  }

  function buildFoodRow(f: PlannedFood, grams: number) {
    const factor = grams / 100
    const round = (v: number) => Math.round(v * factor * 100) / 100
    const nutrients = {
      energy_kcal: round(f.per100g.energy_kcal),
      protein_g: round(f.per100g.protein_g),
      fat_g: round(f.per100g.fat_g),
      carbohydrate_g: round(f.per100g.carbohydrate_g),
    }
    return {
      name: f.name,
      portion_g_min: Math.round(grams),
      portion_g_max: Math.round(grams),
      portion_g_mid: Math.round(grams),
      prep_method: 'unknown',
      confidence: 0.7,
      is_synthetic_oil: false,
      usda_fdc_id: null,
      nutrients_mid: nutrients,
      nutrients_min: nutrients,
      nutrients_max: nutrients,
    }
  }

  // ── Done ──────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center fade-up">
          <div className="w-20 h-20 bg-sage-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4d7042" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-xl font-bold text-gray-900">Meals saved</p>
          <p className="text-sm text-gray-400 mt-1">Heading back to Nest…</p>
        </div>
      </div>
    )
  }

  // ── Result (editable quantities) ────────────────────────────────────────────
  if (stage === 'result' || stage === 'saving') {
    return (
      <div className="min-h-screen bg-cream-50 pb-36">
        <div className="bg-white px-5 pt-14 pb-4 border-b border-gray-50">
          <button onClick={() => setStage('input')} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-3 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back
          </button>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Your plan</h1>
              <p className="text-sm text-gray-400 mt-0.5">Adjust quantities, then save</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{Math.round(totals.kcal)}</p>
              <p className="text-xs text-gray-400">kcal total</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <span className="text-[10px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full font-semibold">P {Math.round(totals.protein)}g</span>
            <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-semibold">C {Math.round(totals.carb)}g</span>
            <span className="text-[10px] text-sage-600 bg-sage-50 px-2 py-0.5 rounded-full font-semibold">F {Math.round(totals.fat)}g</span>
            <span className="text-[10px] text-gray-400 ml-0.5">projected day total</span>
          </div>
        </div>

        <div className="mx-4 mt-4 space-y-4">
          {error && (
            <div className="bg-terracotta-50 border border-terracotta-200 rounded-2xl px-4 py-3 text-sm text-terracotta-800">
              {error}
            </div>
          )}

          {MEAL_TYPES.map(meal => {
            const items = planned
              .map((f, i) => ({ f, i }))
              .filter(({ f }) => f.meal === meal)
            if (items.length === 0) return null
            return (
              <div key={meal}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">{MEAL_LABELS[meal]}</p>
                <div className="space-y-2">
                  {items.map(({ f, i }) => {
                    const grams = quantities[i] ?? f.suggested_g
                    const kcal = Math.round((f.per100g.energy_kcal * grams) / 100)
                    return (
                      <div key={i} className="card px-4 py-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-800 capitalize truncate">{f.name}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              Range {f.min_g}–{f.max_g}g · {kcal} kcal at {Math.round(grams)}g
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <input
                              type="number"
                              value={Math.round(grams)}
                              min={f.min_g}
                              max={f.max_g}
                              onChange={e => {
                                const v = parseFloat(e.target.value)
                                if (!isNaN(v)) setQuantity(i, Math.min(f.max_g, Math.max(f.min_g, v)))
                              }}
                              className="w-16 border border-sage-300 rounded-xl px-2 py-1.5 text-sm font-medium text-gray-800 text-right focus:outline-none focus:ring-2 focus:ring-sage-400"
                            />
                            <span className="text-xs text-gray-400">g</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="fixed bottom-24 left-0 right-0 px-4" style={{ maxWidth: '430px', margin: '0 auto' }}>
          <button
            onClick={handleSaveToLog}
            disabled={stage === 'saving'}
            className="w-full bg-sage-600 text-white font-semibold py-3.5 rounded-2xl shadow-lg active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {stage === 'saving' ? 'Saving…' : `Save to log · ${Math.round(totals.kcal)} kcal`}
          </button>
        </div>
      </div>
    )
  }

  // ── Generating ──────────────────────────────────────────────────────────
  if (stage === 'generating') {
    return (
      <div className="min-h-screen bg-cream-50 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-gray-700">Working out quantities…</p>
        <p className="text-xs text-gray-400">Balancing your menu against your targets</p>
      </div>
    )
  }

  // ── Input (default) ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream-50 pb-32">
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <Link href="/log" className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-3 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Plan the menu</h1>
        <p className="text-sm text-gray-400 mt-1">List what you'll eat — we'll work out how much of each</p>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className="bg-terracotta-50 border border-terracotta-200 rounded-2xl px-4 py-3 text-sm text-terracotta-800">
            {error}
          </div>
        )}

        {issues && issues.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 mb-1.5">Can't generate a plan yet</p>
            <ul className="space-y-1">
              {issues.map((issue, i) => (
                <li key={i} className="text-xs text-amber-700 leading-relaxed">{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Date */}
        <div className="card p-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Date</p>
          <div className="flex gap-2">
            <button
              onClick={() => setDate(localDate())}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${date === localDate() ? 'bg-sage-600 text-white' : 'bg-cream-100 text-gray-600'}`}
            >
              Today
            </button>
            <button
              onClick={() => setDate(localDate(1))}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${date === localDate(1) ? 'bg-sage-600 text-white' : 'bg-cream-100 text-gray-600'}`}
            >
              Tomorrow
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="flex-1 bg-cream-100 rounded-xl px-2 text-xs text-gray-600 text-center"
            />
          </div>
        </div>

        {MEAL_TYPES.map(meal => (
          <div key={meal} className="card p-4">
            <p className="text-sm font-bold text-gray-800 mb-2.5">{MEAL_LABELS[meal]}</p>
            {mealInputs[meal].length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {mealInputs[meal].map((name, i) => (
                  <span key={i} className="flex items-center gap-1 text-xs bg-sage-50 text-sage-800 border border-sage-100 rounded-full pl-3 pr-1.5 py-1">
                    {name}
                    <button onClick={() => removeFood(meal, i)} className="w-4 h-4 flex items-center justify-center text-sage-500 hover:text-sage-700">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={draft[meal]}
                onChange={e => setDraft(prev => ({ ...prev, [meal]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFood(meal) } }}
                placeholder={`Add a food, e.g. "chicken breast"`}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-sage-400"
              />
              <button
                onClick={() => addFood(meal)}
                className="bg-cream-100 text-sage-700 text-xs font-semibold px-3.5 rounded-xl active:scale-95 transition-all"
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-24 left-0 right-0 px-4" style={{ maxWidth: '430px', margin: '0 auto' }}>
        <button
          onClick={handleGenerate}
          disabled={totalFoodCount === 0}
          className="w-full bg-sage-600 text-white font-semibold py-3.5 rounded-2xl shadow-lg active:scale-[0.98] transition-all disabled:opacity-40"
        >
          Generate plan{totalFoodCount > 0 ? ` · ${totalFoodCount} food${totalFoodCount !== 1 ? 's' : ''}` : ''}
        </button>
      </div>
    </div>
  )
}
