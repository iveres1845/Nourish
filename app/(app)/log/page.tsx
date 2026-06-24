'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setError('')
  }

  async function handleAnalyse() {
    if (!imageFile) return
    setStage('analysing')
    setError('')

    try {
      const formData = new FormData()
      formData.append('image', imageFile)
      formData.append('meal_type_hint', mealType)
      if (note) formData.append('user_note', note)

      const res = await fetch('/api/meals/analyse', { method: 'POST', body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Analysis failed. Please try again.' }))
        throw new Error(body.error ?? 'Analysis failed. Please try again.')
      }

      const data: AnalysisResult = await res.json()
      setResult(data)

      const allFoods = [
        ...data.enriched_foods,
        ...(data.oil_item ? [data.oil_item] : []),
        ...data.enriched_mixed_dishes,
      ]
      setFoods(allFoods)
      setStage('confirm')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
      setStage('capture')
    }
  }

  function removeFood(index: number) {
    setFoods(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (!imageFile || foods.length === 0) return
    setStage('saving')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Upload photo to Supabase Storage
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
      } catch {
        // Photo upload failure is non-fatal
      }

      // Sum nutrient totals across confirmed foods
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

      const today = new Date().toISOString().split('T')[0]

      // Insert meal
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

      // Insert food items
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

      // Upsert daily log
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
          .eq('user_id', user.id)
          .eq('date', today)
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

  // ── Done ──
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
          <p className="text-sm text-gray-400 mt-1">Heading back to your dashboard…</p>
        </div>
      </div>
    )
  }

  // ── Analysing ──
  if (stage === 'analysing') {
    return (
      <div className="min-h-screen bg-cream-50 flex flex-col items-center justify-center gap-5">
        {imagePreview && (
          <div className="relative">
            <img src={imagePreview} alt="meal" className="w-64 h-64 object-cover rounded-3xl shadow-lg" />
            <div className="absolute inset-0 rounded-3xl bg-black/10" />
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-700">Analysing your meal…</p>
            <p className="text-xs text-gray-400 mt-0.5">AI is identifying foods and nutrients</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirm ──
  if (stage === 'confirm' && result) {
    const totalEnergy = foods.reduce((sum, f) => sum + (f.nutrients_mid?.energy_kcal ?? 0), 0)

    return (
      <div className="min-h-screen bg-cream-50 pb-36">
        {/* Header */}
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

        {/* Photo */}
        {imagePreview && (
          <div className="mx-4 mt-4">
            <div className="rounded-2xl overflow-hidden shadow-sm">
              <img src={imagePreview} alt="meal" className="w-full h-44 object-cover" />
              <div className="bg-white px-4 py-2.5 border-t border-gray-50">
                <p className="text-xs text-gray-500 italic">{result.vision.meal_description}</p>
              </div>
            </div>
          </div>
        )}

        {/* Food items */}
        <div className="mx-4 mt-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {foods.length} item{foods.length !== 1 ? 's' : ''} identified
          </p>
          <div className="space-y-2">
            {foods.map((food, i) => (
              <div key={i} className="card px-4 py-3.5 flex items-center gap-3">
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
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                    food.confidence >= 0.8 ? 'bg-sage-50 text-sage-700' :
                    food.confidence >= 0.5 ? 'bg-amber-50 text-amber-700' :
                    'bg-gray-50 text-gray-500'
                  }`}>
                    {Math.round(food.confidence * 100)}%
                  </span>
                  <button onClick={() => removeFood(i)}
                    className="w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3">
            <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>
          </div>
        )}

        {/* Save button */}
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] p-4 bg-cream-50/90 backdrop-blur-sm border-t border-gray-100">
          <button onClick={handleSave}
            className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 text-white font-semibold py-4 rounded-2xl text-sm transition-all shadow-lg shadow-sage-300/40 active:scale-[0.98]">
            Save meal · {Math.round(totalEnergy)} kcal
          </button>
        </div>
      </div>
    )
  }

  // ── Capture (default) ──
  return (
    <div className="min-h-screen bg-cream-50 pb-28">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <h1 className="text-2xl font-bold text-gray-900">Log a meal</h1>
        <p className="text-sm text-gray-400 mt-1">Snap a photo — AI identifies everything</p>
      </div>

      <div className="p-4 space-y-3">
        {/* Photo upload area */}
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

        {/* Optional note */}
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Add a note</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. home-cooked, extra olive oil, added cheese…"
            rows={2}
            className="w-full text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none bg-transparent"
          />
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        {/* Analyse button */}
        <button onClick={handleAnalyse} disabled={!imageFile}
          className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-sm transition-all shadow-lg shadow-sage-300/40 active:scale-[0.98]">
          Analyse with AI
        </button>
      </div>
    </div>
  )
}
