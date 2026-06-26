'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { localDate } from '@/lib/utils/date'

// ── Client-side image compression ────────────────────────────────────────────
async function compressImage(file: File, maxPx = 1400, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { width, height } = img
      const scale = Math.min(1, maxPx / Math.max(width, height))
      const w = Math.round(width  * scale)
      const h = Math.round(height * scale)

      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

type FoodItem = {
  name: string
  portion_g_min: number
  portion_g_max: number
  portion_g_mid: number
  prep_method?: string
  confidence: number
  nutrients_min: Record<string, number>
  nutrients_max: Record<string, number>
  nutrients_mid: Record<string, number>
  fdc_id?: number | null
  is_synthetic_oil?: boolean
}

type AnalysisResult = {
  enriched_foods: FoodItem[]
  oil_item: FoodItem | null
  enriched_mixed_dishes: FoodItem[]
  vision: {
    meal_type: string
    overall_confidence: number
    meal_description: string
  }
}

type SavedMeal = {
  id: string
  meal_type: string
  meal_date: string
  photo_url?: string
  nutrient_totals_mid?: Record<string, number>
  food_items?: Array<{ id: string; name: string; portion_g_mid: number; nutrients_mid: Record<string, number>; prep_method: string }>
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

export default function LogPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [stage, setStage] = useState<'capture' | 'analysing' | 'confirm' | 'saving' | 'done'>('capture')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [mealType, setMealType] = useState('lunch')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [foods, setFoods] = useState<FoodItem[]>([])
  const [error, setError] = useState('')

  // Text mode
  const [textMode, setTextMode] = useState(false)
  const [description, setDescription] = useState('')

  // Portion editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editGrams, setEditGrams] = useState('')

  // History
  const [history, setHistory] = useState<SavedMeal[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedMealId, setExpandedMealId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setHistoryLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const sevenDaysAgo = localDate(-7)
    const { data } = await supabase
      .from('meals')
      .select('id, meal_type, meal_date, photo_url, nutrient_totals_mid')
      .eq('user_id', user.id)
      .gte('meal_date', sevenDaysAgo)
      .order('meal_date', { ascending: false })

    setHistory(data ?? [])
    setHistoryLoading(false)
  }

  async function loadFoodItems(mealId: string) {
    const { data } = await supabase
      .from('food_items')
      .select('id, name, portion_g_mid, nutrients_mid, prep_method')
      .eq('meal_id', mealId)

    setHistory(prev => prev.map(m =>
      m.id === mealId ? { ...m, food_items: data ?? [] } : m
    ))
  }

  async function deleteMeal(meal: SavedMeal) {
    setDeletingId(meal.id)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Subtract from daily_logs
    const { data: log } = await supabase
      .from('daily_logs')
      .select('nutrient_totals, meal_count')
      .eq('user_id', user.id)
      .eq('date', meal.meal_date)
      .maybeSingle()

    if (log && meal.nutrient_totals_mid) {
      const updated: Record<string, number> = { ...(log.nutrient_totals as Record<string, number>) }
      for (const [key, val] of Object.entries(meal.nutrient_totals_mid)) {
        updated[key] = Math.max(0, (updated[key] ?? 0) - val)
      }
      const newCount = Math.max(0, (log.meal_count ?? 1) - 1)
      if (newCount === 0) {
        await supabase.from('daily_logs').delete().eq('user_id', user.id).eq('date', meal.meal_date)
      } else {
        await supabase.from('daily_logs')
          .update({ nutrient_totals: updated, meal_count: newCount })
          .eq('user_id', user.id).eq('date', meal.meal_date)
      }
    }

    // Delete food_items then meal
    await supabase.from('food_items').delete().eq('meal_id', meal.id)
    await supabase.from('meals').delete().eq('id', meal.id)

    setHistory(prev => prev.filter(m => m.id !== meal.id))
    if (expandedMealId === meal.id) setExpandedMealId(null)
    setDeletingId(null)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    // Show original preview immediately for responsiveness
    setImagePreview(URL.createObjectURL(file))
    // Compress before storing for upload
    const compressed = await compressImage(file)
    setImageFile(compressed)
  }

  async function handleAnalyse() {
    setStage('analysing')
    setError('')

    try {
      let data: AnalysisResult

      if (textMode) {
        // Text-only path
        if (!description.trim()) throw new Error('Please describe your meal first')
        const res = await fetch('/api/meals/analyse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, meal_type_hint: mealType }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Analysis failed.' }))
          throw new Error(body.error ?? 'Analysis failed.')
        }
        data = await res.json()
      } else {
        // Photo path
        if (!imageFile) throw new Error('No image selected')
        const formData = new FormData()
        formData.append('image', imageFile)
        formData.append('meal_type_hint', mealType)
        if (note) formData.append('user_note', note)

        const res = await fetch('/api/meals/analyse', { method: 'POST', body: formData })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Analysis failed. Please try again.' }))
          throw new Error(body.error ?? 'Analysis failed. Please try again.')
        }
        data = await res.json()
      }

      setResult(data)
      setFoods([
        ...data.enriched_foods,
        ...(data.oil_item ? [data.oil_item] : []),
        ...data.enriched_mixed_dishes,
      ])
      setStage('confirm')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
      setStage('capture')
    }
  }

  function removeFood(index: number) {
    setFoods(prev => prev.filter((_, i) => i !== index))
  }

  function startEdit(index: number) {
    setEditingIndex(index)
    setEditGrams(String(Math.round(foods[index].portion_g_mid)))
  }

  function applyPortionEdit(index: number) {
    const newG = parseFloat(editGrams)
    if (isNaN(newG) || newG <= 0) { setEditingIndex(null); return }
    setFoods(prev => prev.map((food, i) => {
      if (i !== index) return food
      const scale = newG / (food.portion_g_mid || 1)
      const scaleN = (n: Record<string, number>) =>
        Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * scale * 100) / 100]))
      return {
        ...food,
        portion_g_mid: Math.round(newG),
        portion_g_min: Math.round(newG * 0.9),
        portion_g_max: Math.round(newG * 1.1),
        nutrients_mid: scaleN(food.nutrients_mid),
        nutrients_min: scaleN(food.nutrients_min),
        nutrients_max: scaleN(food.nutrients_max),
      }
    }))
    setEditingIndex(null)
  }

  async function handleSave() {
    if ((!imageFile && !textMode) || foods.length === 0) return
    setStage('saving')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      let photoUrl: string | null = null
      let storagePath: string | null = null

      try {
        const ext = imageFile.name.split('.').pop() ?? 'jpg'
        storagePath = `${user.id}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('meal-photos')
          .upload(storagePath, imageFile, { contentType: imageFile.type })

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('meal-photos').getPublicUrl(storagePath)
          photoUrl = urlData.publicUrl
        }
      } catch { /* non-fatal */ }

      const totalsMid: Record<string, number> = {}
      const totalsMin: Record<string, number> = {}
      const totalsMax: Record<string, number> = {}

      for (const food of foods) {
        for (const [key, val] of Object.entries(food.nutrients_mid ?? {})) {
          totalsMid[key] = (totalsMid[key] ?? 0) + val
        }
        for (const [key, val] of Object.entries(food.nutrients_min ?? {})) {
          totalsMin[key] = (totalsMin[key] ?? 0) + val
        }
        for (const [key, val] of Object.entries(food.nutrients_max ?? {})) {
          totalsMax[key] = (totalsMax[key] ?? 0) + val
        }
      }

      const today = localDate()

      const { data: meal, error: mealError } = await supabase
        .from('meals')
        .insert({
          user_id: user.id,
          meal_date: today,
          meal_type: mealType,
          photo_url: photoUrl,
          photo_storage_path: storagePath,
          user_note: note || null,
          vision_confidence: result?.vision.overall_confidence ?? null,
          nutrient_totals_mid: totalsMid,
          nutrient_totals_min: totalsMin,
          nutrient_totals_max: totalsMax,
        })
        .select()
        .single()

      if (mealError) throw mealError

      const foodRows = foods.map(food => ({
        meal_id: meal.id,
        user_id: user.id,
        name: food.name,
        portion_g_min: food.portion_g_min,
        portion_g_max: food.portion_g_max,
        portion_g_mid: food.portion_g_mid,
        prep_method: food.prep_method ?? 'unknown',
        confidence: food.confidence,
        is_synthetic_oil: food.is_synthetic_oil ?? false,
        usda_fdc_id: food.fdc_id ?? null,
        nutrients_mid: food.nutrients_mid,
        nutrients_min: food.nutrients_min,
        nutrients_max: food.nutrients_max,
      }))

      await supabase.from('food_items').insert(foodRows)

      const { data: existingLog } = await supabase
        .from('daily_logs')
        .select('nutrient_totals, meal_count')
        .eq('user_id', user.id)
        .eq('date', today)
        .single()

      if (existingLog) {
        const merged: Record<string, number> = { ...(existingLog.nutrient_totals as Record<string, number> ?? {}) }
        for (const [key, val] of Object.entries(totalsMid)) {
          merged[key] = (merged[key] ?? 0) + val
        }
        await supabase.from('daily_logs')
          .update({ nutrient_totals: merged, meal_count: (existingLog.meal_count ?? 0) + 1, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('date', today)
      } else {
        await supabase.from('daily_logs').insert({
          user_id: user.id,
          date: today,
          nutrient_totals: totalsMid,
          meal_count: 1,
        })
      }

      setStage('done')
      setTimeout(() => router.push('/dashboard'), 1500)

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.')
      setStage('confirm')
    }
  }

  // ── Group history by date ─────────────────────────────────────────────────
  const today = localDate()
  const grouped: Record<string, SavedMeal[]> = {}
  for (const m of history) {
    if (!grouped[m.meal_date]) grouped[m.meal_date] = []
    grouped[m.meal_date].push(m)
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  function dateLabel(d: string) {
    if (d === today) return 'Today'
    const yesterday = localDate(-1)
    if (d === yesterday) return 'Yesterday'
    return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center fade-up">
          <div className="w-20 h-20 bg-sage-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4d7042" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-xl font-bold text-gray-900">Meal saved</p>
          <p className="text-sm text-gray-400 mt-1">Heading back to Nest…</p>
        </div>
      </div>
    )
  }

  // ── Analysing ─────────────────────────────────────────────────────────────
  if (stage === 'analysing') {
    return (
      <div className="min-h-screen bg-cream-50 flex flex-col items-center justify-center gap-5 px-6">
        {imagePreview && !textMode ? (
          <div className="relative">
            <img src={imagePreview} alt="meal" className="w-64 h-64 object-cover rounded-3xl shadow-lg" />
            <div className="absolute inset-0 rounded-3xl bg-black/10" />
          </div>
        ) : textMode ? (
          <div className="w-16 h-16 bg-sage-50 rounded-2xl flex items-center justify-center text-3xl">📝</div>
        ) : null}
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-700">
              {textMode ? 'Parsing your description…' : 'Analysing your meal…'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {textMode ? 'AI is estimating portions and nutrients' : 'AI is identifying foods and nutrients'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (stage === 'confirm' && result) {
    const totalEnergy = foods.reduce((sum, f) => sum + (f.nutrients_mid?.energy_kcal ?? 0), 0)

    return (
      <div className="min-h-screen bg-cream-50 pb-36">
        <div className="bg-white px-5 pt-14 pb-4 border-b border-gray-50">
          <button onClick={() => setStage('capture')} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-3 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back
          </button>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Confirm meal</h1>
              <p className="text-sm text-gray-400 mt-0.5">Remove anything wrong, then save</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{Math.round(totalEnergy)}</p>
              <p className="text-xs text-gray-400">kcal total</p>
            </div>
          </div>
        </div>

        <div className="mx-4 mt-4">
          {imagePreview && !textMode ? (
            <div className="rounded-2xl overflow-hidden shadow-sm">
              <img src={imagePreview} alt="meal" className="w-full h-44 object-cover" />
              <div className="bg-white px-4 py-2.5 border-t border-gray-50">
                <p className="text-xs text-gray-500 italic">{result.vision.meal_description}</p>
              </div>
            </div>
          ) : (
            <div className="bg-cream-50 border border-cream-200 rounded-2xl px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Your description</p>
              <p className="text-sm text-gray-600 italic">{description}</p>
              <p className="text-[10px] text-gray-400 mt-2">✦ AI has estimated portions from your description</p>
            </div>
          )}
        </div>

        <div className="mx-4 mt-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {foods.length} item{foods.length !== 1 ? 's' : ''} identified
          </p>
          <div className="space-y-2">
            {foods.map((food, i) => (
              <div key={i} className="card px-4 py-3.5">
                {editingIndex === i ? (
                  // ── Inline edit form ──────────────────────────────────────
                  <div>
                    <p className="text-sm font-semibold text-gray-800 capitalize mb-2">{food.name}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          value={editGrams}
                          onChange={e => setEditGrams(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && applyPortionEdit(i)}
                          className="w-full border border-sage-300 rounded-xl px-3 py-2 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-sage-400 pr-8"
                          autoFocus
                          min="1"
                          max="2000"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">g</span>
                      </div>
                      <button
                        onClick={() => applyPortionEdit(i)}
                        className="bg-sage-600 text-white text-xs font-semibold px-4 py-2 rounded-xl active:scale-95 transition-all">
                        Done
                      </button>
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="text-gray-400 text-xs px-2 py-2">
                        Cancel
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5">Nutrients will scale proportionally to the new weight</p>
                  </div>
                ) : (
                  // ── Normal display ────────────────────────────────────────
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800 capitalize">{food.name}</p>
                        {food.is_synthetic_oil && (
                          <span className="text-[10px] bg-cream-100 text-gray-500 px-1.5 py-0.5 rounded-full">est.</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        ~{Math.round(food.portion_g_mid)}g
                        {food.prep_method && food.prep_method !== 'unknown' && ` · ${food.prep_method}`}
                        {' · '}<span className="font-medium text-gray-600">{Math.round(food.nutrients_mid?.energy_kcal ?? 0)} kcal</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                        food.confidence >= 0.8 ? 'bg-sage-50 text-sage-700' :
                        food.confidence >= 0.5 ? 'bg-amber-50 text-amber-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>
                        {Math.round(food.confidence * 100)}%
                      </span>
                      <button onClick={() => startEdit(i)}
                        className="w-7 h-7 rounded-full hover:bg-sage-50 flex items-center justify-center text-gray-300 hover:text-sage-500 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button onClick={() => removeFood(i)}
                        className="w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">
                        ×
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3">
            <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>
          </div>
        )}

        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] p-4 pb-[84px] bg-cream-50/90 backdrop-blur-sm border-t border-gray-100 z-40">
          <button onClick={handleSave}
            className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 text-white font-semibold py-4 rounded-2xl text-sm transition-all shadow-lg shadow-sage-300/40 active:scale-[0.98]">
            Save meal · {Math.round(totalEnergy)} kcal
          </button>
        </div>
      </div>
    )
  }

  // ── Capture (default) ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream-50 pb-28">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <h1 className="text-2xl font-bold text-gray-900">Nourish</h1>
        <p className="text-sm text-gray-400 mt-1">Snap a photo — AI identifies everything</p>
      </div>

      <div className="p-4 space-y-3">

        {/* Mode toggle */}
        <div className="flex bg-cream-100 rounded-2xl p-1">
          <button
            onClick={() => { setTextMode(false); setError('') }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              !textMode ? 'bg-white text-sage-700 shadow-sm' : 'text-gray-400'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Photo
          </button>
          <button
            onClick={() => { setTextMode(true); setError('') }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              textMode ? 'bg-white text-sage-700 shadow-sm' : 'text-gray-400'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            Describe
          </button>
        </div>

        {!textMode ? (
          <>
            {/* Photo upload */}
            <div
              onClick={() => fileRef.current?.click()}
              className={`relative rounded-3xl overflow-hidden cursor-pointer transition-all active:scale-[0.98] ${
                imagePreview
                  ? 'shadow-md'
                  : 'border-2 border-dashed border-gray-200 hover:border-sage-300 bg-white hover:bg-cream-50'
              }`}
            >
              {imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="meal preview" className="w-full h-64 object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  <div className="absolute bottom-3 left-0 right-0 text-center">
                    <span className="text-white text-xs font-medium bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-full">
                      Tap to change
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-56 gap-3">
                  <div className="w-16 h-16 bg-sage-50 rounded-2xl flex items-center justify-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#638c57" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-gray-700">Add a photo</p>
                    <p className="text-xs text-gray-400 mt-0.5">Camera or photo library</p>
                  </div>
                </div>
              )}
            </div>

            {/* Optional note */}
            <div className="card p-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Add a note <span className="font-normal">(optional)</span></p>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. home-cooked, extra olive oil, added cheese…"
                rows={2}
                className="w-full text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none bg-transparent"
              />
            </div>
          </>
        ) : (
          /* Text mode */
          <div className="card p-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Describe your meal</p>
            <p className="text-xs text-gray-400 mb-3">Be specific about portions — e.g. "a cup of rice, half plate of salad with olive oil dressing, quarter plate of chicken thighs cooked in oil"</p>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. about a cup of cooked jasmine rice, half a plate of mixed salad with olive oil dressing, and roughly a quarter plate of grilled chicken thighs…"
              rows={5}
              autoFocus
              className="w-full text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none bg-transparent leading-relaxed"
            />
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

        {/* Meal type */}
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Meal type</p>
          <div className="flex gap-2">
            {MEAL_TYPES.map(type => (
              <button key={type} onClick={() => setMealType(type)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold capitalize transition-all active:scale-95 ${
                  mealType === type ? 'bg-sage-600 text-white shadow-sm shadow-sage-300/40' : 'bg-cream-50 text-gray-500 hover:bg-cream-100'
                }`}>
                {type}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        {/* Analyse button */}
        <button
          onClick={handleAnalyse}
          disabled={textMode ? description.trim().length < 5 : !imageFile}
          className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-sm transition-all shadow-lg shadow-sage-300/40 active:scale-[0.98]"
        >
          {textMode ? 'Analyse description' : 'Analyse with AI'}
        </button>

        {/* ── Meal History ────────────────────────────────────────────────── */}
        <div className="pt-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent meals</p>

          {historyLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-sage-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No meals logged yet</p>
          ) : (
            <div className="space-y-4">
              {sortedDates.map(date => (
                <div key={date}>
                  {/* Date header */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-500">{dateLabel(date)}</span>
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-[10px] text-gray-300">
                      {grouped[date].reduce((s, m) => s + (m.nutrient_totals_mid?.energy_kcal ?? 0), 0) > 0
                        ? `${Math.round(grouped[date].reduce((s, m) => s + (m.nutrient_totals_mid?.energy_kcal ?? 0), 0))} kcal`
                        : ''}
                    </span>
                  </div>

                  {/* Meals for this date */}
                  <div className="space-y-2">
                    {grouped[date].map(meal => {
                      const isExpanded = expandedMealId === meal.id
                      const kcal = meal.nutrient_totals_mid?.energy_kcal
                      const label = meal.meal_type
                        ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1).replace(/_/g, ' ')
                        : 'Meal'

                      return (
                        <div key={meal.id} className="card overflow-hidden">
                          {/* Meal row */}
                          <button
                            className="w-full flex items-center gap-3 p-3 text-left active:bg-cream-50 transition-colors"
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedMealId(null)
                              } else {
                                setExpandedMealId(meal.id)
                                if (!meal.food_items) loadFoodItems(meal.id)
                              }
                            }}
                          >
                            {meal.photo_url ? (
                              <img src={meal.photo_url} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-cream-100 flex items-center justify-center flex-shrink-0 text-2xl">🍽️</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-800">{label}</p>
                              <p className="text-xs text-gray-400">
                                {kcal ? `${Math.round(kcal)} kcal` : 'tap to see details'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <svg
                                width="16" height="16" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                                className={`text-gray-300 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </div>
                          </button>

                          {/* Expanded food items */}
                          {isExpanded && (
                            <div className="border-t border-gray-50 px-3 pb-3">
                              {!meal.food_items ? (
                                <div className="flex justify-center py-4">
                                  <div className="w-5 h-5 border-2 border-sage-400 border-t-transparent rounded-full animate-spin" />
                                </div>
                              ) : (
                                <>
                                  <div className="pt-3 space-y-2">
                                    {meal.food_items.map(item => (
                                      <div key={item.id} className="flex items-center justify-between">
                                        <div>
                                          <p className="text-sm text-gray-700 capitalize font-medium">{item.name}</p>
                                          <p className="text-xs text-gray-400">
                                            ~{Math.round(item.portion_g_mid)}g
                                            {item.prep_method && item.prep_method !== 'unknown' && ` · ${item.prep_method}`}
                                          </p>
                                        </div>
                                        <p className="text-xs font-semibold text-gray-600 flex-shrink-0 ml-3">
                                          {Math.round(item.nutrients_mid?.energy_kcal ?? 0)} kcal
                                        </p>
                                      </div>
                                    ))}
                                  </div>

                                  {/* Macro summary */}
                                  {meal.nutrient_totals_mid && (
                                    <div className="mt-3 flex gap-2">
                                      {[
                                        { label: 'P', value: meal.nutrient_totals_mid.protein_g, unit: 'g', color: 'text-sage-600' },
                                        { label: 'C', value: meal.nutrient_totals_mid.carbohydrate_g ?? meal.nutrient_totals_mid.carbs_g, unit: 'g', color: 'text-amber-600' },
                                        { label: 'F', value: meal.nutrient_totals_mid.fat_g, unit: 'g', color: 'text-terracotta-500' },
                                      ].map(({ label, value, unit, color }) => value != null && (
                                        <span key={label} className={`text-xs font-semibold ${color} bg-cream-50 px-2 py-1 rounded-lg`}>
                                          {label} {Math.round(value)}{unit}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {/* Delete button */}
                                  <button
                                    onClick={() => deleteMeal(meal)}
                                    disabled={deletingId === meal.id}
                                    className="mt-3 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 font-semibold disabled:opacity-40 transition-colors active:scale-95"
                                  >
                                    {deletingId === meal.id ? (
                                      <div className="w-3.5 h-3.5 border border-red-400 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                                      </svg>
                                    )}
                                    {deletingId === meal.id ? 'Deleting…' : 'Delete this meal'}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
