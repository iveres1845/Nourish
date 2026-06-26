'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { localDate } from '@/lib/utils/date'

const MARKERS = [
  {
    key: 'energy',
    label: 'Energy',
    question: 'How are your energy levels?',
    emoji: '⚡',
    options: [
      { value: 1, emoji: '😴', label: 'Exhausted' },
      { value: 2, emoji: '😔', label: 'Low' },
      { value: 3, emoji: '😐', label: 'OK' },
      { value: 4, emoji: '😊', label: 'Good' },
      { value: 5, emoji: '🔥', label: 'Great' },
    ],
  },
  {
    key: 'mood',
    label: 'Mood',
    question: 'How is your mood?',
    emoji: '🧠',
    options: [
      { value: 1, emoji: '😞', label: 'Low' },
      { value: 2, emoji: '😕', label: 'Off' },
      { value: 3, emoji: '😐', label: 'Neutral' },
      { value: 4, emoji: '🙂', label: 'Good' },
      { value: 5, emoji: '😄', label: 'Great' },
    ],
  },
  {
    key: 'sleep_quality',
    label: 'Sleep',
    question: 'How did you sleep?',
    emoji: '🌙',
    options: [
      { value: 1, emoji: '😩', label: 'Terrible' },
      { value: 2, emoji: '😴', label: 'Poor' },
      { value: 3, emoji: '😐', label: 'OK' },
      { value: 4, emoji: '😊', label: 'Good' },
      { value: 5, emoji: '✨', label: 'Great' },
    ],
  },
  {
    key: 'recovery',
    label: 'Recovery',
    question: 'How recovered do you feel?',
    emoji: '💪',
    options: [
      { value: 1, emoji: '😣', label: 'None' },
      { value: 2, emoji: '😔', label: 'Low' },
      { value: 3, emoji: '😐', label: 'Moderate' },
      { value: 4, emoji: '💪', label: 'Good' },
      { value: 5, emoji: '🏆', label: 'Full' },
    ],
  },
  {
    key: 'digestion',
    label: 'Digestion',
    question: 'How is your digestion?',
    emoji: '🌿',
    options: [
      { value: 1, emoji: '😣', label: 'Rough' },
      { value: 2, emoji: '😕', label: 'Off' },
      { value: 3, emoji: '😐', label: 'OK' },
      { value: 4, emoji: '😊', label: 'Good' },
      { value: 5, emoji: '✨', label: 'Great' },
    ],
  },
]

export default function NoticePage() {
  const router = useRouter()
  const supabase = createClient()

  const [scores, setScores] = useState<Record<string, number>>({})
  const [sleepHours, setSleepHours] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [alreadyLogged, setAlreadyLogged] = useState(false)

  const today = localDate()
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('biofeedback_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle()

      if (data) {
        setScores({
          energy: data.energy,
          mood: data.mood,
          sleep_quality: data.sleep_quality,
          recovery: data.recovery,
          digestion: data.digestion,
        })
        setSleepHours(data.sleep_hours?.toString() ?? '')
        setNotes(data.notes ?? '')
        setAlreadyLogged(true)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('biofeedback_logs').upsert({
      user_id: user.id,
      date: today,
      energy: scores.energy ?? null,
      mood: scores.mood ?? null,
      sleep_quality: scores.sleep_quality ?? null,
      sleep_hours: sleepHours ? parseFloat(sleepHours) : null,
      recovery: scores.recovery ?? null,
      digestion: scores.digestion ?? null,
      notes: notes.trim() || null,
    }, { onConflict: 'user_id,date' })

    setSaving(false)
    setSaved(true)
    setAlreadyLogged(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const avgScore = Object.values(scores).filter(Boolean).length > 0
    ? Object.values(scores).filter(Boolean).reduce((a, b) => a + b, 0) / Object.values(scores).filter(Boolean).length
    : null

  function getOverallEmoji() {
    if (!avgScore) return '—'
    if (avgScore >= 4.5) return '🌟'
    if (avgScore >= 3.5) return '😊'
    if (avgScore >= 2.5) return '😐'
    if (avgScore >= 1.5) return '😔'
    return '😞'
  }

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
        <p className="text-xs font-medium text-gray-400 tracking-wide mb-1">{dateLabel}</p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notice</h1>
            <p className="text-sm text-gray-400 mt-0.5">How are you feeling today?</p>
          </div>
          {avgScore && (
            <div className="text-center">
              <div className="text-3xl">{getOverallEmoji()}</div>
              <p className="text-[10px] text-gray-400 mt-0.5">avg {avgScore.toFixed(1)}/5</p>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-5 space-y-3">
        {alreadyLogged && !saved && (
          <div className="bg-sage-50 border border-sage-200 rounded-2xl px-4 py-3 text-sm text-sage-700 font-medium">
            ✓ Today's check-in logged — you can update it below
          </div>
        )}

        {/* Biofeedback markers */}
        {MARKERS.map(marker => (
          <div key={marker.key} className="card p-4 fade-up">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{marker.emoji}</span>
              <div>
                <p className="text-sm font-bold text-gray-800">{marker.label}</p>
                <p className="text-xs text-gray-400">{marker.question}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {marker.options.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setScores(prev => ({ ...prev, [marker.key]: opt.value }))}
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:scale-95 ${
                    scores[marker.key] === opt.value
                      ? 'bg-sage-600 text-white shadow-sm'
                      : 'bg-cream-50 hover:bg-cream-100'
                  }`}
                >
                  <span className="text-xl leading-none">{opt.emoji}</span>
                  <span className={`text-[9px] font-medium ${scores[marker.key] === opt.value ? 'text-white' : 'text-gray-400'}`}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Sleep hours */}
        <div className="card p-4">
          <p className="text-sm font-bold text-gray-800 mb-1">🛏️ Hours of sleep</p>
          <input
            type="number" min={0} max={24} step={0.5}
            value={sleepHours}
            onChange={e => setSleepHours(e.target.value)}
            placeholder="e.g. 7.5"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 bg-cream-50"
          />
        </div>

        {/* Notes */}
        <div className="card p-4">
          <p className="text-sm font-bold text-gray-800 mb-1">📝 Notes</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything else you want to note today…"
            rows={3}
            className="w-full text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none bg-transparent"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving || Object.keys(scores).length === 0}
          className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 disabled:opacity-40 text-white font-semibold py-4 rounded-2xl text-sm transition-all shadow-lg shadow-sage-300/40 active:scale-[0.98]"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : alreadyLogged ? 'Update check-in' : 'Save check-in'}
        </button>
      </div>
    </div>
  )
}
