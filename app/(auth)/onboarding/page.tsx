'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeDailyEnergyTarget, calculateExerciseEE } from '@/lib/engine/ea-calculator'

// ── Constants ────────────────────────────────────────────────────────────────

const GOALS = [
  { value: 'general_wellness', label: 'General Wellness', emoji: '🌿' },
  { value: 'hormonal', label: 'Hormonal Health', emoji: '⚖️' },
  { value: 'athletic', label: 'Athletic Performance', emoji: '🏃' },
  { value: 'gut_health', label: 'Gut Health', emoji: '🦠' },
]

const SEX_OPTIONS: Array<'female' | 'male'> = ['female', 'male']

const DIETARY_PATTERNS = [
  { value: 'omnivore', label: 'Omnivore' },
  { value: 'flexitarian', label: 'Flexitarian' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'gluten_free', label: 'Gluten-free' },
  { value: 'dairy_free', label: 'Dairy-free' },
]

// Representative MET values per activity (moderate intensity)
const ACTIVITY_OPTIONS = [
  { value: 'walking',      label: 'Walking',          emoji: '🚶', met: 3.5 },
  { value: 'running',      label: 'Running',          emoji: '🏃', met: 9.8 },
  { value: 'cycling',      label: 'Cycling',          emoji: '🚴', met: 8.0 },
  { value: 'strength',     label: 'Strength training',emoji: '🏋️', met: 3.5 },
  { value: 'hiit_cardio',  label: 'HIIT / Cardio',    emoji: '⚡', met: 9.0 },
  { value: 'swimming',     label: 'Swimming',         emoji: '🏊', met: 7.0 },
  { value: 'yoga_pilates', label: 'Yoga / Pilates',   emoji: '🧘', met: 2.5 },
  { value: 'team_sports',  label: 'Team sports',      emoji: '⚽', met: 7.3 },
  { value: 'dance',        label: 'Dance',            emoji: '💃', met: 5.0 },
  { value: 'other',        label: 'Other',            emoji: '🤸', met: 5.0 },
]

type ExerciseSession = {
  activity: string
  met: number
  duration_min: number
  days_per_week: number
  emoji: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSyntheticLogs(sessions: ExerciseSession[], weight_kg: number) {
  const logs: Array<{ energy_kcal: number; logged_at: string; activity_type: string; duration_min: number }> = []
  const now = new Date()

  for (const session of sessions) {
    const ee = calculateExerciseEE({ weight_kg, met_value: session.met, duration_min: session.duration_min })
    for (let i = 0; i < session.days_per_week; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() - Math.round((i * 7) / Math.max(session.days_per_week, 1)))
      logs.push({
        energy_kcal: ee,
        logged_at: date.toISOString(),
        activity_type: session.activity,
        duration_min: session.duration_min,
      })
    }
  }
  return logs
}

