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
    // Fetch with all relevant types in one call
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=poi,place,locality,district,region&language=sv&limit=10&access_token=${token}`
    )

    if (!res.ok) throw new Error('Geocoding failed')

    const data = await res.json()
    const features = data.features || []

    let waterBody = ''
    let region = ''

    for (const f of features) {
      const placeTypes: string[] = f.place_type || []
      const text: string = f.text || ''
      const categories: string = f.properties?.category || ''

      // Extract region/county (e.g. "Dalarna", "Stockholms län")
      if (placeTypes.includes('region') && !region) {
        region = text
      }

      // Extract water body from POI features
      if (placeTypes.includes('poi') && !waterBody) {
        if (
          categories.includes('lake') ||
          categories.includes('river') ||
          categories.includes('water') ||
          text.toLowerCase().includes('sjö') ||
          text.toLowerCase().includes('tjärn') ||
          text.toLowerCase().includes('träsk') ||
          text.toLowerCase().includes('älv') ||
          text.toLowerCase().includes('viken') ||
          text.toLowerCase().includes('fjärd') ||
          text.toLowerCase().includes('sund') ||
          text.toLowerCase().includes('havet')
        ) {
          waterBody = text
        }
      }
    }

    // If no region found in main features, check context of first feature
    if (!region && features.length > 0) {
      const context: Array<{ id: string; text: string }> = features[0].context || []
      for (const c of context) {
        if (c.id?.startsWith('region')) {
          region = c.text
          break
        }
      }
    }

    // If still no water body, try a dedicated water-focused POI search
    if (!waterBody) {
      const poiRes = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=poi&language=sv&limit=10&access_token=${token}`
      )
      if (poiRes.ok) {
        const poiData = await poiRes.json()
        for (const f of (poiData.features || [])) {
          const text: string = f.text || ''
          const categories: string = f.properties?.category || ''
          if (
            categories.includes('lake') ||
            categories.includes('river') ||
            categories.includes('water') ||
            text.toLowerCase().includes('sjö') ||
            text.toLowerCase().includes('tjärn') ||
            text.toLowerCase().includes('träsk') ||
            text.toLowerCase().includes('älv') ||
            text.toLowerCase().includes('viken') ||
            text.toLowerCase().includes('fjärd') ||
            text.toLowerCase().includes('sund')
          ) {
            waterBody = text
            break
          }
        }
      }
    }

    return NextResponse.json({
      water_body: waterBody,
      location_name: region,
    })
  } catch (error) {
    console.error('Geocode error:', error)
    return NextResponse.json({ error: 'Kunde inte hämta platsnamn' }, { status: 500 })
  }
}
