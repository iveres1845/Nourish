'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const SYMPTOMS = [
  'Cramps', 'Bloating', 'Fatigue', 'Headache', 'Mood swings',
  'Breast tenderness', 'Back pain', 'Acne', 'Cravings', 'Brain fog',
  'Low energy', 'Anxiety', 'Insomnia', 'Nausea',
]

const FLOW_OPTIONS = [
  { value: 'none',     label: 'None',     color: 'bg-gray-100 text-gray-500' },
  { value: 'spotting', label: 'Spotting', color: 'bg-terracotta-50 text-terracotta-400' },
  { value: 'light',    label: 'Light',    color: 'bg-terracotta-100 text-terracotta-500' },
  { value: 'medium',   label: 'Medium',   color: 'bg-terracotta-200 text-terracotta-600' },
  { value: 'heavy',    label: 'Heavy',    color: 'bg-terracotta-300 text-terracotta-700' },
]

export default function CyclePage() {
  const router  = useRouter()
  const supabase = createClient()

  const [cycles,        setCycles]        = useState<any[]>([])
  const [todaySymptoms, setTodaySymptoms] = useState<any>(null)
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)

  // New period form
  const [showNewPeriod, setShowNewPeriod] = useState(false)
  const [periodStart,   setPeriodStart]   = useState('')
  const [periodEnd,     setPeriodEnd]     = useState('')

  // Today symptoms
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([])
  const [flow,              setFlow]             = useState('')
  const [symNotes,          setSymNotes]         = useState('')

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [cyclesRes, symRes] = await Promise.all([
        supabase.from('cycle_logs').select('*').eq('user_id', user.id)
          .order('period_start', { ascending: false }).limit(6),
        supabase.from('cycle_symptoms').select('*').eq('user_id', user.id)
          .eq('date', today).maybeSingle(),
      ])

      setCycles(cyclesRes.data ?? [])
      if (symRes.data) {
        setTodaySymptoms(symRes.data)
        setSelectedSymptoms(symRes.data.symptoms ?? [])
        setFlow(symRes.data.flow ?? '')
        setSymNotes(symRes.data.notes ?? '')
      }
    } finally {
      setLoading(false)
    }
  }

  async function logPeriod() {
    if (!periodStart) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('cycle_logs').insert({
      user_id:     user.id,
      period_start: periodStart,
      period_end:  periodEnd || null,
    })

    setSaving(false)
    setShowNewPeriod(false)
    setPeriodStart('')
    setPeriodEnd('')
    load()
  }

  async function saveSymptoms() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('cycle_symptoms').upsert({
      user_id:  user.id,
      date:     today,
      symptoms: selectedSymptoms,
      flow:     flow || null,
      notes:    symNotes.trim() || null,
    }, { onConflict: 'user_id,date' })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function toggleSymptom(sym: string) {
    setSelectedSymptoms(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const latestCycle = cycles[0]

  return (
    <div className="min-h-screen bg-cream-50 pb-28">

      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-50">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Cycle</h1>
        </div>
        <p className="text-sm text-gray-400 ml-8">Track your period & daily symptoms</p>
      </div>

      <div className="px-4 pt-5 space-y-4">

        {/* Current cycle summary */}
        {latestCycle && (
          <div className="card p-4 fade-up">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Current cycle</p>
            <div className="flex items-center gap-4">
              <CyclePhaseWidget cycle={latestCycle} />
              <div className="flex-1">
                <p className="text-xs text-gray-500 mb-1">
                  Started <span className="font-semibold text-gray-700">
                    {new Date(latestCycle.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                  </span>
                </p>
                {latestCycle.period_end && (
                  <p className="text-xs text-gray-500 mb-1">
                    Ended <span className="font-semibold text-gray-700">
                      {new Date(latestCycle.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                    </span>
                  </p>
                )}
                {!latestCycle.period_end && (
                  <button
                    onClick={async () => {
                      const { data: { user } } = await supabase.auth.getUser()
                      if (!user) return
                      await supabase.from('cycle_logs').update({ period_end: today }).eq('id', latestCycle.id)
                      load()
                    }}
                    className="text-xs text-terracotta-500 font-semibold mt-1 active:scale-95 transition-all"
                  >
                    Mark period ended today →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Log new period */}
        {!showNewPeriod ? (
          <button
            onClick={() => setShowNewPeriod(true)}
            className="w-full card p-4 text-left flex items-center gap-3 active:scale-[0.98] transition-all fade-up"
          >
            <div className="w-10 h-10 rounded-xl bg-terracotta-50 flex items-center justify-center flex-shrink-0 text-xl">🌸</div>
            <div>
              <p className="text-sm font-bold text-terracotta-600">
                {cycles.length === 0 ? 'Log your first period' : 'Log new period'}
              </p>
              <p className="text-xs text-gray-400">Record start and end dates</p>
            </div>
          </button>
        ) : (
          <div className="card p-4 fade-up space-y-3">
            <p className="text-sm font-bold text-gray-800">🌸 New period</p>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Period start *</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} max={today}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-terracotta-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Period end <span className="font-normal text-gray-400">(optional)</span></label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} min={periodStart} max={today}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-terracotta-300" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowNewPeriod(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold active:scale-95 transition-all">
                Cancel
              </button>
              <button onClick={logPeriod} disabled={!periodStart || saving}
                className="flex-1 py-3 rounded-xl bg-terracotta-500 text-white text-sm font-semibold disabled:opacity-40 active:scale-95 transition-all">
                {saving ? 'Saving…' : 'Save period'}
              </button>
            </div>
          </div>
        )}

        {/* Today's symptoms */}
        <div className="card p-4 fade-up">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Today's symptoms</p>

          {/* Flow */}
          <p className="text-xs font-semibold text-gray-600 mb-2">Flow</p>
          <div className="flex gap-2 mb-4">
            {FLOW_OPTIONS.map(f => (
              <button key={f.value}
                onClick={() => setFlow(flow === f.value ? '' : f.value)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                  flow === f.value ? `${f.color} ring-2 ring-offset-1 ring-terracotta-400` : `${f.color} opacity-60`
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Symptom chips */}
          <p className="text-xs font-semibold text-gray-600 mb-2">Symptoms</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {SYMPTOMS.map(sym => (
              <button key={sym}
                onClick={() => toggleSymptom(sym)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 ${
                  selectedSymptoms.includes(sym)
                    ? 'bg-sage-600 text-white'
                    : 'bg-cream-100 text-gray-500'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          {/* Notes */}
          <p className="text-xs font-semibold text-gray-600 mb-1">Notes</p>
          <textarea
            value={symNotes} onChange={e => setSymNotes(e.target.value)}
            placeholder="Anything else to note…"
            rows={2}
            className="w-full text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none bg-transparent mb-3"
          />

          <button onClick={saveSymptoms} disabled={saving}
            className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 disabled:opacity-40 text-white font-semibold py-3.5 rounded-2xl text-sm transition-all">
            {saving ? 'Saving…' : saved ? '✓ Saved' : todaySymptoms ? 'Update symptoms' : 'Save symptoms'}
          </button>
        </div>

        {/* History */}
        {cycles.length > 1 && (
          <div className="card p-4 fade-up">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">History</p>
            <div className="space-y-2">
              {cycles.slice(1).map(c => (
                <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-gray-700">
                      {new Date(c.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {c.period_end && (
                      <p className="text-xs text-gray-400">
                        to {new Date(c.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        {' '}·{' '}
                        {Math.round((new Date(c.period_end).getTime() - new Date(c.period_start).getTime()) / 86400000) + 1}d
                      </p>
                    )}
                  </div>
                  <div className="w-2 h-2 rounded-full bg-terracotta-300" />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function CyclePhaseWidget({ cycle }: { cycle: any }) {
  const day = Math.floor((Date.now() - new Date(cycle.period_start).getTime()) / 86400000) + 1
  const phase = day <= 5 ? 'Menstrual' : day <= 13 ? 'Follicular' : day <= 16 ? 'Ovulation' : 'Luteal'
  const color = day <= 5 ? '#c97b5a' : day <= 13 ? '#7aad6c' : day <= 16 ? '#d4a847' : '#8b6fc9'

  return (
    <div className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center flex-shrink-0"
      style={{ backgroundColor: `${color}18` }}>
      <span className="text-xl font-bold" style={{ color }}>{day}</span>
      <span className="text-[8px] font-semibold" style={{ color }}>{phase}</span>
    </div>
  )
}
