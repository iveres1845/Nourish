'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ── Types ────────────────────────────────────────────────────────────────────
interface MealRow { id: string; meal_type: string; photo_url?: string; meal_date: string; nutrient_totals_mid?: any }
interface NutrientTotals { energy_kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }

// ── Nourishment Score helpers ─────────────────────────────────────────────────
function calcNourishmentScore(nutrients: NutrientTotals, energyMin: number, meals: MealLog[]) {
  const fuelPct  = energyMin > 0 ? Math.min((nutrients.energy_kcal / energyMin) * 100, 100) : 0
  const proteinPct = Math.min((nutrients.protein_g / 85) * 100, 100)
  const fiberPct   = Math.min((nutrients.fiber_g   / 25) * 100, 100)
  const microPct   = (proteinPct + fiberPct) / 2
  const varietyPct = Math.min((meals.length / 4) * 100, 100)
  return Math.round(fuelPct * 0.4 + microPct * 0.4 + varietyPct * 0.2)
}

function scoreLabel(score: number): { text: string; color: string } {
  if (score >= 85) return { text: 'Thriving',       color: '#638c57' }
  if (score >= 65) return { text: 'On Track',        color: '#7aad6c' }
  if (score >= 45) return { text: 'Building',        color: '#d4a847' }
  if (score >= 25) return { text: 'Needs Fuel',      color: '#c97b5a' }
  return            { text: 'Start Fuelling',  color: '#b55a3a' }
}

// ── Nourishment Ring ──────────────────────────────────────────────────────────
function NourishmentRing({ score }: { score: number }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const { text, color } = scoreLabel(score)
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" className="drop-shadow-sm flex-shrink-0">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#f0ede6" strokeWidth="10" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 70 70)"
        style={{ transition: 'stroke-dashoffset 1s ease' }}
      />
      <text x="70" y="64" textAnchor="middle" fontSize="28" fontWeight="700" fill="#1a1a1a">{score}</text>
      <text x="70" y="80" textAnchor="middle" fontSize="11" fontWeight="600" fill={color}>{text}</text>
      <text x="70" y="95" textAnchor="middle" fontSize="9"  fill="#aaa">/100</text>
    </svg>
  )
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function BiofeedbackMini({ label, emoji, data }: { label: string; emoji: string; data: { date: string; value: number }[] }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-0.5 mb-1">
        <span className="text-sm leading-none">{emoji}</span>
      </div>
      <div className="flex items-end gap-[2px] h-8">
        {data.map((d, i) => (
          <div key={i} className="flex-1"
            style={{
              height: d.value > 0 ? `${(d.value / 5) * 28}px` : '2px',
              backgroundColor: d.value >= 4 ? '#638c57' : d.value >= 3 ? '#d4a847' : d.value > 0 ? '#c97b5a' : '#e5e5e5',
              borderRadius: '2px',
              minHeight: '2px',
            }}
          />
        ))}
      </div>
      <p className="text-[9px] text-gray-400 mt-0.5 truncate">{label}</p>
    </div>
  )
}

// ── Score Row ─────────────────────────────────────────────────────────────────
function ScoreRow({ label, pct }: { label: string; pct: number }) {
  const p = Math.round(Math.min(pct, 100))
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-semibold text-gray-700">{p}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${p}%`, backgroundColor: p >= 75 ? '#638c57' : p >= 50 ? '#d4a847' : '#c97b5a' }}
        />
      </div>
    </div>
  )
}

