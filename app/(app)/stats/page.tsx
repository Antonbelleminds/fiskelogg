'use client'

import { useState, useEffect, useMemo } from 'react'
import ChatWidget from '@/components/stats/ChatWidget'
import { getCache, setCache } from '@/lib/cache'

interface CatchProfile {
  username: string | null
  display_name: string | null
  avatar_url: string | null
}

interface Catch {
  id: string
  user_id?: string
  caught_at: string
  species: string | null
  weight_kg: number | null
  length_cm: number | null
  water_body: string | null
  weather_condition: string | null
  moon_phase: string | null
  fishing_method: string | null
  lure_type: string | null
  lure_color: string | null
  location_name: string | null
  image_url: string | null
  pressure_hpa: number | null
  catcher_name: string | null
  profiles?: CatchProfile
}

interface DrillDownState {
  [key: string]: boolean
}

interface PersonStats {
  name: string
  catches: Catch[]
  totalCatches: number
  uniqueSpecies: number
  maxWeight: number
  maxWeightSpecies: string
  topSpecies: string
  topWater: string
  avgWeight: number
}

function pressureBucket(hpa: number | null): string {
  if (hpa === null) return ''
  if (hpa < 990) return 'Lågt (< 990 hPa)'
  if (hpa <= 1015) return 'Normalt (990–1015 hPa)'
  return 'Högt (> 1015 hPa)'
}

// === Badges ===
interface Badge {
  id: string
  label: string
  description: string
  icon: string
  earned: boolean
}

function computeBadges(catches: Catch[]): Badge[] {
  const uniqueSpecies = new Set(catches.map(c => c.species).filter(Boolean)).size
  const months = new Set(catches.map(c => new Date(c.caught_at).toISOString().slice(0, 7))).size
  const hasHeavy = catches.some(c => c.weight_kg && c.weight_kg >= 3)
  const hasEarly = catches.some(c => new Date(c.caught_at).getHours() < 6)
  const hasNight = catches.some(c => new Date(c.caught_at).getHours() >= 22)
  const hasLong = catches.some(c => c.length_cm && c.length_cm >= 60)

  return [
    { id: 'first', label: 'Första fångsten', description: 'Logga din första fångst', icon: 'hook', earned: catches.length >= 1 },
    { id: 'five', label: 'Femklubben', description: 'Logga 5 fångster', icon: 'star', earned: catches.length >= 5 },
    { id: 'ten', label: 'Tiokamp', description: 'Logga 10 fångster', icon: 'fire', earned: catches.length >= 10 },
    { id: 'species3', label: 'Artjägaren', description: 'Fånga 3 olika arter', icon: 'fish', earned: uniqueSpecies >= 3 },
    { id: 'heavy', label: 'Tungviktaren', description: 'Fånga en fisk på 3+ kg', icon: 'weight', earned: hasHeavy },
    { id: 'long', label: 'Långansen', description: 'Fånga en fisk på 60+ cm', icon: 'ruler', earned: hasLong },
    { id: 'early', label: 'Morgonfiskaren', description: 'Fånga före kl 06:00', icon: 'sunrise', earned: hasEarly },
    { id: 'night', label: 'Nattuglan', description: 'Fånga efter kl 22:00', icon: 'moon', earned: hasNight },
    { id: 'months', label: 'Hängiven', description: 'Fiska under 3 olika månader', icon: 'calendar', earned: months >= 3 },
  ]
}

function computePersonStats(name: string, catches: Catch[]): PersonStats {
  const speciesSet = new Set(catches.map(c => c.species).filter(Boolean))
  const weights = catches.filter(c => c.weight_kg).map(c => c.weight_kg!)
  const heaviest = catches.reduce<Catch | null>((best, c) =>
    c.weight_kg && c.weight_kg > (best?.weight_kg || 0) ? c : best, null)

  const speciesCounts: Record<string, number> = {}
  catches.forEach(c => { if (c.species) speciesCounts[c.species] = (speciesCounts[c.species] || 0) + 1 })
  const topSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1])[0]

  const waterCounts: Record<string, number> = {}
  catches.forEach(c => { if (c.water_body) waterCounts[c.water_body] = (waterCounts[c.water_body] || 0) + 1 })
  const topWater = Object.entries(waterCounts).sort((a, b) => b[1] - a[1])[0]

  return {
    name,
    catches,
    totalCatches: catches.length,
    uniqueSpecies: speciesSet.size,
    maxWeight: heaviest?.weight_kg || 0,
    maxWeightSpecies: heaviest?.species || '-',
    topSpecies: topSpecies ? topSpecies[0] : '-',
    topWater: topWater ? topWater[0] : '-',
    avgWeight: weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 0,
  }
}

