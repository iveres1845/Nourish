'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { checkBottomHugging } from '@/lib/engine/ea-calculator'
import { localDate } from '@/lib/utils/date'
import type { UserProfile } from '@/lib/types'

// ─── DRI reference table ──────────────────────────────────────────────────────

const DRI: Record<string, { label: string; unit: string; female: number; male: number; emoji: string }> = {
  iron_mg:         { label: 'Iron',        unit: 'mg',  female: 18,   male: 8,    emoji: '🩸' },
  calcium_mg:      { label: 'Calcium',     unit: 'mg',  female: 1000, male: 1000, emoji: '🦴' },
  vitamin_d_mcg:   { label: 'Vitamin D',   unit: 'mcg', female: 15,   male: 15,   emoji: '☀️' },
  magnesium_mg:    { label: 'Magnesium',   unit: 'mg',  female: 310,  male: 400,  emoji: '⚡' },
  zinc_mg:         { label: 'Zinc',        unit: 'mg',  female: 8,    male: 11,   emoji: '🛡️' },
  vitamin_c_mg:    { label: 'Vitamin C',   unit: 'mg',  female: 75,   male: 90,   emoji: '🍊' },
  vitamin_b12_mcg: { label: 'B12',         unit: 'mcg', female: 2.4,  male: 2.4,  emoji: '🧠' },
  folate_mcg:      { label: 'Folate',      unit: 'mcg', female: 400,  male: 400,  emoji: '🥦' },
  potassium_mg:    { label: 'Potassium',   unit: 'mg',  female: 2600, male: 3400, emoji: '🍌' },
  fiber_g:         { label: 'Fibre',       unit: 'g',   female: 25,   male: 38,   emoji: '🌾' },
  protein_g:       { label: 'Protein',     unit: 'g',   female: 46,   male: 56,   emoji: '💪' },
  omega3_ala_g:    { label: 'Omega-3',     unit: 'g',   female: 1.1,  male: 1.6,  emoji: '🐟' },
  vitamin_a_mcg:   { label: 'Vitamin A',   unit: 'mcg', female: 700,  male: 900,  emoji: '👁️' },
  selenium_mcg:    { label: 'Selenium',    unit: 'mcg', female: 55,   male: 55,   emoji: '🔬' },
  choline_mg:      { label: 'Choline',     unit: 'mg',  female: 425,  male: 550,  emoji: '🥚' },
}

// ─── Pairing rules ────────────────────────────────────────────────────────────

type PairingRule = {
  id: string
  trigger_nutrients: string[]     // if these are low
  trigger_foods?: string[]        // if these food names were eaten
  require_both?: boolean          // if true, BOTH nutrient AND food conditions must match
  headline: string
  copy: string
  suggest: string[]
  type: 'boost' | 'warning' | 'tip'
}

