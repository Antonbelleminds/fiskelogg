import { NextRequest, NextResponse } from 'next/server'

function degreeToDirection(deg: number): string {
  const dirs = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV']
  return dirs[Math.round(deg / 22.5) % 16]
}

function cloudToCondition(cloudCover: number, precipitation: number): string {
  if (precipitation > 0.5) return 'Regn'
  if (cloudCover < 20) return 'Klart'
  if (cloudCover < 60) return 'Delvis molnigt'
  if (cloudCover < 85) return 'Molnigt'
  return 'Mulet'
}

interface DayData {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
  }

  try {
    // Open-Meteo Forecast API: current + 5 days history + 5 days forecast + hourly for today
    // wind_direction_10m_dominant gives the dominant wind direction per day
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,cloud_cover_mean,surface_pressure_mean&hourly=temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m&past_days=5&forecast_days=6&timezone=Europe/Stockholm`

    const res = await fetch(url)
    if (!res.ok) {
      return NextResponse.json({ error: 'Weather API failed' }, { status: 502 })
    }

    const data = await res.json()

    // Parse current weather
    const c = data.current
    const current = {
      temp_c: c?.temperature_2m ?? null,
      humidity_pct: c?.relative_humidity_2m ?? null,
      precipitation_mm: c?.precipitation ?? null,
      cloud_cover_pct: c?.cloud_cover ?? null,
      pressure_hpa: c?.surface_pressure ? Math.round(c.surface_pressure) : null,
      wind_speed_ms: c?.wind_speed_10m ? Math.round(c.wind_speed_10m / 3.6 * 10) / 10 : null,
      wind_direction: c?.wind_direction_10m != null ? degreeToDirection(c.wind_direction_10m) : null,
      condition: cloudToCondition(c?.cloud_cover ?? 0, c?.precipitation ?? 0),
    }

    // Parse daily data
    const d = data.daily
    const allDays: DayData[] = []

    if (d?.time) {
      for (let i = 0; i < d.time.length; i++) {
        const cloud = d.cloud_cover_mean?.[i] ?? 0
        const precip = d.precipitation_sum?.[i] ?? 0

        allDays.push({
          date: d.time[i],
          temp_max: d.temperature_2m_max?.[i] ?? null,
          temp_min: d.temperature_2m_min?.[i] ?? null,
          pressure_hpa: d.surface_pressure_mean?.[i] ? Math.round(d.surface_pressure_mean[i]) : null,
          precipitation_sum: precip,
          cloud_cover_avg: cloud,
          wind_speed_max_ms: d.wind_speed_10m_max?.[i] ? Math.round(d.wind_speed_10m_max[i] / 3.6 * 10) / 10 : null,
          wind_direction: d.wind_direction_10m_dominant?.[i] != null ? degreeToDirection(d.wind_direction_10m_dominant[i]) : null,
          condition: cloudToCondition(cloud, precip),
        })
      }
    }

    // Parse hourly data for today
    const todayStr = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
    const h = data.hourly
    const hourly: { time: string; temp_c: number | null; precipitation_mm: number | null; cloud_cover_pct: number | null; wind_speed_ms: number | null; wind_direction: string | null; condition: string }[] = []

    if (h?.time) {
      for (let i = 0; i < h.time.length; i++) {
        const timeStr: string = h.time[i] // "2026-04-01T14:00"
        if (!timeStr.startsWith(todayStr)) continue

        const cloud = h.cloud_cover?.[i] ?? 0
        const precip = h.precipitation?.[i] ?? 0
        const windKmh = h.wind_speed_10m?.[i]
        const windDeg = h.wind_direction_10m?.[i]

        hourly.push({
          time: timeStr.slice(11, 16), // "14:00"
          temp_c: h.temperature_2m?.[i] ?? null,
          precipitation_mm: precip,
          cloud_cover_pct: cloud,
          wind_speed_ms: windKmh != null ? Math.round(windKmh / 3.6 * 10) / 10 : null,
          wind_direction: windDeg != null ? degreeToDirection(windDeg) : null,
          condition: cloudToCondition(cloud, precip),
        })
      }
    }

    // Split into history (past 5 + today) and forecast (tomorrow+)
    const todayIndex = allDays.findIndex(day => day.date === todayStr)

    const history = todayIndex >= 0 ? allDays.slice(0, todayIndex + 1) : allDays.slice(0, 6)
    const forecast = todayIndex >= 0 ? allDays.slice(todayIndex + 1) : []

    return NextResponse.json({ current, history, forecast, hourly })
  } catch (err) {
    console.error('Weather forecast error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
