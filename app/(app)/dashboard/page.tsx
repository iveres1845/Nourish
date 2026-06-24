'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile, DailyLog, Meal } from '@/lib/types'

const KEY_NUTRIENTS = [
  { key: 'iron_mg',       label: 'Iron',      unit: 'mg',  dri: 18,   color: '#c97b5a' },
  { key: 'calcium_mg',    label: 'Calcium',   unit: 'mg',  dri: 1000, color: '#638c57' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg', dri: 15,   color: '#f59e0b' },
  { key: 'magnesium_mg',  label: 'Magnesium', unit: 'mg',  dri: 310,  color: '#86a97a' },
  { key: 'zinc_mg',       label: 'Zinc',      unit: 'mg',  dri: 8,    color: '#60a5fa' },
  { key: 'protein_g',     label: 'Protein',   unit: 'g',   dri: 50,   color: '#a78bfa' },
]

const MEAL_EMOJIS: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎', unknown: '🍽️',
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Energy Ring ───────────────────────────────────────────────────────────────

function EnergyRing({ pct, kcal, low, high }: { pct: number; kcal: number; low: number; high: number }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const dash = circ * Math.min(pct / 100, 1)
  const isOnTrack = kcal >= low
  const strokeColor = isOnTrack ? '#638c57' : pct > 60 ? '#f59e0b' : '#e5e7eb'

  return (
    <div className="relative w-32 h-32 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f3f4f6" strokeWidth="9" />
        <circle
          cx="60" cy="60" r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 1s ease-out, stroke 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-bold text-gray-900 leading-none">{Math.round(kcal)}</span>
        <span className="text-[10px] text-gray-400 font-medium mt-0.5">kcal</span>
      </div>
    </div>
  )
}

// ── Nutrient Bar ──────────────────────────────────────────────────────────────

function NutrientBar({ label, value, dri, unit, color }: {
  label: string; value: number; dri: number; unit: string; color: string
}) {
  const pct = Math.min((value / dri) * 100, 100)

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <span className="text-xs font-bold" style={{ color: pct >= 80 ? color : pct >= 40 ? '#f59e0b' : '#d1d5db' }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? color : pct >= 40 ? '#f59e0b' : '#e5e7eb' }}
        />
      </div>
      <p className="text-[10px] text-gray-300 mt-1">{Math.round(value)}{unit}</p>
    </div>
  )
}

// ── Meal Row ──────────────────────────────────────────────────────────────────

