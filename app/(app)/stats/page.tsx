'use client'

import { useState, useEffect, useMemo } from 'react'
import ChatWidget from '@/components/stats/ChatWidget'

interface Catch {
  id: string
  caught_at: string
  species: string | null
  weight_kg: number | null
  length_cm: number | null
  water_body: string | null
  weather_condition: string | null
  moon_phase: string | null
  fishing_method: string | null
  lure_type: string | null
  location_name: string | null
  image_url: string | null
  pressure_hpa: number | null
}

interface DrillDownState {
  [key: string]: boolean
}

function pressureBucket(hpa: number | null): string {
  if (hpa === null) return ''
  if (hpa < 990) return 'Lågt (< 990 hPa)'
  if (hpa <= 1015) return 'Normalt (990–1015 hPa)'
  return 'Högt (> 1015 hPa)'
}

export default function StatsPage() {
  const [catches, setCatches] = useState<Catch[]>([])
  const [loading, setLoading] = useState(true)
  const [drillDown, setDrillDown] = useState<DrillDownState>({})
  const [filterSpecies, setFilterSpecies] = useState('')

  useEffect(() => {
    async function fetchCatches() {
      try {
        const res = await fetch('/api/catches?limit=500')
        if (res.ok) {
          const data = await res.json()
          setCatches(data)
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    fetchCatches()
  }, [])

  function toggleDrillDown(section: string) {
    setDrillDown((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // All-catch stats (unfiltered)
  const totalCatches = catches.length

  const uniqueSpecies = useMemo(() => {
    return new Set(catches.map((c) => c.species).filter(Boolean)).size
  }, [catches])

  const pbWeight = useMemo(() => {
    return catches.reduce<Catch | null>((best, c) => {
      if (!c.weight_kg) return best
      if (!best || c.weight_kg > (best.weight_kg || 0)) return c
      return best
    }, null)
  }, [catches])

  const favoriteWater = useMemo(() => {
    const counts: Record<string, number> = {}
    catches.forEach((c) => {
      if (c.water_body) counts[c.water_body] = (counts[c.water_body] || 0) + 1
    })
    let best = ''; let max = 0
    Object.entries(counts).forEach(([k, v]) => { if (v > max) { best = k; max = v } })
    return best
  }, [catches])

  const speciesBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    catches.forEach((c) => {
      const sp = c.species || 'Okänd'
      counts[sp] = (counts[sp] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [catches])

  const allSpecies = useMemo(() =>
    speciesBreakdown.map(([s]) => s).filter((s) => s !== 'Okänd'),
  [speciesBreakdown])

  const topLocations = useMemo(() => {
    const counts: Record<string, number> = {}
    catches.forEach((c) => {
      if (c.water_body) counts[c.water_body] = (counts[c.water_body] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [catches])

  // Filtered catches (for Tidpunkt, Väder, Månfas, Lufttryck)
  const filteredCatches = useMemo(() => {
    if (!filterSpecies) return catches
    return catches.filter((c) => c.species === filterSpecies)
  }, [catches, filterSpecies])

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
    // Sort by pressure low→high
    const order = ['Lågt (< 990 hPa)', 'Normalt (990–1015 hPa)', 'Högt (> 1015 hPa)']
    return order.filter((k) => counts[k]).map((k) => [k, counts[k]] as [string, number])
  }, [filteredCatches])

  function getCatchesForHour(h: number): Catch[] {
    return filteredCatches.filter((c) => c.caught_at && new Date(c.caught_at).getHours() === h)
  }

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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-700 rounded-full animate-spin" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Laddar statistik...</p>
        </div>
      </div>
    )
  }

  if (totalCatches === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-8 text-center">
        <div className="text-5xl mb-4">📊</div>
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
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
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

      {/* Species breakdown (unfiltered) */}
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
        {drillDown['species'] && (
          <DrillDownList>
            {speciesBreakdown.map(([species, count]) => (
              <DrillDownItem key={species} label={species} count={count}>
                {catches
                  .filter((c) => (c.species || 'Okänd') === species)
                  .map((c) => <CatchRow key={c.id} c={c} />)}
              </DrillDownItem>
            ))}
          </DrillDownList>
        )}
      </Section>

      {/* Species filter for analysis sections */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Filtrera analys:</span>
        <select
          value={filterSpecies}
          onChange={(e) => setFilterSpecies(e.target.value)}
          className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">Alla arter</option>
          {allSpecies.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {filterSpecies && (
          <button
            onClick={() => setFilterSpecies('')}
            className="text-xs text-red-500 hover:text-red-700 shrink-0"
          >
            Rensa
          </button>
        )}
      </div>

      {filterSpecies && (
        <p className="text-xs text-primary-700 dark:text-primary-300 mb-4 px-1">
          Visar analys för: <strong>{filterSpecies}</strong> ({filteredCatches.length} fångster)
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
                title={`${h}:00 - ${count} fångster`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-slate-400">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
        {drillDown['time'] && (
          <DrillDownList>
            {catchesByHour.map((count, h) =>
              count > 0 ? (
                <DrillDownItem key={h} label={`${h.toString().padStart(2, '0')}:00`} count={count}>
                  {getCatchesForHour(h).map((c) => <CatchRow key={c.id} c={c} />)}
                </DrillDownItem>
              ) : null
            )}
          </DrillDownList>
        )}
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
          {drillDown['weather'] && (
            <DrillDownList>
              {weatherBreakdown.map(([condition, count]) => (
                <DrillDownItem key={condition} label={condition} count={count}>
                  {getCatchesForField('weather_condition', condition).map((c) => (
                    <CatchRow key={c.id} c={c} />
                  ))}
                </DrillDownItem>
              ))}
            </DrillDownList>
          )}
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
          {drillDown['moon'] && (
            <DrillDownList>
              {moonBreakdown.map(([phase, count]) => (
                <DrillDownItem key={phase} label={phase} count={count}>
                  {getCatchesForField('moon_phase', phase).map((c) => (
                    <CatchRow key={c.id} c={c} />
                  ))}
                </DrillDownItem>
              ))}
            </DrillDownList>
          )}
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
          {drillDown['pressure'] && (
            <DrillDownList>
              {pressureBreakdown.map(([bucket, count]) => (
                <DrillDownItem key={bucket} label={bucket} count={count}>
                  {getCatchesForPressure(bucket).map((c) => (
                    <CatchRow key={c.id} c={c} />
                  ))}
                </DrillDownItem>
              ))}
            </DrillDownList>
          )}
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
          {drillDown['location'] && (
            <DrillDownList>
              {topLocations.map(([name, count]) => (
                <DrillDownItem key={name} label={name} count={count}>
                  {catches
                    .filter((c) => c.water_body === name)
                    .map((c) => <CatchRow key={c.id} c={c} />)}
                </DrillDownItem>
              ))}
            </DrillDownList>
          )}
        </Section>
      )}

      {/* AI Chat Widget */}
      <ChatWidget />
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
          {isOpen ? 'Dölj detaljer' : 'Visa fångster'}
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

function DrillDownList({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
      {children}
    </div>
  )
}

function DrillDownItem({ label, count, children }: {
  label: string; count: number; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-xs py-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition"
      >
        <span>{label}</span>
        <span className="text-slate-400">{count} st</span>
      </button>
      {open && <div className="ml-2 mt-1 space-y-1">{children}</div>}
    </div>
  )
}

function CatchRow({ c }: { c: Catch }) {
  return (
    <a
      href={`/fangst/${c.id}`}
      className="flex items-center justify-between px-2 py-1.5 text-xs bg-white dark:bg-slate-800 rounded-md border border-slate-100 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 transition"
    >
      <span className="dark:text-slate-200">
        {c.species || 'Okänd'}{c.weight_kg ? ` - ${c.weight_kg} kg` : ''}
      </span>
      <span className="text-slate-400">
        {c.caught_at ? new Date(c.caught_at).toLocaleDateString('sv-SE') : ''}
      </span>
    </a>
  )
}

// === Icons ===

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
