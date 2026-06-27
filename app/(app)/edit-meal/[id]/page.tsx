'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type FoodItem = {
  id: string
  name: string
  portion_g_mid: number
  portion_g_min: number
  portion_g_max: number
  nutrients_mid: Record<string, number>
  nutrients_min: Record<string, number>
  nutrients_max: Record<string, number>
  is_synthetic_oil?: boolean
}

type Meal = {
  id: string
  meal_type: string
  meal_date: string
  photo_url?: string
  nutrient_totals_mid?: Record<string, number>
  food_items: FoodItem[]
}

export default function EditMealPage() {
  const router  = useRouter()
  const params  = useParams()
  const mealId  = params.id as string
  const supabase = createClient()

  const [meal,    setMeal]    = useState<Meal | null>(null)
  const [items,   setItems]   = useState<FoodItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Per-item editing state
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editGrams,  setEditGrams]  = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const res = await fetch(`/api/meals/${mealId}`)
      if (!res.ok) { setError('Meal not found'); setLoading(false); return }
      const { meal: data } = await res.json()
      setMeal(data)
      setItems(data.food_items ?? [])
      setLoading(false)
    }
    load()
  }, [mealId])

  function startEdit(item: FoodItem) {
    setEditingId(item.id)
    setEditGrams(String(Math.round(item.portion_g_mid)))
  }

  function applyEdit(item: FoodItem) {
    const newG = parseFloat(editGrams)
    if (isNaN(newG) || newG <= 0) { setEditingId(null); return }
    const scale = newG / item.portion_g_mid

    const scaleNutrients = (n: Record<string, number>) =>
      Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * scale * 100) / 100]))

    setItems(prev => prev.map(fi =>
      fi.id !== item.id ? fi : {
        ...fi,
        portion_g_mid: newG,
        portion_g_min: Math.round(newG * 0.9),
        portion_g_max: Math.round(newG * 1.1),
        nutrients_mid: scaleNutrients(fi.nutrients_mid),
        nutrients_min: scaleNutrients(fi.nutrients_min),
        nutrients_max: scaleNutrients(fi.nutrients_max),
      }
    ))
    setEditingId(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/meals/${mealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_items: items }),
      })
      if (!res.ok) throw new Error('Save failed')
      router.push('/dashboard')
    } catch {
      setError('Could not save changes. Please try again.')
      setSaving(false)
    }
  }

  const mealLabel = meal?.meal_type
    ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1).replace(/_/g, ' ')
    : 'Meal'

  const totalKcal = items.reduce((sum, fi) => sum + (fi.nutrients_mid.energy_kcal ?? 0), 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!meal) {
    return (
      <div className="min-h-screen bg-cream-50 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-gray-600">Meal not found.</p>
        <button onClick={() => router.push('/dashboard')}
          className="text-sage-600 font-semibold text-sm">← Back</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream-50 pb-28">

      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 -ml-1 p-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Edit {mealLabel}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{meal.meal_date}</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-3">

        {/* Photo if available */}
        {meal.photo_url && (
          <div className="rounded-2xl overflow-hidden">
            <img src={meal.photo_url} alt="" className="w-full h-44 object-cover" />
          </div>
        )}

        {/* Food items */}
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Food items</p>
          <div className="space-y-3">
            {items.map(item => (
              <div key={item.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 leading-snug">{item.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {Math.round(item.portion_g_mid)}g
                      {item.nutrients_mid.energy_kcal
                        ? ` · ${Math.round(item.nutrients_mid.energy_kcal)} kcal`
                        : ''}
                    </p>
                  </div>
                  {editingId !== item.id && (
                    <button
                      onClick={() => startEdit(item)}
                      className="flex-shrink-0 text-gray-300 hover:text-sage-500 transition-colors p-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  )}
                </div>

                {/* Inline edit */}
                {editingId === item.id && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      value={editGrams}
                      onChange={e => setEditGrams(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && applyEdit(item)}
                      className="w-24 border border-sage-300 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-sage-400"
                      placeholder="grams"
                      autoFocus
                    />
                    <span className="text-xs text-gray-400">g</span>
                    <button
                      onClick={() => applyEdit(item)}
                      className="text-xs font-semibold text-white bg-sage-600 rounded-lg px-3 py-1.5 active:scale-95 transition-all"
                    >Done</button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs font-medium text-gray-400"
                    >Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Total */}
        {totalKcal > 0 && (
          <div className="card px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-600 font-medium">Revised total</span>
            <span className="text-base font-bold text-gray-900">{Math.round(totalKcal)} kcal</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-terracotta-500 text-center">{error}</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-sage-600 text-white font-semibold py-3.5 rounded-2xl active:scale-95 transition-all shadow-sm shadow-sage-300/40 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>

      </div>
    </div>
  )
}