function MealRow({ meal, onDelete }: { meal: Meal; onDelete: (meal: Meal) => void }) {
  const time = new Date(meal.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const energy = (meal.nutrient_totals_mid as Record<string, number>)?.energy_kcal ?? 0
  const emoji = MEAL_EMOJIS[meal.meal_type ?? 'unknown'] ?? '🍽️'
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center gap-2 py-3 border-b border-gray-50 last:border-0">
        <p className="flex-1 text-xs text-gray-500">Remove this meal?</p>
        <button onClick={() => onDelete(meal)} className="text-xs font-semibold text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">Delete</button>
        <button onClick={() => setConfirming(false)} className="text-xs font-medium text-gray-400 px-2 py-1.5">Cancel</button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-cream-100">
        {meal.photo_url ? (
          <img src={meal.photo_url} alt="meal" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">{emoji}</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 capitalize">{meal.meal_type ?? 'Meal'}</p>
        <p className="text-xs text-gray-400 mt-0.5">{time}</p>
      </div>
      <div className="text-right mr-1">
        <p className="text-sm font-bold text-gray-700">{Math.round(energy)}</p>
        <p className="text-[10px] text-gray-400">kcal</p>
      </div>
      <button onClick={() => setConfirming(true)}
        className="w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center text-gray-200 hover:text-red-400 transition-colors flex-shrink-0">
        ×
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [dailyLog, setDailyLog] = useState<DailyLog | null>(null)
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [nutrients, setNutrients] = useState<Record<string, number>>({})

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        const { data: profileData } = await supabase
          .from('profiles').select('*').eq('id', user.id).single()

        if (profileData && !profileData.onboarding_completed) {
          router.push('/onboarding'); return
        }
        setProfile(profileData)

        const today = new Date().toISOString().split('T')[0]
        const [{ data: logData }, { data: mealsData }] = await Promise.all([
          supabase.from('daily_logs').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
          supabase.from('meals').select('*').eq('user_id', user.id).eq('meal_date', today).order('logged_at'),
        ])

        // Signed URLs for private photo bucket
        const mealsWithPhotos = await Promise.all(
          (mealsData ?? []).map(async (meal: Meal) => {
            if (!meal.photo_storage_path) return meal
            const { data: signed } = await supabase.storage
              .from('meal-photos').createSignedUrl(meal.photo_storage_path, 3600)
            return { ...meal, photo_url: signed?.signedUrl ?? meal.photo_url }
          })
        )

        setDailyLog(logData)
        setMeals(mealsWithPhotos)
        setNutrients((logData?.nutrient_totals as Record<string, number>) ?? {})
      } catch (e) {
        console.error('Dashboard load error:', e)
      } finally {
        setLoading(false)
      }
    }

    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  async function deleteMeal(meal: Meal) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const mealNutrients = (meal.nutrient_totals_mid as Record<string, number>) ?? {}
    const today = new Date().toISOString().split('T')[0]
    const updated: Record<string, number> = { ...nutrients }
    for (const [key, val] of Object.entries(mealNutrients)) {
      updated[key] = Math.max(0, (updated[key] ?? 0) - val)
    }
    await supabase.from('food_items').delete().eq('meal_id', meal.id)
    await supabase.from('meals').delete().eq('id', meal.id)
    const newCount = Math.max(0, (dailyLog?.meal_count ?? 1) - 1)
    await supabase.from('daily_logs')
      .update({ nutrient_totals: updated, meal_count: newCount })
      .eq('user_id', user.id).eq('date', today)
    setMeals(prev => prev.filter(m => m.id !== meal.id))
    setNutrients(updated)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading your day…</p>
        </div>
      </div>
    )
  }

  const totalEnergy   = nutrients.energy_kcal ?? 0
  const energyTarget  = profile?.daily_energy_target ?? 0
  const energyLow     = (profile as any)?.energy_range_low  ?? energyTarget
  const energyHigh    = (profile as any)?.energy_range_high ?? energyTarget
  const energyPct     = energyLow > 0 ? (totalEnergy / energyLow) * 100 : 0
  const isOnTrack     = totalEnergy >= energyLow
  const deficit       = Math.max(0, energyLow - Math.round(totalEnergy))

  const firstName = (profile as any)?.display_name || profile?.email?.split('@')[0] || 'there'
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="min-h-screen bg-cream-50 pb-28">

      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <p className="text-xs font-medium text-gray-400 tracking-wide mb-1">{today}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}, <span className="text-sage-700 capitalize">{firstName}</span>
          </h1>
          <div className="w-9 h-9 rounded-full bg-sage-100 flex items-center justify-center">
            <span className="text-sm font-bold text-sage-700 capitalize">{firstName[0]?.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-4">

        {/* Energy card */}
        <div className="card p-5 fade-up">
          <div className="flex items-center gap-5">
            <EnergyRing pct={energyPct} kcal={totalEnergy} low={energyLow} high={energyHigh} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Energy</p>
              <p className="text-3xl font-bold text-gray-900 leading-none">
                {Math.round(totalEnergy)}
                <span className="text-base font-normal text-gray-400 ml-1">kcal</span>
              </p>
              {energyLow > 0 ? (
                <div className="mt-2 space-y-0.5">
                  <p className="text-xs text-gray-400">Min <span className="font-semibold text-gray-600">{Math.round(energyLow)}</span> · Rec <span className="font-semibold text-gray-600">{Math.round(energyLow)}–{Math.round(energyHigh)}</span></p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-1">Complete onboarding for your target</p>
              )}
              <div className="mt-2.5 flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isOnTrack ? 'bg-sage-500' : deficit < energyLow * 0.3 ? 'bg-amber-400' : 'bg-gray-300'}`} />
                <span className="text-xs text-gray-500">
                  {isOnTrack ? 'Within target range ✓' : deficit > 0 ? `${deficit} kcal below minimum` : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Key nutrients */}
        <div className="card p-5 fade-up" style={{ animationDelay: '0.05s' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-800">Key Nutrients</h2>
            <span className="text-[11px] text-gray-400 font-medium">% of daily target</span>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            {KEY_NUTRIENTS.map(n => (
              <NutrientBar
                key={n.key}
                label={n.label}
                value={nutrients[n.key] ?? 0}
                dri={n.dri}
                unit={n.unit}
                color={n.color}
              />
            ))}
          </div>
        </div>

        {/* Today's meals */}
        <div className="fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800">Today's Meals</h2>
            <span className="text-[11px] text-gray-400 font-medium">{meals.length} logged</span>
          </div>

          <div className="card overflow-hidden">
            {meals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-16 h-16 bg-cream-100 rounded-2xl flex items-center justify-center text-3xl mb-3">📷</div>
                <p className="text-sm font-semibold text-gray-700 mb-1">No meals logged yet</p>
                <p className="text-xs text-gray-400 mb-5 leading-relaxed">Tap the camera button below to snap a photo — AI will identify everything</p>
                <Link href="/log" className="bg-sage-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-sage-700 transition-colors">
                  Log first meal
                </Link>
              </div>
            ) : (
              <div className="px-4">
                {meals.map(meal => (
                  <MealRow key={meal.id} meal={meal} onDelete={deleteMeal} />
                ))}
                <div className="py-3">
                  <Link href="/log" className="flex items-center justify-center gap-2 text-xs font-semibold text-sage-600 hover:text-sage-700 transition-colors">
                    <span className="text-base leading-none">+</span> Log another meal
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