function weeklyExerciseEE(sessions: ExerciseSession[], weight_kg: number): number {
  return sessions.reduce((sum, s) => {
    return sum + calculateExerciseEE({ weight_kg: weight_kg || 65, met_value: s.met, duration_min: s.duration_min }) * s.days_per_week
  }, 0)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Step 1
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [sex, setSex] = useState<'female' | 'male' | ''>('')
  const [age, setAge] = useState('')

  // Step 2
  const [steps, setSteps] = useState(7000)
  const [sessions, setSessions] = useState<ExerciseSession[]>([])
  const [newActivity, setNewActivity] = useState(ACTIVITY_OPTIONS[0])
  const [newDuration, setNewDuration] = useState(45)
  const [newDays, setNewDays] = useState(3)

  // Step 3
  const [goals, setGoals] = useState<string[]>(['general_wellness'])
  const [dietaryPattern, setDietaryPattern] = useState('omnivore')

  function toggleGoal(value: string) {
    setGoals(prev => prev.includes(value) ? prev.filter(g => g !== value) : [...prev, value])
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

  async function handleSubmit() {
    if (goals.length === 0) {
      setError('Please select at least one goal')
      return
    }
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const weight_kg = parseFloat(weight)
    const height_cm = parseFloat(height)
    const sexVal = sex as 'female' | 'male'

    const syntheticLogs = buildSyntheticLogs(sessions, weight_kg)

    const ea = computeDailyEnergyTarget({
      weight_kg,
      height_cm,
      sex: sexVal,
      avg_daily_steps: steps,
      exercise_logs_7day: syntheticLogs,
      goals,
    })

    const { error: saveError } = await supabase
      .from('profiles')
      .update({
        weight_kg,
        height_cm,
        sex: sexVal,
        age: parseInt(age),
        avg_daily_steps: steps,
        goals,
        dietary_pattern: dietaryPattern,
        onboarding_completed: true,
        ffm_kg: ea.ffm_kg,
        ea_base_kcal: ea.ea_base_kcal,
        daily_energy_target: ea.daily_energy_target,
        energy_range_low: ea.range_low,
        energy_range_high: ea.range_high,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (saveError) {
      setError(saveError.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  const weightNum = parseFloat(weight) || 65
  const weeklyEE = weeklyExerciseEE(sessions, weightNum)
  const dailyExerciseEE = Math.round(weeklyEE / 7)

  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-semibold text-sage-800 tracking-tight">nourish</h1>
          <p className="text-sm text-gray-500 mt-1">Let's personalise your energy needs</p>
        </div>

        {/* Progress */}
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3].map(i => (
            <div key={i} className={`h-2 rounded-full transition-all duration-300 ${
              i === step ? 'w-8 bg-sage-600' : i < step ? 'w-2 bg-sage-400' : 'w-2 bg-gray-200'
            }`} />
          ))}
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">

          {/* ── Step 1: Body metrics ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">About your body</h2>
                <p className="text-sm text-gray-400 mt-0.5">Used to calculate your fat-free mass and energy needs</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Weight (kg)</label>
                  <input
                    type="number"
                    value={weight}
                    onChange={e => setWeight(e.target.value)}
                    className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent"
                    placeholder="65"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Height (cm)</label>
                  <input
                    type="number"
                    value={height}
                    onChange={e => setHeight(e.target.value)}
                    className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent"
                    placeholder="165"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Biological sex</label>
                <div className="grid grid-cols-2 gap-2">
                  {SEX_OPTIONS.map(s => (
                    <button key={s} type="button" onClick={() => setSex(s)}
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
                  type="number"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent"
                  placeholder="30"
                />
              </div>

              {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

              <button
                onClick={() => {
                  if (!weight || !height || !sex || !age) { setError('Please fill in all fields'); return }
                  setError(''); setStep(2)
                }}
                className="w-full bg-sage-600 hover:bg-sage-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                Continue →
              </button>
            </div>
          )}

          {/* ── Step 2: Activity & exercise ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Your typical week</h2>
                <p className="text-sm text-gray-400 mt-0.5">Add your regular workouts — we'll compute a weekly average so your target stays consistent</p>
              </div>

              {/* Daily steps */}
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
                  <span>2k — sedentary</span>
                  <span>20k — very active</span>
                </div>
              </div>

              <div className="border-t border-gray-50" />

              {/* Add exercise session */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add a workout</label>
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
                      <input
                        type="number" min={5} max={240} value={newDuration}
                        onChange={e => setNewDuration(parseInt(e.target.value) || 30)}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Days / week</label>
                      <input
                        type="number" min={1} max={7} value={newDays}
                        onChange={e => setNewDays(Math.min(7, Math.max(1, parseInt(e.target.value) || 1)))}
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

              {/* Session list */}
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

                  {/* Weekly summary */}
                  <div className="bg-sage-50 rounded-xl px-4 py-3 flex items-center justify-between mt-1">
                    <div>
                      <p className="text-xs font-semibold text-sage-700">Weekly exercise burn</p>
                      <p className="text-xs text-sage-600">{Math.round(weeklyEE)} kcal/week · {dailyExerciseEE} kcal/day avg</p>
                    </div>
                    <span className="text-2xl">🔥</span>
                  </div>
                </div>
              )}

              {sessions.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">No workouts added — that's fine if you're not currently exercising</p>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep(1)}
                  className="flex-1 border border-gray-200 text-gray-600 font-semibold py-3 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                  Back
                </button>
                <button onClick={() => setStep(3)}
                  className="flex-1 bg-sage-600 hover:bg-sage-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Goals & diet ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Your goals</h2>
                <p className="text-sm text-gray-400 mt-0.5">Pick all that apply — this shapes your nutrient targets</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {GOALS.map(g => (
                  <button key={g.value} type="button" onClick={() => toggleGoal(g.value)}
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

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Dietary pattern</label>
                <div className="grid grid-cols-2 gap-2">
                  {DIETARY_PATTERNS.map(d => (
                    <button key={d.value} type="button" onClick={() => setDietaryPattern(d.value)}
                      className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors ${
                        dietaryPattern === d.value
                          ? 'bg-sage-600 text-white border-sage-600'
                          : 'text-gray-600 border-gray-200 hover:border-sage-300'
                      }`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

              <div className="flex gap-2">
                <button onClick={() => setStep(2)}
                  className="flex-1 border border-gray-200 text-gray-600 font-semibold py-3 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                  Back
                </button>
                <button onClick={handleSubmit} disabled={loading}
                  className="flex-1 bg-sage-600 hover:bg-sage-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
                  {loading ? 'Saving…' : 'Let\'s go →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
