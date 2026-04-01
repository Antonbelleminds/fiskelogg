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
  wind_direction: string | null
  condition: string
}

interface FishingForecast {
  rating: 'bra' | 'medelbra' | 'dåligt' | 'okänt'
  insight: string
  stats: { label: string; value: string }[]
  total: number
}

interface SunMoonData {
  sunrise_time: string | null
  sunset_time: string | null
  moon_phase: string | null
  moon_illumination_pct: number | null
}

interface HourlyEntry {
  time: string
  temp_c: number | null
  precipitation_mm: number | null
  cloud_cover_pct: number | null
  wind_speed_ms: number | null
  wind_direction: string | null
  condition: string
}

interface WeatherData {
  current: CurrentWeather
  history: DayHistory[]
  forecast: DayHistory[]
  hourly: HourlyEntry[]
}

const WEEKDAYS = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör']

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  if (dateStr === todayStr) return 'Idag'

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === yesterday.toISOString().slice(0, 10)) return 'Igår'

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (dateStr === tomorrow.toISOString().slice(0, 10)) return 'Imorgon'

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

  if (diff > 4) return { text: 'Stigande tryck — bra för fiske', color: 'text-green-600' }
  if (diff < -4) return { text: 'Fallande tryck', color: 'text-red-500' }
  return { text: 'Stabilt tryck — bra för fiske', color: 'text-green-600' }
}

function conditionIcon(condition: string): string {
  switch (condition) {
    case 'Klart': return '\u2600\uFE0F'
    case 'Delvis molnigt': return '\u26C5'
    case 'Molnigt': return '\u2601\uFE0F'
    case 'Mulet': return '\u2601\uFE0F'
    case 'Regn': return '\uD83C\uDF27\uFE0F'
    default: return '\u2601\uFE0F'
  }
}

// Convert short direction codes to readable Swedish
function directionLabel(dir: string | null): string {
  if (!dir) return ''
  const map: Record<string, string> = {
    'N': 'Nordlig',
    'NNO': 'Nord-nordöstlig',
    'NO': 'Nordöstlig',
    'ONO': 'Öst-nordöstlig',
    'O': 'Östlig',
    'OSO': 'Öst-sydöstlig',
    'SO': 'Sydöstlig',
    'SSO': 'Syd-sydöstlig',
    'S': 'Sydlig',
    'SSV': 'Syd-sydvästlig',
    'SV': 'Sydvästlig',
    'VSV': 'Väst-sydvästlig',
    'V': 'Västlig',
    'VNV': 'Väst-nordvästlig',
    'NV': 'Nordvästlig',
    'NNV': 'Nord-nordvästlig',
  }
  return map[dir] || dir
}

