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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
  }

  try {
    // Open-Meteo Forecast API: current weather + 5 days history
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,cloud_cover_mean,surface_pressure_mean&past_days=5&forecast_days=1&timezone=Europe/Stockholm`

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

    // Parse daily history (5 past days + today)
    const d = data.daily
    const history: Array<{
      date: string
      temp_max: number | null
      temp_min: number | null
      pressure_hpa: number | null
      precipitation_sum: number | null
      cloud_cover_avg: number | null
      wind_speed_max_ms: number | null
      condition: string
    }> = []

    if (d?.time) {
      for (let i = 0; i < d.time.length; i++) {
        const cloud = d.cloud_cover_mean?.[i] ?? 0
        const precip = d.precipitation_sum?.[i] ?? 0

        history.push({
          date: d.time[i],
          temp_max: d.temperature_2m_max?.[i] ?? null,
          temp_min: d.temperature_2m_min?.[i] ?? null,
          pressure_hpa: d.surface_pressure_mean?.[i] ? Math.round(d.surface_pressure_mean[i]) : null,
          precipitation_sum: precip,
          cloud_cover_avg: cloud,
          wind_speed_max_ms: d.wind_speed_10m_max?.[i] ? Math.round(d.wind_speed_10m_max[i] / 3.6 * 10) / 10 : null,
          condition: cloudToCondition(cloud, precip),
        })
      }
    }

    return NextResponse.json({ current, history })
  } catch (err) {
    console.error('Weather forecast error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
