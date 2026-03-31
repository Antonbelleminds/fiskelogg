'use client'

import { useState } from 'react'

interface CurrentWeather {
  temp_c: number | null
  humidity_pct: number | null
  precipitation_mm: number | null
  cloud_cover_pct: number | null
  pressure_hpa: number | null
  wind_speed_ms: number | null
  wind_direction: string | null
  condition: string
}

interface DayHistory {
  date: string
  temp_max: number | null
  temp_min: number | null
  pressure_hpa: number | null
  precipitation_sum: number | null
  cloud_cover_avg: number | null
  wind_speed_max_ms: number | null
  condition: string
}

interface WeatherData {
  current: CurrentWeather
  history: DayHistory[]
}

const WEEKDAYS = ['Son', 'Mon', 'Tis', 'Ons', 'Tor', 'Fre', 'Lor']

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  if (dateStr === todayStr) return 'Idag'

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === yesterday.toISOString().slice(0, 10)) return 'Igår'

  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

function pressureTrend(current: number | null, previous: number | null): { arrow: string; color: string } {
  if (current == null || previous == null) return { arrow: '', color: 'text-slate-400' }
  const diff = current - previous
  if (diff > 2) return { arrow: '\u2191', color: 'text-green-600' }
  if (diff < -2) return { arrow: '\u2193', color: 'text-red-500' }
  return { arrow: '\u2192', color: 'text-slate-500' }
}

function overallTrend(history: DayHistory[]): { text: string; color: string } {
  const pressures = history.map(d => d.pressure_hpa).filter((p): p is number => p != null)
  if (pressures.length < 2) return { text: '', color: '' }

  const first = pressures[0]
  const last = pressures[pressures.length - 1]
  const diff = last - first

  if (diff > 4) return { text: 'Stigande tryck \u2014 bra f\u00f6r fiske', color: 'text-green-600' }
  if (diff < -4) return { text: 'Fallande tryck', color: 'text-red-500' }
  return { text: 'Stabilt tryck \u2014 bra f\u00f6r fiske', color: 'text-green-600' }
}

function conditionIcon(condition: string): string {
  switch (condition) {
    case 'Klart': return '\u2600'
    case 'Delvis molnigt': return '\u26C5'
    case 'Molnigt': return '\u2601'
    case 'Mulet': return '\u2601'
    case 'Regn': return '\uD83C\uDF27'
    default: return '\u2601'
  }
}