export default function VaderPage() {
  const [query, setQuery] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [sunMoon, setSunMoon] = useState<SunMoonData | null>(null)
  const [fishingForecast, setFishingForecast] = useState<FishingForecast | null>(null)
  const [forecastLoading, setForecastLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchWeather(lat: number, lng: number) {
    setLoading(true)
    setError('')
    try {
      const dateNow = new Date().toISOString()

      const [weatherRes, sunRes, moonRes] = await Promise.allSettled([
        fetch(`/api/weather-forecast?lat=${lat}&lng=${lng}`),
        fetch(`/api/sun?lat=${lat}&lng=${lng}&date=${dateNow}`),
        fetch(`/api/moon?date=${dateNow}`),
      ])

      if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
        const data: WeatherData = await weatherRes.value.json()
        setWeather(data)
      } else {
        throw new Error('Kunde inte hämta väder')
      }

      const sm: SunMoonData = { sunrise_time: null, sunset_time: null, moon_phase: null, moon_illumination_pct: null }
      if (sunRes.status === 'fulfilled' && sunRes.value.ok) {
        const s = await sunRes.value.json()
        sm.sunrise_time = s.sunrise_time || null
        sm.sunset_time = s.sunset_time || null
      }
      if (moonRes.status === 'fulfilled' && moonRes.value.ok) {
        const m = await moonRes.value.json()
        sm.moon_phase = m.moon_phase || null
        sm.moon_illumination_pct = m.moon_illumination_pct ?? null
      }
      setSunMoon(sm)

      // Kick off AI fishing forecast in background (non-blocking)
      if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
        const weatherData: WeatherData = await (weatherRes.value.clone()).json().catch(() => null)
        if (weatherData) {
          const trend = overallTrend(weatherData.history)
          const trendKey: 'stigande' | 'fallande' | 'stabilt' =
            trend.text.includes('Stigande') ? 'stigande' :
            trend.text.includes('Fallande') ? 'fallande' : 'stabilt'

          setForecastLoading(true)
          fetch('/api/fishing-forecast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pressure_hpa: weatherData.current.pressure_hpa,
              pressure_trend: trendKey,
              condition: weatherData.current.condition,
              moon_phase: sm.moon_phase,
              wind_speed_ms: weatherData.current.wind_speed_ms,
              temp_c: weatherData.current.temp_c,
              cloud_cover_pct: weatherData.current.cloud_cover_pct,
              hour: new Date().getHours(),
            }),
          })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setFishingForecast(data) })
            .catch(() => {})
            .finally(() => setForecastLoading(false))
        }
      }
    } catch {
      setError('Kunde inte hämta väderdata. Försök igen.')
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
      setError(e instanceof Error ? e.message : 'Något gick fel')
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
      setError('Kunde inte hämta din plats. Tillåt platsåtkomst i webbläsaren.')
    } finally {
      setLocating(false)
    }
  }

  const trend = weather ? overallTrend(weather.history) : null

  return (
    <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-1">Väder</h1>
      <p className="text-sm text-slate-500 mb-5">Aktuellt väder och 5-dagars historik</p>

      {/* Sökfält */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Sök plats, t.ex. Vänern"
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
            Hämtar plats...
          </>
        ) : (
          <>
            <LocationIcon />
            Använd min plats
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
          {/* Platsnamn */}
          {placeName && (
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{placeName}</h2>
            </div>
          )}

          {/* Aktuellt väder */}
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
                  ? `${weather.current.wind_speed_ms} m/s ${directionLabel(weather.current.wind_direction)}`
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
              <WeatherStat label="Nederbörd" value={
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

            {/* Sol & Mån */}
            {sunMoon && (sunMoon.sunrise_time || sunMoon.moon_phase) && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-3">
                {sunMoon.sunrise_time && (
                  <WeatherStat label="Soluppgång" value={sunMoon.sunrise_time} />
                )}
                {sunMoon.sunset_time && (
                  <WeatherStat label="Solnedgång" value={sunMoon.sunset_time} />
                )}
                {sunMoon.moon_phase && (
                  <WeatherStat label="Månfas" value={sunMoon.moon_phase} />
                )}
                {sunMoon.moon_illumination_pct != null && (
                  <WeatherStat label="Månbelysning" value={`${sunMoon.moon_illumination_pct}%`} />
                )}
              </div>
            )}
          </div>

          {/* Dagens utveckling — timvis */}
          {weather.hourly && weather.hourly.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                <h3 className="text-sm font-semibold">Dagens utveckling</h3>
              </div>
              <div className="overflow-x-auto">
                <div className="flex min-w-max px-2 py-3 gap-0">
                  {weather.hourly
                    .filter((_, i) => i % 2 === 0) // Varannan timme för att inte bli för brett
                    .map((h) => (
                    <div key={h.time} className="flex flex-col items-center px-2.5 min-w-[56px]">
                      <span className="text-[10px] text-slate-400 mb-1">{h.time}</span>
                      <span className="text-base mb-1">{conditionIcon(h.condition)}</span>
                      <span className="text-xs font-medium">
                        {h.temp_c != null ? `${Math.round(h.temp_c)}\u00b0` : '\u2014'}
                      </span>
                      {h.precipitation_mm != null && h.precipitation_mm > 0 && (
                        <span className="text-[10px] text-blue-500 mt-0.5">{h.precipitation_mm} mm</span>
                      )}
                      <div className="mt-1.5 flex flex-col items-center">
                        <WindIcon />
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {h.wind_speed_ms != null ? `${h.wind_speed_ms}` : ''}
                        </span>
                        {h.wind_direction && (
                          <span className="text-[10px] text-slate-400">{h.wind_direction}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trycktrend */}
          {trend && trend.text && (
            <div className={`mb-4 px-4 py-3 rounded-xl border ${
              trend.color === 'text-green-600'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <span className={`text-sm font-medium ${trend.color}`}>{trend.text}</span>
            </div>
          )}

          {/* AI fiskeprognos */}
          {(forecastLoading || fishingForecast) && (
            <div className="mb-4">
              {forecastLoading && !fishingForecast ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700 shrink-0" />
                  <span className="text-sm text-slate-500">Analyserar dina fångster...</span>
                </div>
              ) : fishingForecast && (
                <div className={`rounded-2xl border p-5 ${
                  fishingForecast.rating === 'bra'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : fishingForecast.rating === 'medelbra'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : fishingForecast.rating === 'dåligt'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                }`}>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FishIcon className={
                        fishingForecast.rating === 'bra' ? 'text-green-700 dark:text-green-300' :
                        fishingForecast.rating === 'medelbra' ? 'text-amber-700 dark:text-amber-300' :
                        fishingForecast.rating === 'dåligt' ? 'text-red-600 dark:text-red-400' :
                        'text-slate-500'
                      } />
                      <span className={`text-sm font-semibold ${
                        fishingForecast.rating === 'bra' ? 'text-green-800 dark:text-green-200' :
                        fishingForecast.rating === 'medelbra' ? 'text-amber-800 dark:text-amber-200' :
                        fishingForecast.rating === 'dåligt' ? 'text-red-700 dark:text-red-300' :
                        'text-slate-700 dark:text-slate-300'
                      }`}>
                        Fiskeprognos — {
                          fishingForecast.rating === 'bra' ? 'Bra dag för fiske' :
                          fishingForecast.rating === 'medelbra' ? 'Medelbra dag för fiske' :
                          fishingForecast.rating === 'dåligt' ? 'Dålig dag för fiske' :
                          'Behöver mer data'
                        }
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400">{fishingForecast.total} fångster</span>
                  </div>

                  {/* AI-text */}
                  <p className={`text-sm leading-relaxed mb-4 ${
                    fishingForecast.rating === 'bra' ? 'text-green-800 dark:text-green-200' :
                    fishingForecast.rating === 'medelbra' ? 'text-amber-800 dark:text-amber-200' :
                    fishingForecast.rating === 'dåligt' ? 'text-red-700 dark:text-red-300' :
                    'text-slate-600 dark:text-slate-400'
                  }`}>
                    {fishingForecast.insight}
                  </p>

                  {/* Statistikpills */}
                  {fishingForecast.stats.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {fishingForecast.stats.map((s, i) => (
                        <div key={i} className="bg-white/60 dark:bg-black/20 rounded-xl px-3 py-1.5">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{s.label} </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Senaste dagarna */}
          <DayTable title="Senaste dagarna" days={weather.history} />

          {/* Kommande dagar */}
          {weather.forecast.length > 0 && (
            <div className="mt-4">
              <DayTable title="Kommande dagar" days={weather.forecast} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DayTable({ title, days }: { title: string; days: DayHistory[] }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>

      {days.map((day, i) => {
        const prevPressure = i > 0 ? days[i - 1].pressure_hpa : null
        const { arrow, color } = pressureTrend(day.pressure_hpa, prevPressure)

        return (
          <div
            key={day.date}
            className={`px-4 py-3 ${
              i < days.length - 1 ? 'border-b border-slate-100 dark:border-slate-700' : ''
            }`}
          >
            {/* Rad 1: Dag, ikon, temp, tryck, nederbörd */}
            <div className="flex items-center gap-3">
              <div className="w-16 shrink-0 text-sm font-medium">{formatDay(day.date)}</div>
              <div className="w-6 text-center text-base">{conditionIcon(day.condition)}</div>
              <div className="flex-1 text-sm">
                {day.temp_min != null && day.temp_max != null
                  ? `${Math.round(day.temp_min)}\u00b0 / ${Math.round(day.temp_max)}\u00b0`
                  : '\u2014'}
              </div>
              <div className="flex items-center gap-1 text-sm">
                <span className="text-slate-500">{day.pressure_hpa ?? '\u2014'}</span>
                {arrow && <span className={`font-bold ${color}`}>{arrow}</span>}
              </div>
              <div className="w-14 text-right text-xs text-slate-400">
                {day.precipitation_sum != null && day.precipitation_sum > 0
                  ? `${day.precipitation_sum} mm`
                  : ''}
              </div>
            </div>

            {/* Rad 2: Vindriktning + hastighet */}
            {(day.wind_direction || day.wind_speed_max_ms != null) && (
              <div className="mt-1 ml-[calc(4rem+0.75rem+1.5rem+0.75rem)] text-xs text-slate-400 flex items-center gap-1">
                <WindIcon />
                <span>
                  {day.wind_speed_max_ms != null ? `${day.wind_speed_max_ms} m/s` : ''}
                  {day.wind_direction ? ` ${directionLabel(day.wind_direction)}` : ''}
                </span>
              </div>
            )}
          </div>
        )
      })}
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

// --- Ikoner ---

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

function FishIcon({ className }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className ?? ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  )
}

function WindIcon() {
  return (
    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h10.879a2.25 2.25 0 0 0 0-4.5H14.25m-5.25 9h7.5a2.25 2.25 0 0 0 0-4.5H4.5" />
    </svg>
  )
}
