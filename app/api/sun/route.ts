import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = parseFloat(searchParams.get('lat') || '')
  const lng = parseFloat(searchParams.get('lng') || '')
  const date = searchParams.get('date')

  if (isNaN(lat) || isNaN(lng) || !date) {
    return NextResponse.json({ error: 'lat, lng och date krävs' }, { status: 400 })
  }

  try {
    const dateStr = format(new Date(date), 'yyyy-MM-dd')
    const res = await fetch(
      `https://api.sunrisesunset.io/json?lat=${lat}&lng=${lng}&date=${dateStr}&timezone=Europe/Stockholm`
    )

    if (!res.ok) throw new Error('Sun API failed')

    const data = await res.json()
    if (data.status !== 'OK') throw new Error('Sun API returned error')

    const results = data.results
    const sunrise = results.sunrise // "6:32:00 AM" format
    const sunset = results.sunset

    // Parse time strings to compare with caught_at
    function parseTimeStr(timeStr: string): { hours: number; minutes: number } {
      const match = timeStr.match(/(\d+):(\d+):(\d+)\s*(AM|PM)/)
      if (!match) return { hours: 0, minutes: 0 }
      let hours = parseInt(match[1])
      const minutes = parseInt(match[2])
      const ampm = match[4]
      if (ampm === 'PM' && hours !== 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0
      return { hours, minutes }
    }

    const sunriseTime = parseTimeStr(sunrise)
    const sunsetTime = parseTimeStr(sunset)

    // Check golden hour
    const caughtDate = new Date(date)
    const caughtMinutes = caughtDate.getHours() * 60 + caughtDate.getMinutes()
    const sunriseMinutes = sunriseTime.hours * 60 + sunriseTime.minutes
    const sunsetMinutes = sunsetTime.hours * 60 + sunsetTime.minutes

    const isGoldenHour =
      (caughtMinutes >= sunriseMinutes && caughtMinutes <= sunriseMinutes + 30) ||
      (caughtMinutes >= sunsetMinutes - 30 && caughtMinutes <= sunsetMinutes)

    // Convert to HH:MM format for storage
    const formatTime = (t: { hours: number; minutes: number }) =>
      `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}`

    return NextResponse.json({
      sunrise_time: formatTime(sunriseTime),
      sunset_time: formatTime(sunsetTime),
      is_golden_hour: isGoldenHour,
    })
  } catch (error) {
    console.error('Sun API error:', error)
    return NextResponse.json({ error: 'Kunde inte hämta soldata' }, { status: 500 })
  }
}