export default function VaderPage() {
  const [query, setQuery] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [error, setError] = useState('')

  async function fetchWeather(lat: number, lng: number) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/weather-forecast?lat=${lat}&lng=${lng}`)
      if (!res.ok) throw new Error('Kunde inte h\u00e4mta v\u00e4der')
      const data: WeatherData = await res.json()
      setWeather(data)
    } catch {
      setError('Kunde inte h\u00e4mta v\u00e4derdata. F\u00f6rs\u00f6k igen.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    setError('')
    try {
      const geoRes = await fetch(`/api/geocode-search?q=${encodeURIComponent(query.trim())}`)
      if (!geoRes.ok) {
        const err = await geoRes.json().catch(() => ({}))
        throw new Error(err.error || 'Plats ej hittad')
      }
      const geo = await geoRes.json()
      setPlaceName(geo.place_name || query)
      await fetchWeather(geo.lat, geo.lng)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'N\u00e5got gick fel')
      setLoading(false)
    }
  }

  async function handleGPS() {
    setLocating(true)
    setError('')
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      )
      setPlaceName('Min plats')
      await fetchWeather(pos.coords.latitude, pos.coords.longitude)
    } catch {
      setError('Kunde inte h\u00e4mta din plats. Till\u00e5t plats\u00e5tkomst i webbl\u00e4saren.')
    } finally {
      setLocating(false)
    }
  }

  const trend = weather ? overallTrend(weather.history) : null

  return (
    <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-1">V\u00e4der</h1>
      <p className="text-sm text-slate-500 mb-5">Aktuellt v\u00e4der och 5-dagars historik</p>

      {/* Search */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="S\u00f6k plats, t.ex. V\u00e4nern"
          className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2.5 rounded-xl bg-primary-700 text-white font-medium text-sm hover:bg-primary-800 disabled:opacity-40 transition shrink-0"
        >
          {loading && !locating ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          ) : (
            <SearchIcon />
          )}
        </button>
      </div>

      <button
        onClick={handleGPS}
        disabled={locating || loading}
        className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition flex items-center justify-center gap-2 mb-6"
      >
        {locating ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500" />
            H\u00e4mtar plats...
          </>
        ) : (
          <>
            <LocationIcon />
            Anv\u00e4nd min plats
          </>
        )}
      </button>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {weather && (
        <>
          {/* Place name */}
          {placeName && (
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{placeName}</h2>
            </div>
          )}

          {/* Current weather card */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-4xl font-bold">
                  {weather.current.temp_c != null ? `${Math.round(weather.current.temp_c)}\u00b0` : '\u2014'}
                </div>
                <div className="text-sm text-slate-500 mt-1">{weather.current.condition}</div>
              </div>
              <div className="text-5xl">
                {conditionIcon(weather.current.condition)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <WeatherStat label="Vind" value={
                weather.current.wind_speed_ms != null
                  ? `${weather.current.wind_speed_ms} m/s ${weather.current.wind_direction || ''}`
                  : '\u2014'
              } />
              <WeatherStat label="Lufttryck" value={
                weather.current.pressure_hpa != null
                  ? `${weather.current.pressure_hpa} hPa`
                  : '\u2014'
              } />
              <WeatherStat label="Luftfuktighet" value={
                weather.current.humidity_pct != null
                  ? `${weather.current.humidity_pct}%`
                  : '\u2014'
              } />
              <WeatherStat label="Nederb\u00f6rd" value={
                weather.current.precipitation_mm != null
                  ? `${weather.current.precipitation_mm} mm`
                  : '\u2014'
              } />
              <WeatherStat label="Molnighet" value={
                weather.current.cloud_cover_pct != null
                  ? `${weather.current.cloud_cover_pct}%`
                  : '\u2014'
              } />
            </div>
          </div>

          {/* Trend summary */}
          {trend && trend.text && (
            <div className={`mb-4 px-4 py-3 rounded-xl border ${
              trend.color === 'text-green-600'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <span className={`text-sm font-medium ${trend.color}`}>{trend.text}</span>
            </div>
          )}

          {/* 5-day history */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-semibold">Senaste dagarna</h3>
            </div>

            {weather.history.map((day, i) => {
              const prevPressure = i > 0 ? weather.history[i - 1].pressure_hpa : null
              const { arrow, color } = pressureTrend(day.pressure_hpa, prevPressure)

              return (
                <div
                  key={day.date}
                  className={`flex items-center px-4 py-3 gap-3 ${
                    i < weather.history.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
                  }`}
                >
                  {/* Day */}
                  <div className="w-16 shrink-0 text-sm font-medium">{formatDay(day.date)}</div>

                  {/* Condition icon */}
                  <div className="w-6 text-center text-base">{conditionIcon(day.condition)}</div>

                  {/* Temp range */}
                  <div className="flex-1 text-sm">
                    {day.temp_min != null && day.temp_max != null
                      ? `${Math.round(day.temp_min)}\u00b0 / ${Math.round(day.temp_max)}\u00b0`
                      : '\u2014'}
                  </div>

                  {/* Pressure + trend */}
                  <div className="flex items-center gap-1 text-sm text-right">
                    <span className="text-slate-500">{day.pressure_hpa ?? '\u2014'}</span>
                    {arrow && <span className={`font-bold ${color}`}>{arrow}</span>}
                  </div>

                  {/* Precipitation */}
                  <div className="w-14 text-right text-xs text-slate-400">
                    {day.precipitation_sum != null && day.precipitation_sum > 0
                      ? `${day.precipitation_sum} mm`
                      : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function WeatherStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  )
}

// --- Icons ---

function SearchIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  )
}