const PAIRING_RULES: PairingRule[] = [
  {
    id: 'iron_vitc',
    trigger_nutrients: ['iron_mg'],
    headline: 'Pair iron with vitamin C',
    copy: 'Vitamin C can increase non-haem iron absorption by up to 3×. Add a squeeze of lemon or some berries to your next iron-rich meal.',
    suggest: ['bell peppers', 'strawberries', 'lemon juice', 'broccoli'],
    type: 'boost',
  },
  {
    id: 'calcium_vitd',
    trigger_nutrients: ['calcium_mg'],
    headline: 'Calcium needs vitamin D to absorb',
    copy: 'Without enough vitamin D, your body can\'t effectively absorb calcium. Try getting 10–15 min of sun exposure or add fortified foods.',
    suggest: ['salmon', 'egg yolks', 'fortified milk', 'mushrooms'],
    type: 'boost',
  },
  {
    id: 'vitd_fat',
    trigger_nutrients: ['vitamin_d_mcg'],
    headline: 'Vitamin D absorbs better with fat',
    copy: 'Vitamin D is fat-soluble — take supplements with a meal that contains healthy fat, or pair vitamin D foods with avocado or olive oil.',
    suggest: ['avocado', 'olive oil', 'nuts', 'eggs'],
    type: 'tip',
  },
  {
    id: 'iron_tea_warning',
    trigger_foods: ['tea', 'coffee'],
    trigger_nutrients: ['iron_mg'],
    require_both: true,   // only warn when BOTH iron is low AND tea/coffee was logged
    headline: 'Tea & coffee inhibit iron absorption',
    copy: 'Tannins in tea and coffee can reduce iron absorption by up to 60%. Try to wait 1–2 hours after an iron-rich meal before having a cuppa.',
    suggest: [],
    type: 'warning',
  },
  {
    id: 'b12_plant',
    trigger_nutrients: ['vitamin_b12_mcg'],
    headline: 'B12 is tricky to get from plants',
    copy: 'B12 is almost exclusively found in animal products. If you\'re eating mostly plant-based, a B12 supplement or fortified foods are worth considering.',
    suggest: ['nutritional yeast', 'fortified oat milk', 'eggs', 'fish'],
    type: 'tip',
  },
  {
    id: 'omega3_boost',
    trigger_nutrients: ['omega3_ala_g'],
    headline: 'Boost your omega-3s today',
    copy: 'You\'re short on omega-3 fatty acids, which support brain health, inflammation control, and hormonal balance.',
    suggest: ['walnuts', 'flaxseeds', 'chia seeds', 'salmon', 'sardines'],
    type: 'boost',
  },
  {
    id: 'magnesium_dark_leafy',
    trigger_nutrients: ['magnesium_mg'],
    headline: 'Magnesium gap — go green',
    copy: 'Magnesium supports 300+ enzyme functions including energy production and sleep quality. Dark leafy greens are your best bet.',
    suggest: ['spinach', 'pumpkin seeds', 'black beans', 'dark chocolate'],
    type: 'boost',
  },
  {
    id: 'fiber_gut',
    trigger_nutrients: ['fiber_g'],
    headline: 'Your gut wants more fibre today',
    copy: 'Fibre feeds your microbiome, slows sugar absorption, and keeps you full. Aim for variety — different plants feed different bacteria.',
    suggest: ['lentils', 'oats', 'berries', 'chickpeas', 'broccoli'],
    type: 'boost',
  },
]

// ─── Insight generation ───────────────────────────────────────────────────────

type GeneratedInsight = {
  id: string
  type: 'gap' | 'boost' | 'warning' | 'tip' | 'energy' | 'win'
  headline: string
  copy: string
  suggest?: string[]
  pct?: number        // % of DRI met
  emoji?: string
  priority: number    // lower = more important
}