export default function StatsPage() {
  const [myCatches, setMyCatches] = useState<Catch[]>([])
  const [friendCatches, setFriendCatches] = useState<Catch[]>([])
  const [loading, setLoading] = useState(true)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsLoaded, setFriendsLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'mine' | 'friends'>('mine')
  const [drillDown, setDrillDown] = useState<DrillDownState>({})
  const [filterSpecies, setFilterSpecies] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterCatcher, setFilterCatcher] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null)

  // Fetch own catches
  useEffect(() => {
    async function fetchCatches() {
      const cached = getCache<Catch[]>('stats-catches')
      if (cached) {
        setMyCatches(cached)
        setLoading(false)
        return
      }
      try {
        const res = await fetch('/api/catches?limit=500')
        if (res.ok) {
          const data = await res.json()
          setMyCatches(data)
          setCache('stats-catches', data)
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    fetchCatches()
  }, [])

  // Lazy-load friend catches when switching to friends tab
  useEffect(() => {
    if (activeTab !== 'friends' || friendsLoaded) return
    async function fetchFriends() {
      setFriendsLoading(true)
      const cached = getCache<Catch[]>('stats-friend-catches')
      if (cached) {
        setFriendCatches(cached)
        setFriendsLoaded(true)
        setFriendsLoading(false)
        return
      }
      try {
        const res = await fetch('/api/catches?scope=friends&limit=500')
        if (res.ok) {
          const data = await res.json()
          setFriendCatches(data)
          setCache('stats-friend-catches', data)
          setFriendsLoaded(true)
        }
      } catch {
        // silently fail
      } finally {
        setFriendsLoading(false)
      }
    }
    fetchFriends()
  }, [activeTab, friendsLoaded])

  function toggleDrillDown(section: string) {
    setDrillDown((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Active catches based on tab
  const catches = activeTab === 'mine' ? myCatches : friendCatches

  // Filtered catches
  const filteredCatches = useMemo(() => {
    return catches.filter((c) => {
      if (filterSpecies && c.species !== filterSpecies) return false
      if (filterMethod && c.fishing_method !== filterMethod) return false
      if (filterCatcher && c.catcher_name !== filterCatcher) return false
      if (filterYear && new Date(c.caught_at).getFullYear().toString() !== filterYear) return false
      return true
    })
  }, [catches, filterSpecies, filterMethod, filterCatcher, filterYear])

  const hasActiveFilter = !!(filterSpecies || filterMethod || filterCatcher || filterYear)

  // Stats based on filteredCatches
  const totalCatches = filteredCatches.length

  const uniqueSpecies = useMemo(() => {
    return new Set(filteredCatches.map((c) => c.species).filter(Boolean)).size
  }, [filteredCatches])

  const pbWeight = useMemo(() => {
    return filteredCatches.reduce<Catch | null>((best, c) => {
      if (!c.weight_kg) return best
      if (!best || c.weight_kg > (best.weight_kg || 0)) return c
      return best
    }, null)
  }, [filteredCatches])

  const favoriteWater = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCatches.forEach((c) => {
      if (c.water_body) counts[c.water_body] = (counts[c.water_body] || 0) + 1
    })
    let best = ''; let max = 0
    Object.entries(counts).forEach(([k, v]) => { if (v > max) { best = k; max = v } })
    return best
  }, [filteredCatches])

  const speciesBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCatches.forEach((c) => {
      const sp = c.species || 'Okänd'
      counts[sp] = (counts[sp] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [filteredCatches])

  // Unique values for filter dropdowns (from ALL catches in active tab, not filtered)
  const allSpecies = useMemo(() =>
    Array.from(new Set(catches.filter(c => c.species).map(c => c.species!))).sort(),
  [catches])

  const allMethods = useMemo(() =>
    Array.from(new Set(catches.filter(c => c.fishing_method).map(c => c.fishing_method!))).sort(),
  [catches])

  const allCatchers = useMemo(() =>
    Array.from(new Set(catches.filter(c => c.catcher_name && c.catcher_name.trim()).map(c => c.catcher_name!))).sort(),
  [catches])

  const allYears = useMemo(() =>
    Array.from(new Set(catches.map(c => new Date(c.caught_at).getFullYear().toString()))).sort((a, b) => b.localeCompare(a)),
  [catches])

  const topLocations = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCatches.forEach((c) => {
      if (c.water_body) counts[c.water_body] = (counts[c.water_body] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [filteredCatches])

  const catchesByHour = useMemo(() => {
    const hours = Array(24).fill(0)
    filteredCatches.forEach((c) => {
      if (c.caught_at) hours[new Date(c.caught_at).getHours()]++
    })
    return hours
  }, [filteredCatches])

  const weatherBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCatches.forEach((c) => {
      if (c.weather_condition) counts[c.weather_condition] = (counts[c.weather_condition] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [filteredCatches])

  const moonBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCatches.forEach((c) => {
      if (c.moon_phase) counts[c.moon_phase] = (counts[c.moon_phase] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [filteredCatches])

  const pressureBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCatches.forEach((c) => {
      const bucket = pressureBucket(c.pressure_hpa)
      if (bucket) counts[bucket] = (counts[bucket] || 0) + 1
    })
    const order = ['Lågt (< 990 hPa)', 'Normalt (990–1015 hPa)', 'Högt (> 1015 hPa)']
    return order.filter((k) => counts[k]).map((k) => [k, counts[k]] as [string, number])
  }, [filteredCatches])

  // === Records per species (heaviest + longest per art) ===
  const recordsBySpecies = useMemo(() => {
    const bySpecies = new Map<string, { heaviest: Catch | null; longest: Catch | null }>()
    filteredCatches.forEach(c => {
      if (!c.species) return
      if (!bySpecies.has(c.species)) bySpecies.set(c.species, { heaviest: null, longest: null })
      const rec = bySpecies.get(c.species)!
      if (c.weight_kg && (!rec.heaviest || c.weight_kg > (rec.heaviest.weight_kg || 0))) rec.heaviest = c
      if (c.length_cm && (!rec.longest || c.length_cm > (rec.longest.length_cm || 0))) rec.longest = c
    })
    return Array.from(bySpecies.entries())
      .filter(([, r]) => r.heaviest || r.longest)
      .sort((a, b) => (b[1].heaviest?.weight_kg || 0) - (a[1].heaviest?.weight_kg || 0))
  }, [filteredCatches])

  // === Leaderboard: group by catcher_name across ALL catches (mine + friends) ===
  const allPeople = useMemo(() => {
    const combined = [...myCatches, ...friendCatches]
    const byName = new Map<string, Catch[]>()

    combined.forEach(c => {
      const name = c.catcher_name?.trim()
      if (!name) return
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name)!.push(c)
    })

    return Array.from(byName.entries()).map(([name, catches]) =>
      computePersonStats(name, catches)
    )
  }, [myCatches, friendCatches])

  // Compare persons
  const personA = useMemo(() => allPeople.find(p => p.name === compareA), [allPeople, compareA])
  const personB = useMemo(() => allPeople.find(p => p.name === compareB), [allPeople, compareB])

  // Badges (based on own catches)
  const badges = useMemo(() => computeBadges(myCatches), [myCatches])

  function getCatchesForField(field: keyof Catch, value: string): Catch[] {
    return filteredCatches.filter((c) => {
      const v = c[field]
      return v === value || (!v && value === 'Okänd')
    })
  }

  function getCatchesForPressure(bucket: string): Catch[] {
    return filteredCatches.filter((c) => pressureBucket(c.pressure_hpa) === bucket)
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6 pb-8 animate-pulse">
        <div className="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl" />
          ))}
        </div>
        <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-xl mb-4" />
        <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded-xl" />
      </div>
    )
  }

  if (myCatches.length === 0 && activeTab === 'mine') {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 text-center">
        <div className="mb-4 flex justify-center text-slate-300">
          <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>
        </div>
        <h1 className="text-xl font-semibold mb-2 dark:text-white">Ingen statistik ännu</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Logga din första fångst för att se statistik här!
        </p>
      </div>
    )
  }

  const maxHour = Math.max(...catchesByHour)
  const maxSpecies = speciesBreakdown.length > 0 ? speciesBreakdown[0][1] : 1
  const maxLocation = topLocations.length > 0 ? topLocations[0][1] : 1

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
      <h1 className="text-xl font-bold dark:text-white mb-1">Statistik</h1>

      {/* Mina / Vänner tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        <button
          onClick={() => { setActiveTab('mine'); setFilterSpecies(''); setFilterMethod(''); setFilterCatcher(''); setFilterYear('') }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
            activeTab === 'mine'
              ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-900 dark:text-white'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          Mina
        </button>
        <button
          onClick={() => { setActiveTab('friends'); setFilterSpecies(''); setFilterMethod(''); setFilterCatcher(''); setFilterYear('') }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
            activeTab === 'friends'
              ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-900 dark:text-white'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          Vänner
        </button>
      </div>

      {/* AI Fiskebot - visible on both tabs */}
      <div className="mb-4">
        <ChatWidget />
      </div>

      {/* Friends loading */}
      {activeTab === 'friends' && friendsLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
          <div className="w-4 h-4 border-2 border-slate-300 border-t-primary-700 rounded-full animate-spin" />
          Laddar vänners fångster...
        </div>
      )}

      {activeTab === 'friends' && friendsLoaded && friendCatches.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Inga vänners fångster att visa</p>
          <p className="text-xs text-slate-400">Lägg till vänner för att se deras statistik</p>
        </div>
      )}

      {/* Badges - only on Mina tab */}
      {activeTab === 'mine' && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Utmärkelser</p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {badges.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBadge(b)}
                className={`shrink-0 flex flex-col items-center gap-1 w-16 ${b.earned ? '' : 'opacity-30'}`}
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  b.earned
                    ? 'bg-amber-100 dark:bg-amber-900/30 ring-2 ring-amber-400'
                    : 'bg-slate-100 dark:bg-slate-800'
                }`}>
                  <BadgeIcon type={b.icon} earned={b.earned} />
                </div>
                <span className="text-[9px] text-center leading-tight text-slate-600 dark:text-slate-400 font-medium">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Badge popup modal */}
      {selectedBadge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedBadge(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-xs shadow-xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3 ${
              selectedBadge.earned
                ? 'bg-amber-100 dark:bg-amber-900/30 ring-3 ring-amber-400'
                : 'bg-slate-100 dark:bg-slate-800'
            }`}>
              <BadgeIcon type={selectedBadge.icon} earned={selectedBadge.earned} large />
            </div>
            <h3 className="text-lg font-bold dark:text-white mb-1">{selectedBadge.label}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{selectedBadge.description}</p>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              selectedBadge.earned
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
            }`}>
              {selectedBadge.earned ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Upplåst!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  Ej upplåst
                </>
              )}
            </div>
            <button
              onClick={() => setSelectedBadge(null)}
              className="mt-4 w-full py-2.5 bg-primary-700 text-white rounded-xl font-medium text-sm hover:bg-primary-800 transition"
            >
              Stäng
            </button>
          </div>
        </div>
      )}

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Baserat på {totalCatches} fångster
      </p>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Totalt fångster" value={totalCatches.toString()} color="bg-blue-50 dark:bg-blue-900/20" />
        <StatCard label="Arter" value={uniqueSpecies.toString()} color="bg-emerald-50 dark:bg-emerald-900/20" />
        <StatCard
          label="PB vikt"
          value={pbWeight?.weight_kg ? `${pbWeight.weight_kg} kg` : '-'}
          sub={pbWeight?.species || undefined}
          color="bg-amber-50 dark:bg-amber-900/20"
        />
        <StatCard label="Favoritvatten" value={favoriteWater || '-'} color="bg-purple-50 dark:bg-purple-900/20" small />
      </div>

      {/* === REKORD PER ART === */}
      {recordsBySpecies.length > 0 && (
        <Section
          title="Rekord per art"
          icon={<TrophyIcon />}
          bgClass="bg-amber-50 dark:bg-amber-900/20"
          isOpen={!!drillDown['records']}
          onToggle={() => toggleDrillDown('records')}
        >
          <div className="space-y-2">
            {recordsBySpecies.map(([species, rec]) => (
              <div
                key={species}
                className="px-3 py-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700"
              >
                <p className="text-sm font-semibold dark:text-slate-200 mb-1.5">{species}</p>
                <div className="flex gap-4">
                  {rec.heaviest && rec.heaviest.weight_kg && (
                    <a href={`/fangst/${rec.heaviest.id}`} className="flex items-center gap-1.5 text-xs hover:underline">
                      <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z" />
                      </svg>
                      <span className="font-bold text-amber-600 dark:text-amber-400">{rec.heaviest.weight_kg} kg</span>
                      {rec.heaviest.catcher_name && (
                        <span className="text-slate-400">({rec.heaviest.catcher_name})</span>
                      )}
                    </a>
                  )}
                  {rec.longest && rec.longest.length_cm && (
                    <a href={`/fangst/${rec.longest.id}`} className="flex items-center gap-1.5 text-xs hover:underline">
                      <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                      </svg>
                      <span className="font-bold text-blue-600 dark:text-blue-400">{rec.longest.length_cm} cm</span>
                      {rec.longest.catcher_name && (
                        <span className="text-slate-400">({rec.longest.catcher_name})</span>
                      )}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* === JÄMFÖR - based on catcher_name === */}
      {allPeople.length > 1 && (
        <Section
          title="Jämför"
          icon={<CompareIcon />}
          bgClass="bg-violet-50 dark:bg-violet-900/20"
          isOpen={!!drillDown['compare']}
          onToggle={() => toggleDrillDown('compare')}
        >
          <div className="flex gap-2 mb-4">
            <select
              value={compareA}
              onChange={(e) => setCompareA(e.target.value)}
              className="flex-1 text-xs px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Välj person...</option>
              {allPeople.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <span className="flex items-center text-xs font-bold text-slate-400">vs</span>
            <select
              value={compareB}
              onChange={(e) => setCompareB(e.target.value)}
              className="flex-1 text-xs px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Välj person...</option>
              {allPeople.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {personA && personB && (
            <div className="space-y-2">
              <CompareRow label="Fångster" a={personA.totalCatches} b={personB.totalCatches} nameA={personA.name} nameB={personB.name} unit="st" />
              <CompareRow label="Största fisk" a={personA.maxWeight} b={personB.maxWeight} nameA={personA.name} nameB={personB.name} unit="kg" />
              <CompareRow label="Arter" a={personA.uniqueSpecies} b={personB.uniqueSpecies} nameA={personA.name} nameB={personB.name} unit="st" />
              <CompareRow label="Snittfisk" a={Math.round(personA.avgWeight * 10) / 10} b={Math.round(personB.avgWeight * 10) / 10} nameA={personA.name} nameB={personB.name} unit="kg" />
              <div className="grid grid-cols-3 gap-1 mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60">
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 mb-0.5">Favoritart</p>
                  <p className="text-xs font-medium dark:text-slate-200">{personA.topSpecies}</p>
                </div>
                <div />
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 mb-0.5">Favoritart</p>
                  <p className="text-xs font-medium dark:text-slate-200">{personB.topSpecies}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 mb-0.5">Favoritvatten</p>
                  <p className="text-xs font-medium dark:text-slate-200 truncate">{personA.topWater}</p>
                </div>
                <div />
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 mb-0.5">Favoritvatten</p>
                  <p className="text-xs font-medium dark:text-slate-200 truncate">{personB.topWater}</p>
                </div>
              </div>
            </div>
          )}

          {(!personA || !personB) && (
            <p className="text-xs text-slate-400 text-center py-2">
              Välj två personer ovan för att jämföra statistik
            </p>
          )}
        </Section>
      )}

      {/* Species breakdown */}
      <Section
        title="Arter"
        icon={<FishIcon />}
        bgClass="bg-emerald-50 dark:bg-emerald-900/20"
        isOpen={!!drillDown['species']}
        onToggle={() => toggleDrillDown('species')}
      >
        <div className="space-y-2">
          {speciesBreakdown.map(([species, count]) => (
            <div key={species}>
              <div className="flex justify-between text-sm mb-0.5">
                <span className="dark:text-slate-200">{species}</span>
                <span className="text-slate-500 dark:text-slate-400">{count}</span>
              </div>
              <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${(count / maxSpecies) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {drillDown['species'] && speciesBreakdown.map(([species]) => (
          <ConditionAnalysis
            key={species}
            catches={filteredCatches.filter((c) => (c.species || 'Okänd') === species)}
            allCatches={filteredCatches}
            label={species}
          />
        ))}
      </Section>

      {/* Filter bar */}
      <div className="mb-4">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
          </svg>
          Filtrera
          {hasActiveFilter && (
            <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary-700 text-white text-[10px]">
              {[filterSpecies, filterMethod, filterCatcher, filterYear].filter(Boolean).length}
            </span>
          )}
        </button>

        {showFilters && (
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={filterSpecies}
              onChange={(e) => setFilterSpecies(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Alla arter</option>
              {allSpecies.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={filterMethod}
              onChange={(e) => setFilterMethod(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Alla metoder</option>
              {allMethods.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              value={filterCatcher}
              onChange={(e) => setFilterCatcher(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Alla fångstpersoner</option>
              {allCatchers.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>

            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Alla år</option>
              {allYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {hasActiveFilter && (
              <button
                onClick={() => { setFilterSpecies(''); setFilterMethod(''); setFilterCatcher(''); setFilterYear('') }}
                className="text-xs px-2 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 border border-red-200 dark:border-red-800"
              >
                Rensa
              </button>
            )}
          </div>
        )}
      </div>

      {hasActiveFilter && (
        <p className="text-xs text-primary-700 dark:text-primary-300 mb-4 px-1">
          Visar {filteredCatches.length} av {catches.length} fångster
        </p>
      )}

      {/* Time analysis */}
      <Section
        title="Tidpunkt"
        icon={<ClockIcon />}
        bgClass="bg-sky-50 dark:bg-sky-900/20"
        isOpen={!!drillDown['time']}
        onToggle={() => toggleDrillDown('time')}
      >
        <div className="flex items-end gap-[2px] h-32">
          {catchesByHour.map((count, h) => (
            <div key={h} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full bg-sky-500 dark:bg-sky-400 rounded-t-sm min-h-[2px] transition-all"
                style={{ height: maxHour > 0 ? `${(count / maxHour) * 100}%` : '2px' }}
                title={`${h}:00 – ${count} fångster`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-slate-400">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
        {drillDown['time'] && (() => {
          const blocks = [
            { label: 'Natt (00–05)', hours: [0,1,2,3,4,5] },
            { label: 'Morgon (06–09)', hours: [6,7,8,9] },
            { label: 'Förmiddag (10–12)', hours: [10,11,12] },
            { label: 'Eftermiddag (13–16)', hours: [13,14,15,16] },
            { label: 'Kväll (17–20)', hours: [17,18,19,20] },
            { label: 'Sen kväll (21–23)', hours: [21,22,23] },
          ]
          const blockCatches = blocks.map(b => ({
            ...b,
            catches: filteredCatches.filter(c => c.caught_at && b.hours.includes(new Date(c.caught_at).getHours())),
          })).filter(b => b.catches.length > 0)

          return blockCatches.map(b => (
            <div key={b.label}>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-3 mb-0">{b.label} — {b.catches.length} fångster</p>
              <ConditionAnalysis catches={b.catches} allCatches={filteredCatches} label={b.label} />
            </div>
          ))
        })()}
      </Section>

      {/* Weather correlation */}
      {weatherBreakdown.length > 0 && (
        <Section
          title="Väder"
          icon={<WeatherIcon />}
          bgClass="bg-orange-50 dark:bg-orange-900/20"
          isOpen={!!drillDown['weather']}
          onToggle={() => toggleDrillDown('weather')}
        >
          <div className="grid grid-cols-2 gap-2">
            {weatherBreakdown.map(([condition, count]) => (
              <div
                key={condition}
                className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700"
              >
                <p className="text-sm font-medium dark:text-slate-200">{condition}</p>
                <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{count}</p>
              </div>
            ))}
          </div>
          {drillDown['weather'] && weatherBreakdown.map(([condition]) => (
            <ConditionAnalysis
              key={condition}
              catches={getCatchesForField('weather_condition', condition)}
              allCatches={filteredCatches}
              label={condition}
            />
          ))}
        </Section>
      )}

      {/* Moon phase analysis */}
      {moonBreakdown.length > 0 && (
        <Section
          title="Månfas"
          icon={<MoonIcon />}
          bgClass="bg-indigo-50 dark:bg-indigo-900/20"
          isOpen={!!drillDown['moon']}
          onToggle={() => toggleDrillDown('moon')}
        >
          <div className="grid grid-cols-2 gap-2">
            {moonBreakdown.map(([phase, count]) => (
              <div
                key={phase}
                className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700"
              >
                <p className="text-sm font-medium dark:text-slate-200">{phase}</p>
                <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{count}</p>
              </div>
            ))}
          </div>
          {drillDown['moon'] && moonBreakdown.map(([phase]) => (
            <ConditionAnalysis
              key={phase}
              catches={getCatchesForField('moon_phase', phase)}
              allCatches={filteredCatches}
              label={phase}
            />
          ))}
        </Section>
      )}

      {/* Air pressure analysis */}
      {pressureBreakdown.length > 0 && (
        <Section
          title="Lufttryck"
          icon={<PressureIcon />}
          bgClass="bg-teal-50 dark:bg-teal-900/20"
          isOpen={!!drillDown['pressure']}
          onToggle={() => toggleDrillDown('pressure')}
        >
          <div className="grid grid-cols-1 gap-2">
            {pressureBreakdown.map(([bucket, count]) => (
              <div
                key={bucket}
                className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium dark:text-slate-200">{bucket}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {bucket.startsWith('Lågt') ? 'Storm / oväder' : bucket.startsWith('Normalt') ? 'Stabilt väder' : 'Högtrycksväder'}
                  </p>
                </div>
                <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{count}</p>
              </div>
            ))}
          </div>
          {drillDown['pressure'] && pressureBreakdown.map(([bucket]) => (
            <ConditionAnalysis
              key={bucket}
              catches={getCatchesForPressure(bucket)}
              allCatches={filteredCatches}
              label={bucket}
            />
          ))}
        </Section>
      )}

      {/* Location hotspots */}
      {topLocations.length > 0 && (
        <Section
          title="Topplatser"
          icon={<PinIcon />}
          bgClass="bg-rose-50 dark:bg-rose-900/20"
          isOpen={!!drillDown['location']}
          onToggle={() => toggleDrillDown('location')}
        >
          <div className="space-y-2">
            {topLocations.map(([name, count], i) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-0.5">
                    <span className="dark:text-slate-200 truncate">{name}</span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2 shrink-0">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 dark:bg-rose-400 rounded-full transition-all"
                      style={{ width: `${(count / maxLocation) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {drillDown['location'] && topLocations.map(([name]) => (
            <ConditionAnalysis
              key={name}
              catches={filteredCatches.filter((c) => c.water_body === name)}
              allCatches={filteredCatches}
              label={name}
            />
          ))}
        </Section>
      )}

    </div>
  )
}