function MacroChip({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="bg-cream-50 rounded-xl py-2 px-1 text-center">
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
      <p className="text-sm font-bold text-gray-700 mt-0.5">{value}<span className="text-[10px] font-normal ml-px">{unit}</span></p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router  = useRouter()
  const supabase = createClient()

  const [profile,     setProfile]     = useState<any>(null)
  const [meals,       setMeals]       = useState<MealRow[]>([])
  const [nutrients,   setNutrients]   = useState<NutrientTotals>({ energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 })
  const [biofeedback, setBiofeedback] = useState<any[]>([])
  const [cycleLog,    setCycleLog]    = useState<any>(null)
  const [loading,     setLoading]     = useState(true)

  const today       = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [profRes, mealsRes, dailyRes, bioRes, cycleRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('meals').select('id, meal_type, photo_url, meal_date, nutrient_totals_mid')
          .eq('user_id', user.id).eq('meal_date', today).order('meal_date', { ascending: true }),
        supabase.from('daily_logs').select('nutrient_totals')
          .eq('user_id', user.id).eq('date', today).maybeSingle(),
        supabase.from('biofeedback_logs').select('*').eq('user_id', user.id)
          .gte('date', sevenDaysAgo).order('date', { ascending: true }),
        supabase.from('cycle_logs').select('*').eq('user_id', user.id)
          .order('period_start', { ascending: false }).limit(1).maybeSingle(),
      ])

      setProfile(profRes.data)
      setMeals(mealsRes.data ?? [])

      // nutrient totals come from daily_logs (pre-aggregated on save)
      const nt = dailyRes.data?.nutrient_totals ?? {}
      setNutrients({
        energy_kcal: nt.energy_kcal ?? 0,
        protein_g:   nt.protein_g   ?? 0,
        carbs_g:     nt.carbohydrate_g ?? nt.carbs_g ?? 0,
        fat_g:       nt.fat_g       ?? 0,
        fiber_g:     nt.fiber_g     ?? 0,
      })
      setBiofeedback(bioRes.data ?? [])
      setCycleLog(cycleRes.data ?? null)
    } finally {
      setLoading(false)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const energyTarget = profile?.daily_energy_target ?? 0
  const energyLow    = profile?.energy_range_low  ?? energyTarget
  const energyHigh   = profile?.energy_range_high ?? energyTarget
  const showCalories = profile?.show_calories ?? false
  const isFemale     = profile?.sex === 'female'
  const firstName    = profile?.display_name || profile?.email?.split('@')[0] || 'there'

  const energyPct    = energyLow > 0 ? Math.min((nutrients.energy_kcal / energyLow) * 100, 100) : 0
  const nourishScore = loading ? 0 : calcNourishmentScore(nutrients, energyLow, meals)

  function getEnergyLabel() {
    if (energyLow === 0) return { text: 'Complete your profile for a target', color: 'text-gray-400' }
    if (energyPct >= 95) return { text: 'Well fuelled today ✓',              color: 'text-sage-600' }
    if (energyPct >= 75) return { text: 'On track — keep going',              color: 'text-sage-500' }
    if (energyPct >= 50) return { text: 'Building — keep eating',             color: 'text-amber-500' }
    if (energyPct >= 25) return { text: 'Big energy gap today',               color: 'text-terracotta-500' }
    return                     { text: 'Start fuelling your body',            color: 'text-terracotta-400' }
  }
  const energyLabel = getEnergyLabel()

  const todayBio = biofeedback.find(b => b.date === today)

  function buildTrend(key: string) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000).toISOString().split('T')[0]
      const found = biofeedback.find(b => b.date === d)
      return { date: d, value: found?.[key] ?? 0 }
    })
  }

  function cycleDay() {
    if (!cycleLog?.period_start) return null
    const diff = Math.floor((Date.now() - new Date(cycleLog.period_start).getTime()) / 86400000) + 1
    return diff > 0 ? diff : null
  }
  const day = cycleDay()

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream-50 pb-28">

      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <p className="text-xs font-medium text-gray-400 tracking-wide mb-1">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Nest</h1>
            <p className="text-sm text-gray-400 mt-0.5">Hey {firstName} 👋</p>
          </div>
          <Link href="/log"
            className="bg-sage-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-sm shadow-sage-300/40">
            + Nourish
          </Link>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-4">

        {/* Nourishment Score */}
        <div className="card p-5 fade-up">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">Nourishment Score</p>
          <div className="flex items-center gap-5">
            <NourishmentRing score={nourishScore} />
            <div className="flex-1 space-y-3">
              <ScoreRow label="Fuelling"  pct={energyLow > 0 ? energyPct : 0} />
              <ScoreRow label="Nutrients" pct={Math.min(((nutrients.protein_g / 85) + (nutrients.fiber_g / 25)) / 2 * 100, 100)} />
              <ScoreRow label="Variety"   pct={Math.min((meals.length / 4) * 100, 100)} />
            </div>
          </div>
          <p className="text-[10px] text-gray-300 mt-4 text-center">fuelling 40% · nutrients 40% · variety 20%</p>
        </div>

        {/* Energy */}
        <div className="card p-4 fade-up">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Energy today</p>
          {showCalories ? (
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-gray-900">{Math.round(nutrients.energy_kcal)}</span>
              <span className="text-base text-gray-400 mb-0.5">kcal</span>
              {energyLow > 0 && (
                <span className="text-xs text-gray-400 mb-0.5 ml-1">/ {Math.round(energyLow)}–{Math.round(energyHigh)}</span>
              )}
            </div>
          ) : (
            <p className={`text-base font-bold ${energyLabel.color}`}>{energyLabel.text}</p>
          )}
          {energyLow > 0 && (
            <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${energyPct}%`,
                  backgroundColor: energyPct >= 75 ? '#638c57' : energyPct >= 50 ? '#d4a847' : '#c97b5a' }}
              />
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MacroChip label="Protein" value={Math.round(nutrients.protein_g)} unit="g" />
            <MacroChip label="Carbs"   value={Math.round(nutrients.carbs_g)}   unit="g" />
            <MacroChip label="Fat"     value={Math.round(nutrients.fat_g)}     unit="g" />
          </div>
          {!showCalories && (
            <p className="text-[10px] text-gray-300 mt-2 text-center">numbers off · toggle in Profile</p>
          )}
        </div>

        {/* Meals */}
        {meals.length > 0 ? (
          <div className="card p-4 fade-up">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Today's meals</p>
            <div className="space-y-2.5">
              {meals.map(m => {
                const kcal = m.nutrient_totals_mid?.energy_kcal
                const label = m.meal_type
                  ? m.meal_type.charAt(0).toUpperCase() + m.meal_type.slice(1).replace(/_/g, ' ')
                  : 'Meal'
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    {m.photo_url ? (
                      <img src={m.photo_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-cream-100 flex items-center justify-center flex-shrink-0 text-xl">🍽️</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800 truncate">{label}</p>
                      <p className="text-xs text-gray-400">
                        {kcal ? `${Math.round(kcal)} kcal` : 'logged'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <Link href="/log" className="block card p-5 text-center fade-up border-2 border-dashed border-sage-200 bg-sage-50/40">
            <div className="text-3xl mb-2">🍽️</div>
            <p className="text-sm font-semibold text-sage-600">Log your first meal today</p>
            <p className="text-xs text-gray-400 mt-1">Tap Nourish to open the camera</p>
          </Link>
        )}

        {/* Biofeedback Trends */}
        {biofeedback.length > 0 ? (
          <div className="card p-4 fade-up">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">7-day biofeedback</p>
              <Link href="/notice" className="text-xs text-sage-600 font-semibold">+ today</Link>
            </div>
            {todayBio && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  { key: 'energy', emoji: '⚡' }, { key: 'mood', emoji: '🧠' },
                  { key: 'sleep_quality', emoji: '🌙' }, { key: 'recovery', emoji: '💪' },
                  { key: 'digestion', emoji: '🌿' },
                ].map(({ key, emoji }) =>
                  todayBio[key] ? (
                    <span key={key} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      todayBio[key] >= 4 ? 'bg-sage-100 text-sage-700' :
                      todayBio[key] >= 3 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'
                    }`}>
                      {emoji} {todayBio[key]}/5
                    </span>
                  ) : null
                )}
              </div>
            )}
            <div className="flex gap-2">
              <BiofeedbackMini label="Energy"    emoji="⚡" data={buildTrend('energy')} />
              <BiofeedbackMini label="Mood"      emoji="🧠" data={buildTrend('mood')} />
              <BiofeedbackMini label="Sleep"     emoji="🌙" data={buildTrend('sleep_quality')} />
              <BiofeedbackMini label="Recovery"  emoji="💪" data={buildTrend('recovery')} />
              <BiofeedbackMini label="Digestion" emoji="🌿" data={buildTrend('digestion')} />
            </div>
          </div>
        ) : (
          <Link href="/notice" className="block card p-5 text-center fade-up border-2 border-dashed border-cream-200 bg-cream-50/60">
            <div className="text-3xl mb-2">📋</div>
            <p className="text-sm font-semibold text-gray-600">Log a Notice check-in</p>
            <p className="text-xs text-gray-400 mt-1">Track energy, mood, sleep & more</p>
          </Link>
        )}

        {/* Cycle Widget — female users only */}
        {isFemale && (
          <div className="card p-4 fade-up">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cycle</p>
              <Link href="/cycle" className="text-xs text-sage-600 font-semibold">Manage</Link>
            </div>
            {day ? (
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-terracotta-50 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-2xl font-bold text-terracotta-600">{day}</span>
                  <span className="text-[9px] font-medium text-terracotta-400">cycle day</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-700">
                    {day <= 5 ? 'Menstrual phase' : day <= 13 ? 'Follicular phase' : day <= 16 ? 'Ovulation' : 'Luteal phase'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {day <= 5  ? 'Rest & prioritise iron-rich foods' :
                     day <= 13 ? 'Energy building — great time to train' :
                     day <= 16 ? 'Peak energy & strength' :
                     'Increase carbs & magnesium-rich foods'}
                  </p>
                  <p className="text-[10px] text-gray-300 mt-1">
                    since {new Date(cycleLog.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              </div>
            ) : (
              <Link href="/cycle" className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-terracotta-50 flex items-center justify-center flex-shrink-0 text-xl">🌸</div>
                <div>
                  <p className="text-sm font-semibold text-terracotta-600">Log your cycle</p>
                  <p className="text-xs text-gray-400">Get personalised nutrition insights</p>
                </div>
              </Link>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
