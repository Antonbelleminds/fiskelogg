import { format } from 'date-fns'

interface WeatherData {
  weather_temp_c: number | null
  weather_condition: string | null
  wind_speed_ms: number | null
  wind_direction: string | null
  cloud_cover_pct: number | null
  precipitation_mm: number | null
  pressure_hpa: number | null
  humidity_pct: number | null
  visibility_km: number | null
}

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

export async function fetchWeatherData(lat: number, lng: number, date: Date): Promise<WeatherData> {
  const dateStr = format(date, 'yyyy-MM-dd')
  const hour = date.getHours()

  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation,windspeed_10m,winddirection_10m,cloudcover,surface_pressure,relativehumidity_2m,visibility&timezone=Europe/Stockholm`

  const res = await fetch(url)
  if (!res.ok) return { weather_temp_c: null, weather_condition: null, wind_speed_ms: null, wind_direction: null, cloud_cover_pct: null, precipitation_mm: null, pressure_hpa: null, humidity_pct: null, visibility_km: null }

  const data = await res.json()
  const h = data.hourly

  if (!h || !h.time || hour >= h.time.length) {
    return { weather_temp_c: null, weather_condition: null, wind_speed_ms: null, wind_direction: null, cloud_cover_pct: null, precipitation_mm: null, pressure_hpa: null, humidity_pct: null, visibility_km: null }
  }

  const cloud = h.cloudcover?.[hour] ?? 0
  const precip = h.precipitation?.[hour] ?? 0

  return {
    weather_temp_c: h.temperature_2m?.[hour] ?? null,
    weather_condition: cloudToCondition(cloud, precip),
    wind_speed_ms: h.windspeed_10m?.[hour] ? Math.round(h.windspeed_10m[hour] / 3.6 * 10) / 10 : null,
    wind_direction: h.winddirection_10m?.[hour] ? degreeToDirection(h.winddirection_10m[hour]) : null,
    cloud_cover_pct: cloud,
    precipitation_mm: precip,
    pressure_hpa: h.surface_pressure?.[hour] ?? null,
    humidity_pct: h.relativehumidity_2m?.[hour] ?? null,
    visibility_km: h.visibility?.[hour] ? Math.round(h.visibility[hour] / 1000 * 10) / 10 : null,
  }
}
