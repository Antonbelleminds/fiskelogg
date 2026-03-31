import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ error: 'Query too short' }, { status: 400 })
  }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Mapbox token not configured' }, { status: 500 })
  }

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json?access_token=${token}&country=se,no,fi,dk&limit=1&language=sv`

    const res = await fetch(url)
    if (!res.ok) {
      return NextResponse.json({ error: 'Geocoding failed' }, { status: 502 })
    }

    const data = await res.json()
    const feature = data.features?.[0]

    if (!feature) {
      return NextResponse.json({ error: 'Ingen plats hittad' }, { status: 404 })
    }

    return NextResponse.json({
      lat: feature.center[1],
      lng: feature.center[0],
      place_name: feature.place_name || feature.text || q,
    })
  } catch (err) {
    console.error('Geocode search error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
