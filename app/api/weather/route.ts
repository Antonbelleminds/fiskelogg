import { NextRequest, NextResponse } from 'next/server'
import { fetchWeatherData } from '@/lib/weather'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = parseFloat(searchParams.get('lat') || '')
  const lng = parseFloat(searchParams.get('lng') || '')
  const date = searchParams.get('date')

  if (isNaN(lat) || isNaN(lng) || !date) {
    return NextResponse.json({ error: 'lat, lng och date krävs' }, { status: 400 })
  }

  try {
    const weather = await fetchWeatherData(lat, lng, new Date(date))
    return NextResponse.json(weather)
  } catch (error) {
    console.error('Weather API error:', error)
    return NextResponse.json({ error: 'Kunde inte hämta väderdata' }, { status: 500 })
  }
}
