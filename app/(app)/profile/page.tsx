'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeDailyEnergyTarget, calculateExerciseEE } from '@/lib/engine/ea-calculator'

// ── Constants (mirrored from onboarding) ─────────────────────────────────────

const GOALS = [
  { value: 'general_wellness', label: 'General Wellness', emoji: '🌿' },
  { value: 'hormonal',         label: 'Hormonal Health',  emoji: '⚖️' },
  { value: 'athletic',         label: 'Athletic Performance', emoji: '🏃' },
  { value: 'gut_health',       label: 'Gut Health',       emoji: '🦠' },
]

const SEX_OPTIONS: Array<'female' | 'male'> = ['female', 'male']

const DIETARY_PATTERNS = [
  { value: 'omnivore',     label: 'Omnivore' },
  { value: 'flexitarian',  label: 'Flexitarian' },
  { value: 'vegetarian',   label: 'Vegetarian' },
  { value: 'vegan',        label: 'Vegan' },
  { value: 'pescatarian',  label: 'Pescatarian' },
  { value: 'gluten_free',  label: 'Gluten-free' },
  { value: 'dairy_free',   label: 'Dairy-free' },
]

const ACTIVITY_OPTIONS = [
  { value: 'walking',      label: 'Walking',           emoji: '🚶', met: 3.5 },
  { value: 'running',      label: 'Running',           emoji: '🏃', met: 9.8 },
  { value: 'cycling',      label: 'Cycling',           emoji: '🚴', met: 8.0 },
  { value: 'strength',     label: 'Strength training', emoji: '🏋️', met: 3.5 },
  { value: 'hiit_cardio',  label: 'HIIT / Cardio',     emoji: '⚡', met: 9.0 },
  { value: 'swimming',     label: 'Swimming',          emoji: '🏊', met: 7.0 },
  { value: 'yoga_pilates', label: 'Yoga / Pilates',    emoji: '🧘', met: 2.5 },
  { value: 'team_sports',  label: 'Team sports',       emoji: '⚽', met: 7.3 },
  { value: 'dance',        label: 'Dance',             emoji: '💃', met: 5.0 },
  { value: 'other',        label: 'Other',             emoji: '🤸', met: 5.0 },
]

type ExerciseSession = {
  activity: string
  met: number
  duration_min: number
  days_per_week: number
  emoji: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSyntheticLogs(sessions: ExerciseSession[], weight_kg: number) {
  const logs: Array<{ energy_kcal: number; logged_at: string; activity_type: string; duration_min: number }> = []
  const now = new Date()
  for (const session of sessions) {
    const ee = calculateExerciseEE({ weight_kg, met_value: session.met, duration_min: session.duration_min })
    for (let i = 0; i < session.days_per_week; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() - Math.round((i * 7) / Math.max(session.days_per_week, 1)))
      logs.push({ energy_kcal: ee, logged_at: date.toISOString(), activity_type: session.activity, duration_min: session.duration_min })
    }
  }
  return logs
}