// === Sub-components ===

function StatCard({ label, value, sub, color, small }: {
  label: string
  value: string
  sub?: string
  color: string
  small?: boolean
}) {
  return (
    <div className={`${color} rounded-xl p-4`}>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className={`font-bold dark:text-white ${small ? 'text-sm truncate' : 'text-xl'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({ title, icon, bgClass, isOpen, onToggle, children }: {
  title: string
  icon: React.ReactNode
  bgClass: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={`${bgClass} rounded-xl p-4 mb-4`}>
      <button onClick={onToggle} className="flex items-center gap-2 mb-3 w-full text-left group">
        {icon}
        <h2 className="text-sm font-semibold dark:text-white flex-1">{title}</h2>
        <span className="text-[10px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition">
          {isOpen ? 'Dölj analys' : 'Analysera'}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {children}
    </div>
  )
}

function LeaderboardCategory({ title, people, getValue, sub }: {
  title: string
  people: PersonStats[]
  getValue: (p: PersonStats) => string
  sub?: (p: PersonStats) => string
}) {
  if (people.length === 0) return null
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">{title}</p>
      <div className="space-y-1">
        {people.slice(0, 5).map((p, i) => (
          <div
            key={p.name}
            className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700"
          >
            <span className={`text-xs font-bold w-5 ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-slate-300'}`}>
              {i + 1}
            </span>
            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center overflow-hidden shrink-0">
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
              </svg>
            </div>
            <span className="text-xs font-medium dark:text-slate-200 flex-1 truncate">{p.name}</span>
            <div className="text-right">
              <span className="text-xs font-bold dark:text-white">{getValue(p)}</span>
              {sub && <p className="text-[9px] text-slate-400">{sub(p)}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompareRow({ label, a, b, nameA, nameB, unit }: {
  label: string
  a: number
  b: number
  nameA: string
  nameB: string
  unit: string
}) {
  const aWins = a > b
  const bWins = b > a
  const tie = a === b
  return (
    <div className="grid grid-cols-3 items-center gap-1 px-2 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
      <div className="text-left">
        <p className={`text-sm font-bold ${aWins ? 'text-emerald-600 dark:text-emerald-400' : tie ? 'dark:text-slate-200' : 'text-slate-400'}`}>
          {a} {unit}
        </p>
        <p className="text-[9px] text-slate-400 truncate">{nameA}</p>
      </div>
      <p className="text-[10px] text-center text-slate-500 font-medium">{label}</p>
      <div className="text-right">
        <p className={`text-sm font-bold ${bWins ? 'text-emerald-600 dark:text-emerald-400' : tie ? 'dark:text-slate-200' : 'text-slate-400'}`}>
          {b} {unit}
        </p>
        <p className="text-[9px] text-slate-400 truncate">{nameB}</p>
      </div>
    </div>
  )
}

function ConditionAnalysis({ catches: subset, allCatches, label }: {
  catches: Catch[]
  allCatches: Catch[]
  label: string
}) {
  if (subset.length === 0) return null

  const speciesMap: Record<string, { count: number; totalWeight: number; weights: number[] }> = {}
  subset.forEach((c) => {
    const sp = c.species || 'Okänd'
    if (!speciesMap[sp]) speciesMap[sp] = { count: 0, totalWeight: 0, weights: [] }
    speciesMap[sp].count++
    if (c.weight_kg) {
      speciesMap[sp].totalWeight += c.weight_kg
      speciesMap[sp].weights.push(c.weight_kg)
    }
  })
  const speciesSorted = Object.entries(speciesMap).sort((a, b) => b[1].count - a[1].count)

  const weightsHere = subset.filter((c) => c.weight_kg).map((c) => c.weight_kg!)
  const avgWeightHere = weightsHere.length > 0 ? weightsHere.reduce((a, b) => a + b, 0) / weightsHere.length : null
  const allWeights = allCatches.filter((c) => c.weight_kg).map((c) => c.weight_kg!)
  const avgWeightAll = allWeights.length > 0 ? allWeights.reduce((a, b) => a + b, 0) / allWeights.length : null

  const heaviest = subset.reduce<Catch | null>((best, c) =>
    c.weight_kg && c.weight_kg > (best?.weight_kg || 0) ? c : best, null
  )

  const lureCounts: Record<string, number> = {}
  subset.forEach((c) => { if (c.lure_type) lureCounts[c.lure_type] = (lureCounts[c.lure_type] || 0) + 1 })
  const bestLure = Object.entries(lureCounts).sort((a, b) => b[1] - a[1])[0]

  const methodCounts: Record<string, number> = {}
  subset.forEach((c) => { if (c.fishing_method) methodCounts[c.fishing_method] = (methodCounts[c.fishing_method] || 0) + 1 })
  const bestMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]

  const waterCounts: Record<string, number> = {}
  subset.forEach((c) => { if (c.water_body) waterCounts[c.water_body] = (waterCounts[c.water_body] || 0) + 1 })
  const topWater = Object.entries(waterCounts).sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 space-y-3">
      {/* Clear category header */}
      <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
        <div className="w-1.5 h-6 rounded-full bg-primary-700 dark:bg-primary-500 shrink-0" />
        <div>
          <p className="text-sm font-bold dark:text-white">{label}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">{subset.length} fångster</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Artfördelning</p>
        <div className="flex flex-wrap gap-1.5">
          {speciesSorted.map(([sp, data]) => (
            <span key={sp} className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-slate-800 rounded-md text-xs border border-slate-100 dark:border-slate-700">
              <span className="font-medium dark:text-slate-200">{sp}</span>
              <span className="text-slate-400">{data.count}</span>
              {data.weights.length > 0 && (
                <span className="text-slate-400 text-[10px]">
                  ({(data.totalWeight / data.weights.length).toFixed(1)} kg snitt)
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {avgWeightHere !== null && avgWeightAll !== null && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-white dark:bg-slate-800 rounded-md border border-slate-100 dark:border-slate-700">
          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z" />
          </svg>
          <span className="text-xs dark:text-slate-300">
            Medelvikt: <strong className={avgWeightHere >= avgWeightAll ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>
              {avgWeightHere.toFixed(1)} kg
            </strong>
            <span className="text-slate-400"> vs {avgWeightAll.toFixed(1)} kg totalt</span>
            {avgWeightHere > avgWeightAll * 1.1 && (
              <span className="ml-1 text-emerald-600 dark:text-emerald-400 text-[10px]">+{Math.round(((avgWeightHere - avgWeightAll) / avgWeightAll) * 100)}%</span>
            )}
          </span>
        </div>
      )}

      {heaviest && heaviest.weight_kg && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-white dark:bg-slate-800 rounded-md border border-slate-100 dark:border-slate-700">
          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .982-3.172M12 3.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v3.803" />
          </svg>
          <a href={`/fangst/${heaviest.id}`} className="text-xs dark:text-slate-300 hover:underline">
            Tyngsta: <strong>{heaviest.species}</strong> {heaviest.weight_kg} kg
            {heaviest.length_cm ? ` (${heaviest.length_cm} cm)` : ''}
            <span className="text-slate-400 ml-1">
              {heaviest.caught_at ? new Date(heaviest.caught_at).toLocaleDateString('sv-SE') : ''}
            </span>
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {bestLure && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800 rounded-md border border-slate-100 dark:border-slate-700 text-xs">
            <span className="text-slate-400">Bete:</span>
            <span className="font-medium dark:text-slate-200">{bestLure[0]}</span>
            <span className="text-slate-400">({bestLure[1]})</span>
          </div>
        )}
        {bestMethod && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800 rounded-md border border-slate-100 dark:border-slate-700 text-xs">
            <span className="text-slate-400">Metod:</span>
            <span className="font-medium dark:text-slate-200">{bestMethod[0]}</span>
            <span className="text-slate-400">({bestMethod[1]})</span>
          </div>
        )}
        {topWater && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800 rounded-md border border-slate-100 dark:border-slate-700 text-xs">
            <span className="text-slate-400">Plats:</span>
            <span className="font-medium dark:text-slate-200">{topWater[0]}</span>
            <span className="text-slate-400">({topWater[1]})</span>
          </div>
        )}
      </div>
    </div>
  )
}

// === Badge Icons ===
function BadgeIcon({ type, earned, large }: { type: string; earned: boolean; large?: boolean }) {
  const color = earned ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'
  const size = large ? 'w-8 h-8' : 'w-5 h-5'
  const cls = `${size} ${color}`

  switch (type) {
    case 'hook':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v9.75m0 0c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3Z" /></svg>
    case 'star':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>
    case 'fire':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" /></svg>
    case 'fish':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.893 13.393l-1.135-1.135a2.252 2.252 0 01-.421-.585l-1.08-2.16a.414.414 0 00-.663-.107l-.97.97a4.5 4.5 0 01-1.65 1.065l-3.07 1.228a2.25 2.25 0 01-1.714 0l-3.07-1.228a4.5 4.5 0 01-1.65-1.065l-.97-.97a.414.414 0 00-.663.107l-1.08 2.16a2.252 2.252 0 01-.421.585l-1.135 1.135" /></svg>
    case 'weight':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z" /></svg>
    case 'ruler':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" /></svg>
    case 'sunrise':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636" /></svg>
    case 'moon':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
    case 'calendar':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>
    default:
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>
  }
}

// === Icons ===

function TrophyIcon() {
  return (
    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .982-3.172M12 3.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v3.803" />
    </svg>
  )
}

function CompareIcon() {
  return (
    <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="w-4 h-4 text-sky-600 dark:text-sky-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function FishIcon() {
  return (
    <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.893 13.393l-1.135-1.135a2.252 2.252 0 01-.421-.585l-1.08-2.16a.414.414 0 00-.663-.107l-.97.97a4.5 4.5 0 01-1.65 1.065l-3.07 1.228a2.25 2.25 0 01-1.714 0l-3.07-1.228a4.5 4.5 0 01-1.65-1.065l-.97-.97a.414.414 0 00-.663.107l-1.08 2.16a2.252 2.252 0 01-.421.585l-1.135 1.135" />
    </svg>
  )
}

function WeatherIcon() {
  return (
    <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
    </svg>
  )
}

function PressureIcon() {
  return (
    <svg className="w-4 h-4 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg className="w-4 h-4 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  )
}
