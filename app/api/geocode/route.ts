import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = parseFloat(searchParams.get('lat') || '')
  const lng = parseFloat(searchParams.get('lng') || '')

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'lat och lng krävs' }, { status: 400 })
  }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Mapbox token saknas' }, { status: 500 })
  }

  try {
    // Use Mapbox reverse geocoding
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=poi,place,locality&language=sv&access_token=${token}`
    )

    if (!res.ok) throw new Error('Geocoding failed')

    const data = await res.json()
    const features = data.features || []

    let waterBody = ''
    let locationName = ''

    // Look for water bodies (lakes, rivers) first
    for (const f of features) {
      const categories = f.properties?.category || ''
      const text = f.text || f.place_name || ''

      // Check if it's a water feature
      if (
        categories.includes('lake') ||
        categories.includes('river') ||
        categories.includes('water') ||
        text.toLowerCase().includes('sjö') ||
        text.toLowerCase().includes('å') ||
        text.toLowerCase().includes('älv') ||
        text.toLowerCase().includes('viken') ||
        text.toLowerCase().includes('havet')
      ) {
        waterBody = text
        break
      }
    }

    // Get the most specific place name
    if (features.length > 0) {
      locationName = features[0].place_name || features[0].text || ''
    }

    // If no water body found from POI, try a broader search
    if (!waterBody) {
      const waterRes = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=poi&language=sv&limit=5&access_token=${token}`
      )
      if (waterRes.ok) {
        const waterData = await waterRes.json()
        for (const f of (waterData.features || [])) {
          const text = f.text || ''
          if (
            text.toLowerCase().includes('sjö') ||
            text.toLowerCase().includes('å') ||
            text.toLowerCase().includes('älv') ||
            text.toLowerCase().includes('havet') ||
            text.toLowerCase().includes('viken')
          ) {
            waterBody = text
            break
          }
        }
      }
    }

    return NextResponse.json({
      water_body: waterBody,
      location_name: locationName,
    })
  } catch (error) {
    console.error('Geocode error:', error)
    return NextResponse.json({ error: 'Kunde inte hämta platsnamn' }, { status: 500 })
  }
}