function generateInsights(
  nutrients: Record<string, number>,
  energyTarget: number,
  energyLow: number,
  foodNames: string[],
  sex: 'female' | 'male'
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  // 1. Energy status
  const kcal = nutrients.energy_kcal ?? 0
  if (energyTarget > 0) {
    const pct = (kcal / energyLow) * 100
    if (pct < 60) {
      insights.push({
        id: 'energy_low',
        type: 'energy',
        headline: 'You\'re significantly underfuelled',
        copy: `You've logged ${Math.round(kcal)} kcal so far — that's ${Math.round(100 - pct)}% below your minimum target of ${Math.round(energyLow)} kcal. Chronic underfuelling affects hormones, metabolism, and recovery.`,
        emoji: '⚡',
        priority: 1,
      })
    } else if (pct < 85) {
      insights.push({
        id: 'energy_moderate',
        type: 'energy',
        headline: 'Room for more fuel today',
        copy: `You're at ${Math.round(kcal)} kcal with a minimum target of ${Math.round(energyLow)} kcal. Add a nutrient-dense snack or bigger portion at dinner.`,
        emoji: '⚡',
        priority: 2,
      })
    } else if (pct >= 85 && pct <= 115) {
      insights.push({
        id: 'energy_good',
        type: 'win',
        headline: 'Energy intake on track',
        copy: `You're at ${Math.round(kcal)} kcal — right in your target zone. Keep it up.`,
        emoji: '✅',
        priority: 10,
      })
    }
  }

  // 2. Nutrient gaps → apply pairing rules
  const lowNutrients: string[] = []
  for (const [key, ref] of Object.entries(DRI)) {
    const target = sex === 'female' ? ref.female : ref.male
    const actual = nutrients[key] ?? 0
    const pct = actual / target
    if (pct < 0.7) lowNutrients.push(key)
  }

  for (const rule of PAIRING_RULES) {
    const nutrientMatch = rule.trigger_nutrients?.some(n => lowNutrients.includes(n)) ?? false
    const foodMatch = rule.trigger_foods
      ? rule.trigger_foods.some(f => foodNames.some(fn => fn.toLowerCase().includes(f)))
      : false

    const triggered = rule.require_both
      ? (nutrientMatch && foodMatch)
      : (nutrientMatch || foodMatch)

    if (triggered) {
      insights.push({
        id: rule.id,
        type: rule.type,
        headline: rule.headline,
        copy: rule.copy,
        suggest: rule.suggest.length > 0 ? rule.suggest : undefined,
        priority: rule.type === 'warning' ? 2 : rule.type === 'boost' ? 4 : 6,
      })
    }
  }

  // 3. Nutrient gap cards (show top 4 lowest)
  const gapCards: { key: string; pct: number; ref: typeof DRI[string] }[] = []
  for (const [key, ref] of Object.entries(DRI)) {
    const target = sex === 'female' ? ref.female : ref.male
    const actual = nutrients[key] ?? 0
    const pct = (actual / target) * 100
    if (pct < 90) {
      gapCards.push({ key, pct, ref })
    }
  }
  gapCards.sort((a, b) => a.pct - b.pct)
  for (const gap of gapCards.slice(0, 5)) {
    insights.push({
      id: `gap_${gap.key}`,
      type: 'gap',
      headline: `${gap.ref.emoji} ${gap.ref.label}`,
      copy: `${Math.round(gap.pct)}% of daily target`,
      pct: gap.pct,
      emoji: gap.ref.emoji,
      priority: gap.pct < 30 ? 3 : gap.pct < 60 ? 5 : 7,
    })
  }

  return insights.sort((a, b) => a.priority - b.priority)
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function NutrientBar({ label, pct, emoji }: { label: string; pct: number; emoji: string }) {
  const clamped = Math.min(pct, 100)
  const color = pct >= 90 ? 'bg-sage-500' : pct >= 50 ? 'bg-amber-400' : 'bg-terracotta-400'

  return (
    <div className="flex items-center gap-3">
      <span className="text-base w-6 text-center">{emoji}</span>
      <div className="flex-1">
        <div className="flex justify-between mb-1">
          <span className="text-xs font-medium text-gray-700">{label}</span>
          <span className="text-xs text-gray-500">{Math.round(pct)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${color}`}
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function InsightCard({ insight }: { insight: GeneratedInsight }) {
  const typeConfig = {
    boost:   { bg: 'bg-sage-50',       border: 'border-sage-200',       badge: 'bg-sage-100 text-sage-800',       icon: '↑' },
    warning: { bg: 'bg-amber-50',      border: 'border-amber-200',      badge: 'bg-amber-100 text-amber-800',     icon: '⚠' },
    tip:     { bg: 'bg-blue-50',       border: 'border-blue-200',       badge: 'bg-blue-100 text-blue-800',       icon: '💡' },
    energy:  { bg: 'bg-terracotta-50', border: 'border-terracotta-200', badge: 'bg-terracotta-100 text-terracotta-800', icon: '⚡' },
    win:     { bg: 'bg-sage-50',       border: 'border-sage-200',       badge: 'bg-sage-100 text-sage-800',       icon: '✓' },
    gap:     { bg: 'bg-gray-50',       border: 'border-gray-200',       badge: 'bg-gray-100 text-gray-700',       icon: '○' },
  }
  const cfg = typeConfig[insight.type] ?? typeConfig.tip

  if (insight.type === 'gap') {
    return (
      <div className={`rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-gray-800">{insight.headline}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            (insight.pct ?? 0) < 30 ? 'bg-terracotta-100 text-terracotta-800' :
            (insight.pct ?? 0) < 60 ? 'bg-amber-100 text-amber-800' :
            'bg-gray-100 text-gray-700'
          }`}>
            {Math.round(insight.pct ?? 0)}%
          </span>
        </div>
        <div className="h-2 bg-white rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              (insight.pct ?? 0) < 30 ? 'bg-terracotta-400' :
              (insight.pct ?? 0) < 60 ? 'bg-amber-400' : 'bg-sage-400'
            }`}
            style={{ width: `${Math.min(insight.pct ?? 0, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">{insight.copy}</p>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        <span className={`text-xs font-bold px-2 py-1 rounded-lg mt-0.5 ${cfg.badge}`}>
          {cfg.icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm leading-snug">{insight.headline}</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{insight.copy}</p>
          {insight.suggest && insight.suggest.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {insight.suggest.map(s => (
                <span key={s} className="text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Correlation patterns ────────────────────────────────────────────────────

type CorrelationPattern = {
  id: string
  emoji: string
  headline: string
  detail: string
  direction: 'positive' | 'negative' | 'neutral'
}

/**
 * Cross-reference 14-day biofeedback scores with daily nutrition data.
 * Only surface patterns where ≥ 3 matched days exist and the score
 * difference between the top/bottom half is ≥ 0.6 on a 1-5 scale.
 */
function computeCorrelationPatterns(
  nutritionDays: Array<{ date: string; nutrient_totals: Record<string, number> }>,
  bioDays: Array<{ date: string; energy?: number; mood?: number; sleep_quality?: number; recovery?: number; digestion?: number }>,
  energyMin: number,
): CorrelationPattern[] {
  // Join by date
  const joined = nutritionDays
    .map(n => ({ ...n, bio: bioDays.find(b => b.date === n.date) }))
    .filter(d => d.bio)

  if (joined.length < 3) return []

  const patterns: CorrelationPattern[] = []

  function splitCorrelation(
    getValue: (d: typeof joined[0]) => number,
    getScore: (d: typeof joined[0]) => number | undefined,
    id: string,
    emoji: string,
    highLabel: string,
    lowLabel: string,
    highHeadline: string,
    lowHeadline: string,
    highDetail: string,
    lowDetail: string,
  ) {
    const valid = joined.filter(d => getValue(d) > 0 && getScore(d) != null && getScore(d)! > 0)
    if (valid.length < 3) return

    const sorted = [...valid].sort((a, b) => getValue(a) - getValue(b))
    const mid = Math.floor(sorted.length / 2)
    const bottom = sorted.slice(0, mid)
    const top = sorted.slice(mid)

    const avgBottom = bottom.reduce((s, d) => s + getScore(d)!, 0) / bottom.length
    const avgTop    = top.reduce((s, d) => s + getScore(d)!, 0)    / top.length
    const diff = avgTop - avgBottom

    if (Math.abs(diff) < 0.6) return

    if (diff > 0) {
      patterns.push({ id, emoji, headline: highHeadline, detail: highDetail, direction: 'positive' })
    } else {
      patterns.push({ id, emoji, headline: lowHeadline, detail: lowDetail, direction: 'negative' })
    }
  }

  // Energy intake vs energy score
  splitCorrelation(
    d => d.nutrient_totals.energy_kcal ?? 0,
    d => d.bio?.energy,
    'energy_vs_fuel',
    '⚡',
    'High fuel', 'Low fuel',
    'You feel more energised on well-fuelled days',
    'Low energy often follows low-intake days',
    `On days you ate closer to your target your energy score averaged higher. Consistent fuelling is making a difference.`,
    `Your energy scores dip on days with lower food intake. Your body is telling you it needs more fuel.`,
  )

  // Protein vs recovery
  splitCorrelation(
    d => d.nutrient_totals.protein_g ?? 0,
    d => d.bio?.recovery,
    'protein_vs_recovery',
    '💪',
    'High protein', 'Low protein',
    'Higher protein days link to better recovery',
    'Recovery dips on low-protein days',
    `Your recovery scores are higher on days with more protein. Aim for protein at every meal to support muscle repair.`,
    `Recovery scores are lower on days with less protein. Try adding a protein source to each meal.`,
  )

  // Fibre vs digestion
  splitCorrelation(
    d => d.nutrient_totals.fiber_g ?? 0,
    d => d.bio?.digestion,
    'fiber_vs_digestion',
    '🌿',
    'High fibre', 'Low fibre',
    'More fibre = better digestion for you',
    'Digestion scores dip on low-fibre days',
    `Your digestion is noticeably better on higher-fibre days. Vegetables, legumes, and wholegrains seem to be working for your gut.`,
    `Digestion scores are lower on low-fibre days. Even small additions — a handful of veg or some seeds — can help.`,
  )

  // Energy intake vs mood
  splitCorrelation(
    d => d.nutrient_totals.energy_kcal ?? 0,
    d => d.bio?.mood,
    'energy_vs_mood',
    '🧠',
    'High intake', 'Low intake',
    'Your mood lifts on better-fuelled days',
    'Mood tends to dip when intake is low',
    `There's a pattern between your food intake and mood. On days you ate more, your mood scores were higher — underfuelling affects more than just physical energy.`,
    `Mood scores are lower on days with less food. Underfuelling can affect neurotransmitter production and emotional regulation.`,
  )

  // Energy intake vs sleep
  splitCorrelation(
    d => d.nutrient_totals.energy_kcal ?? 0,
    d => d.bio?.sleep_quality,
    'energy_vs_sleep',
    '🌙',
    'High intake', 'Low intake',
    'Sleep quality is better on well-fuelled days',
    'Sleep dips on lower-intake days',
    `Your sleep quality scores are higher on better-fuelled days. Adequate carbohydrate and overall calorie intake supports serotonin and melatonin production.`,
    `Sleep quality is lower on days with lower food intake. Going to bed under-fuelled can disrupt sleep architecture.`,
  )

  return patterns.slice(0, 4) // max 4 patterns to avoid overwhelming
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [nutrients, setNutrients] = useState<Record<string, number>>({})
  const [avg7Nutrients, setAvg7Nutrients] = useState<Record<string, number>>({})
  const [avg7DaysLogged, setAvg7DaysLogged] = useState(0)
  const [foodNames, setFoodNames] = useState<string[]>([])
  const [energyTarget, setEnergyTarget] = useState(0)
  const [energyLow, setEnergyLow] = useState(0)
  const [insights, setInsights] = useState<GeneratedInsight[]>([])
  const [insights7, setInsights7] = useState<GeneratedInsight[]>([])
  const [noData, setNoData] = useState(false)
  const [view, setView] = useState<'today' | '7day'>('today')
  const [patterns, setPatterns] = useState<CorrelationPattern[]>([])
  const [bottomHugMessage, setBottomHugMessage] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Load profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!prof) { router.push('/onboarding'); return }
      setProfile(prof)

      const target = prof.daily_energy_target ?? 0
      const low = prof.energy_range_low ?? target
      setEnergyTarget(target)
      setEnergyLow(low)

      // Load today's daily log
      const today = localDate()
      const { data: log } = await supabase
        .from('daily_logs')
        .select('nutrient_totals')
        .eq('user_id', user.id)
        .eq('date', today)
        .single()

      // Load today's food item names
      const { data: meals } = await supabase
        .from('meals')
        .select('id, logged_at')
        .eq('user_id', user.id)
        .gte('logged_at', `${today}T00:00:00`)
        .lte('logged_at', `${today}T23:59:59`)

      let names: string[] = []
      if (meals && meals.length > 0) {
        const mealIds = meals.map(m => m.id)
        const { data: items } = await supabase
          .from('food_items')
          .select('name')
          .in('meal_id', mealIds)
        names = (items ?? []).map(i => i.name)
        setFoodNames(names)
      }

      const nut = (log?.nutrient_totals as Record<string, number>) ?? {}
      setNutrients(nut)

      // Fetch last 14 days for both nutrition and biofeedback (more data = better patterns)
      const fourteenDaysAgoStr = localDate(-13)
      const sevenDaysAgoStr    = localDate(-6)

      const [weekLogsRes, bioLogsRes] = await Promise.all([
        supabase.from('daily_logs').select('nutrient_totals, date')
          .eq('user_id', user.id).gte('date', fourteenDaysAgoStr).lte('date', today),
        supabase.from('biofeedback_logs').select('date, energy, mood, sleep_quality, recovery, digestion')
          .eq('user_id', user.id).gte('date', fourteenDaysAgoStr).lte('date', today),
      ])

      const allNutritionDays = weekLogsRes.data ?? []
      const allBioDays       = bioLogsRes.data ?? []

      // 7-day average (last 7 only)
      const weekLogs = allNutritionDays.filter(d => d.date >= sevenDaysAgoStr)
      if (weekLogs.length > 0) {
        const daysLogged = weekLogs.length
        const avgNut: Record<string, number> = {}
        for (const day of weekLogs) {
          const dayNut = (day.nutrient_totals as Record<string, number>) ?? {}
          for (const [k, v] of Object.entries(dayNut)) {
            avgNut[k] = (avgNut[k] ?? 0) + v
          }
        }
        for (const k of Object.keys(avgNut)) {
          avgNut[k] = avgNut[k] / daysLogged
        }
        setAvg7Nutrients(avgNut)
        setAvg7DaysLogged(daysLogged)
        const sex = prof.sex ?? 'female'
        setInsights7(generateInsights(avgNut, target, low, names, sex))
      }

      // Correlation patterns from 14 days of matched data
      if (allNutritionDays.length >= 3 && allBioDays.length >= 3) {
        const computed = computeCorrelationPatterns(
          allNutritionDays.map(d => ({ date: d.date, nutrient_totals: (d.nutrient_totals as Record<string, number>) ?? {} })),
          allBioDays,
          low,
        )
        setPatterns(computed)
      }

      // Bottom-hugging check: last 7 days of energy intakes, most recent first
      const energyHigh = prof.energy_range_high ?? (low * 1.25)
      const recentIntakes = allNutritionDays
        .slice().sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 7)
        .map(d => ((d.nutrient_totals as Record<string, number>)?.energy_kcal ?? 0))
      const { triggered, message } = checkBottomHugging({
        recentIntakes,
        range_low: low,
        range_high: energyHigh,
        goals: prof.goals ?? [],
      })
      if (triggered) setBottomHugMessage(message)

      if (!log && names.length === 0) {
        setNoData(true)
      } else {
        const sex = prof.sex ?? 'female'
        const generated = generateInsights(nut, target, low, names, sex)
        setInsights(generated)
      }

      setLoading(false)
    }
    load()
  }, [])

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const sex = profile?.sex ?? 'female'
  const activeNutrients = view === 'today' ? nutrients : avg7Nutrients
  const activeInsights = view === 'today' ? insights : insights7
  const activeEnergy = activeNutrients.energy_kcal ?? 0

  // Top 8 nutrients sorted by lowest % first
  const nutrientBars = Object.entries(DRI)
    .map(([key, ref]) => {
      const target = sex === 'female' ? ref.female : ref.male
      const actual = activeNutrients[key] ?? 0
      return { key, ref, pct: (actual / target) * 100 }
    })
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 8)

  const actionInsights = activeInsights.filter(i => i.type !== 'gap' && i.type !== 'win')
  const wins = activeInsights.filter(i => i.type === 'win')
  const gaps = activeInsights.filter(i => i.type === 'gap')

  return (
    <div className="min-h-screen bg-cream-50">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-gray-50 px-5 pt-12 pb-4">
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-[11px] font-medium text-gray-400 tracking-wide mb-0.5">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-2xl font-bold text-gray-900">Nudge</h1>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => setView('today')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              view === 'today' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
            }`}>
            Today
          </button>
          <button onClick={() => setView('7day')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
              view === '7day' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
            }`}>
            7-day avg
            {avg7DaysLogged > 0 && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${view === '7day' ? 'bg-sage-100 text-sage-700' : 'bg-gray-200 text-gray-400'}`}>
                {avg7DaysLogged}d
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-5 pb-28">

        {/* No data state */}
        {noData ? (
          <div className="card p-8 text-center fade-up">
            <div className="w-16 h-16 bg-cream-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3">📸</div>
            <p className="font-semibold text-gray-800 mb-1">No meals logged yet</p>
            <p className="text-sm text-gray-400 leading-relaxed">Snap a photo of what you eat and Nourish will analyse your nutrients.</p>
          </div>
        ) : (
          <>
            {/* Nutrient overview */}
            <div className="card p-5 mb-4 fade-up">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-800">
                  {view === 'today' ? "Today's nutrients" : '7-day average'}
                </h2>
                <span className="text-[11px] font-medium text-gray-400">% of daily target</span>
              </div>
              <div className="space-y-3">
                {nutrientBars.map(({ key, ref, pct }) => (
                  <NutrientBar key={key} label={ref.label} pct={pct} emoji={ref.emoji} />
                ))}
              </div>
            </div>

            {/* Action insights */}
            {actionInsights.length > 0 && (
              <div className="mb-4 fade-up" style={{ animationDelay: '0.05s' }}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">Recommendations</p>
                <div className="space-y-2.5">
                  {actionInsights.map(insight => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              </div>
            )}

            {/* Nutrient gaps */}
            {gaps.length > 0 && (
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-2 px-1">Nutrient gaps</h2>
                <div className="space-y-2">
                  {gaps.map(insight => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              </div>
            )}

            {/* Wins */}
            {wins.map(insight => (
              <InsightCard key={insight.id} insight={insight} />
            ))}

            {/* Bottom-hugging nudge — priority alert when consistently at minimum */}
            {bottomHugMessage && (
              <div className="mt-4 mb-2 fade-up">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-lg">🔆</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <p className="text-sm font-bold text-gray-800">Fuelling right at your minimum</p>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">THIS WEEK</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{bottomHugMessage}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Correlation Patterns — only show when we have enough data */}
            {patterns.length > 0 && (
              <div className="mt-4 mb-4 fade-up">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Your patterns</p>
                  <span className="text-[10px] bg-sage-50 text-sage-600 font-semibold px-2 py-0.5 rounded-full">
                    based on {avg7DaysLogged}+ days
                  </span>
                </div>
                <div className="space-y-2.5">
                  {patterns.map(p => (
                    <div key={p.id} className="card p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg ${
                          p.direction === 'positive' ? 'bg-sage-50' :
                          p.direction === 'negative' ? 'bg-terracotta-50' : 'bg-cream-100'
                        }`}>
                          {p.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <p className="text-sm font-bold text-gray-800">{p.headline}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              p.direction === 'positive' ? 'bg-sage-100 text-sage-700' : 'bg-terracotta-100 text-terracotta-700'
                            }`}>
                              {p.direction === 'positive' ? 'PATTERN' : 'WATCH'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 leading-relaxed">{p.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Macros + energy */}
            <div className="card p-5 mt-4 fade-up" style={{ animationDelay: '0.15s' }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800">
                  Macros {view === '7day' && <span className="text-xs font-normal text-gray-400">— daily avg</span>}
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-2.5 mb-3">
                {[
                  { label: 'Protein', key: 'protein_g',      unit: 'g', bg: 'bg-purple-50', text: 'text-purple-700' },
                  { label: 'Carbs',   key: 'carbohydrate_g', unit: 'g', bg: 'bg-amber-50',  text: 'text-amber-700' },
                  { label: 'Fat',     key: 'fat_g',          unit: 'g', bg: 'bg-sage-50',   text: 'text-sage-700' },
                ].map(m => (
                  <div key={m.key} className={`text-center ${m.bg} rounded-xl p-3`}>
                    <p className={`text-xl font-bold ${m.text} leading-none`}>
                      {Math.round(activeNutrients[m.key] ?? 0)}
                      <span className="text-xs font-normal text-gray-400 ml-0.5">{m.unit}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{m.label}</p>
                  </div>
                ))}
              </div>
              {activeNutrients.fiber_g !== undefined && (
                <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5 mb-4">
                  <span className="font-medium text-gray-600">🌾 Fibre</span>
                  <span className="font-semibold text-gray-700">{Math.round(activeNutrients.fiber_g ?? 0)}g <span className="text-gray-400 font-normal">/ {sex === 'female' ? 25 : 38}g</span></span>
                </div>
              )}
              <div className="border-t border-gray-50 pt-3.5">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <p className="text-[11px] text-gray-400 font-medium">
                      {view === 'today' ? 'Energy today' : '7-day avg energy'}
                    </p>
                    <p className="text-xl font-bold text-gray-900 leading-tight">
                      {Math.round(activeEnergy)}
                      <span className="text-xs font-normal text-gray-400 ml-1">kcal</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-gray-400">Target</p>
                    <p className="text-xs font-semibold text-gray-600">{Math.round(energyLow)}–{Math.round(energyTarget)} kcal</p>
                  </div>
                </div>
                {energyTarget > 0 && (
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-sage-500 transition-all duration-700"
                      style={{ width: `${Math.min(activeEnergy / energyTarget * 100, 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