function weeklyExerciseEE(sessions: ExerciseSession[], weight_kg: number): number {
  return sessions.reduce((sum, s) =>
    sum + calculateExerciseEE({ weight_kg: weight_kg || 65, met_value: s.met, duration_min: s.duration_min }) * s.days_per_week
  , 0)
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-50">
        <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')
  const [email, setEmail]       = useState('')

  // Body metrics
  const [weight, setWeight]     = useState('')
  const [height, setHeight]     = useState('')
  const [sex, setSex]           = useState<'female' | 'male'>('female')
  const [age, setAge]           = useState('')

  // Activity
  const [steps, setSteps]       = useState(7000)
  const [sessions, setSessions] = useState<ExerciseSession[]>([])
  const [newActivity, setNewActivity] = useState(ACTIVITY_OPTIONS[0])
  const [newDuration, setNewDuration] = useState(0)
  const [newDays, setNewDays]   = useState(0)

  // Goals & diet
  const [goals, setGoals]       = useState<string[]>([])
  const [diet, setDiet]         = useState('omnivore')

  // Computed energy
  const [energyTarget, setEnergyTarget] = useState(0)
  const [energyLow, setEnergyLow]       = useState(0)
  const [energyHigh, setEnergyHigh]     = useState(0)
  const [ffm, setFfm]                   = useState(0)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setEmail(user.email ?? '')

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!prof) { router.push('/onboarding'); return }

      setWeight(String(prof.weight_kg ?? ''))
      setHeight(String(prof.height_cm ?? ''))
      setSex(prof.sex ?? 'female')
      setAge(String(prof.age ?? ''))
      setSteps(prof.avg_daily_steps ?? 7000)
      setGoals(prof.goals ?? ['general_wellness'])
      setDiet(prof.dietary_pattern ?? 'omnivore')
      setEnergyTarget(prof.daily_energy_target ?? 0)
      setEnergyLow(prof.energy_range_low ?? 0)
      setEnergyHigh(prof.energy_range_high ?? 0)
      setFfm(prof.ffm_kg ?? 0)

      // Restore exercise sessions from stored typical_week if available
      if (prof.typical_week_sessions) {
        setSessions(prof.typical_week_sessions)
      }

      setLoading(false)
    }
    load()
  }, [])

  // Live-recompute energy as fields change
  useEffect(() => {
    const w = parseFloat(weight)
    const h = parseFloat(height)
    const a = parseInt(age)
    if (!w || !h || !a) return

    const logs = buildSyntheticLogs(sessions, w)
    const ea = computeDailyEnergyTarget({ weight_kg: w, height_cm: h, sex, avg_daily_steps: steps, exercise_logs_7day: logs, goals })
    setEnergyTarget(ea.daily_energy_target)
    setEnergyLow(ea.range_low)
    setEnergyHigh(ea.range_high)
    setFfm(ea.ffm_kg)
  }, [weight, height, sex, age, steps, sessions, goals])

  function toggleGoal(v: string) {
    setGoals(prev => prev.includes(v) ? prev.filter(g => g !== v) : [...prev, v])
  }

  function addSession() {
    setSessions(prev => [...prev, {
      activity: newActivity.value,
      met: newActivity.met,
      duration_min: newDuration,
      days_per_week: newDays,
      emoji: newActivity.emoji,
    }])
  }

  function removeSession(i: number) {
    setSessions(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!weight || !height || !age) { setError('Please fill in weight, height, and age'); return }
    if (goals.length === 0) { setError('Please select at least one goal'); return }
    setSaving(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const w = parseFloat(weight)
    const h = parseFloat(height)
    const logs = buildSyntheticLogs(sessions, w)
    const ea = computeDailyEnergyTarget({ weight_kg: w, height_cm: h, sex, avg_daily_steps: steps, exercise_logs_7day: logs, goals })

    const { error: saveError } = await supabase
      .from('profiles')
      .update({
        weight_kg: w,
        height_cm: h,
        sex,
        age: parseInt(age),
        avg_daily_steps: steps,
        goals,
        dietary_pattern: diet,
        typical_week_sessions: sessions,
        ffm_kg: ea.ffm_kg,
        ea_base_kcal: ea.ea_base_kcal,
        daily_energy_target: ea.daily_energy_target,
        energy_range_low: ea.range_low,
        energy_range_high: ea.range_high,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    setSaving(false)
    if (saveError) {
      setError(saveError.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const weightNum = parseFloat(weight) || 65
  const weeklyEE = weeklyExerciseEE(sessions, weightNum)
  const dailyExerciseAvg = Math.round(weeklyEE / 7)

  return (
    <div className="min-h-screen bg-cream-50">

      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
            <p className="text-xs text-gray-400 mt-0.5">{email}</p>
          </div>
          <div className="w-11 h-11 rounded-full bg-sage-100 flex items-center justify-center">
            <span className="text-base font-bold text-sage-700">{email[0]?.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-5 pb-32 space-y-4">

        {/* Energy summary card */}
        <div className="bg-gradient-to-br from-sage-600 to-sage-700 rounded-2xl p-5 text-white shadow-lg shadow-sage-400/20 fade-up">
          <p className="text-sage-200 text-[11px] font-semibold uppercase tracking-wider mb-3">Your energy target</p>
          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-4xl font-bold">{Math.round(energyLow)}</span>
            <span className="text-sage-300 text-lg">–</span>
            <span className="text-4xl font-bold">{Math.round(energyHigh)}</span>
            <span className="text-sage-300 text-sm ml-1">kcal/day</span>
          </div>
          <p className="text-sage-200 text-xs leading-relaxed">
            {Math.round(ffm)}kg fat-free mass · {dailyExerciseAvg > 0 ? `+${dailyExerciseAvg} kcal/day exercise` : 'no regular exercise'}
          </p>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-sage-300 animate-pulse" />
            <p className="text-sage-300 text-[11px]">Updates as you edit below</p>
          </div>
        </div>

        {/* Body metrics */}
        <Section title="Body metrics">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Weight (kg)</label>
              <input
                type="number" value={weight} onChange={e => setWeight(e.target.value)}
                className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
                placeholder="65"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Height (cm)</label>
              <input
                type="number" value={height} onChange={e => setHeight(e.target.value)}
                className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
                placeholder="165"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Biological sex</label>
            <div className="grid grid-cols-2 gap-2">
              {SEX_OPTIONS.map(s => (
                <button key={s} onClick={() => setSex(s)}
                  className={`py-3 rounded-xl text-sm font-semibold border transition-colors ${
                    sex === s ? 'bg-sage-600 text-white border-sage-600' : 'text-gray-700 border-gray-200 hover:border-sage-300'
                  }`}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Age</label>
            <input
              type="number" value={age} onChange={e => setAge(e.target.value)}
              className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="30"
            />
          </div>
        </Section>

        {/* Activity */}
        <Section title="Typical week">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Daily steps</label>
              <span className="text-sm font-bold text-sage-700">{steps.toLocaleString()}</span>
            </div>
            <input
              type="range" min={2000} max={20000} step={500} value={steps}
              onChange={e => setSteps(parseInt(e.target.value))}
              className="w-full accent-sage-600"
            />
            <div className="flex justify-between text-xs text-gray-300 mt-1">
              <span>2k — sedentary</span><span>20k — very active</span>
            </div>
          </div>

          <div className="border-t border-gray-50 pt-3">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Workouts</label>
            <div className="space-y-2">
              <select
                value={newActivity.value}
                onChange={e => setNewActivity(ACTIVITY_OPTIONS.find(a => a.value === e.target.value) ?? ACTIVITY_OPTIONS[0])}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 bg-white"
              >
                {ACTIVITY_OPTIONS.map(a => (
                  <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Duration (min)</label>
                  <input type="number" min={5} max={240} value={newDuration}
                    onChange={e => setNewDuration(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Days / week</label>
                  <input type="number" min={1} max={7} value={newDays}
                    onChange={e => setNewDays(Math.min(7, Math.max(1, parseInt(e.target.value) || 0)))}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
                  />
                </div>
              </div>
              <button onClick={addSession}
                className="w-full border-2 border-dashed border-sage-200 hover:border-sage-400 text-sage-600 hover:text-sage-700 font-medium py-2.5 rounded-xl text-sm transition-colors">
                + Add session
              </button>
            </div>
          </div>

          {sessions.length > 0 && (
            <div className="space-y-2">
              {sessions.map((s, i) => {
                const eePerSession = Math.round(calculateExerciseEE({ weight_kg: weightNum, met_value: s.met, duration_min: s.duration_min }))
                return (
                  <div key={i} className="flex items-center gap-2 bg-cream-50 rounded-xl px-3 py-2.5">
                    <span className="text-lg">{s.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700 capitalize">{s.activity.replace('_', ' ')}</p>
                      <p className="text-xs text-gray-400">{s.duration_min} min × {s.days_per_week}×/wk · ~{eePerSession} kcal/session</p>
                    </div>
                    <button onClick={() => removeSession(i)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                  </div>
                )
              })}
              <div className="bg-sage-50 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-sage-700">Weekly exercise burn</p>
                  <p className="text-xs text-sage-600">{Math.round(weeklyEE)} kcal/week · {dailyExerciseAvg} kcal/day avg</p>
                </div>
                <span className="text-2xl">🔥</span>
              </div>
            </div>
          )}

          {sessions.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-1">No workouts added</p>
          )}
        </Section>

        {/* Goals */}
        <Section title="Goals">
          <div className="grid grid-cols-2 gap-2">
            {GOALS.map(g => (
              <button key={g.value} onClick={() => toggleGoal(g.value)}
                className={`p-3 rounded-2xl text-sm font-semibold border text-left transition-colors ${
                  goals.includes(g.value)
                    ? 'bg-sage-50 text-sage-800 border-sage-400'
                    : 'text-gray-700 border-gray-200 hover:border-sage-300'
                }`}>
                <span className="text-xl block mb-1">{g.emoji}</span>
                {g.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Dietary pattern */}
        <Section title="Dietary pattern">
          <div className="grid grid-cols-2 gap-2">
            {DIETARY_PATTERNS.map(d => (
              <button key={d.value} onClick={() => setDiet(d.value)}
                className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors ${
                  diet === d.value
                    ? 'bg-sage-600 text-white border-sage-600'
                    : 'text-gray-600 border-gray-200 hover:border-sage-300'
                }`}>
                {d.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          className={`w-full font-semibold py-4 rounded-2xl text-sm transition-all active:scale-[0.98] shadow-lg ${
            saved
              ? 'bg-sage-500 text-white shadow-sage-300/40'
              : 'bg-sage-600 hover:bg-sage-700 active:bg-sage-800 text-white shadow-sage-300/40 disabled:opacity-50'
          }`}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
        </button>

        {/* Sign out */}
        <button onClick={handleSignOut}
          className="w-full py-3.5 rounded-2xl text-sm font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-100 transition-colors">
          Sign out
        </button>

      </div>
    </div>
  )
}
