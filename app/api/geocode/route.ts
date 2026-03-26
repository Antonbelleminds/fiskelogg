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
    // Run Mapbox (for region) and Overpass (for water body) in parallel
    const [mapboxRes, overpassRes] = await Promise.allSettled([
      // Mapbox: get region/county
      fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,region&language=sv&access_token=${token}`
      ),
      // Overpass/OpenStreetMap: find named water bodies at or near the point
      // Combines is_in (when ON water) with around (when on shore)
      fetch(
        `https://overpass-api.de/api/interpreter`,
        {
          method: 'POST',
          body: `[out:json][timeout:8];is_in(${lat},${lng})->.a;(area.a["water"~"."]["name"];area.a["natural"="water"]["name"];relation["natural"="water"]["name"](around:5000,${lat},${lng});way["natural"="water"]["name"](around:1000,${lat},${lng}););out tags 5;`,
          signal: AbortSignal.timeout(10000),
        }
      ),
    ])

    let waterBody = ''
    let region = ''

    // Extract region from Mapbox
    if (mapboxRes.status === 'fulfilled' && mapboxRes.value.ok) {
      const data = await mapboxRes.value.json()
      const features = data.features || []

      for (const f of features) {
        const placeTypes: string[] = f.place_type || []
        const text: string = f.text || ''

        if (placeTypes.includes('region') && !region) {
          region = text
        }
      }

      // Check context if no region in top-level features
      if (!region && features.length > 0) {
        const context: Array<{ id: string; text: string }> = features[0].context || []
        for (const c of context) {
          if (c.id?.startsWith('region')) {
            region = c.text
            break
          }
        }
      }
    }

    // Extract water body from Overpass (OpenStreetMap)
    if (overpassRes.status === 'fulfilled' && overpassRes.value.ok) {
      const osm = await overpassRes.value.json()
      const elements: Array<{ type: string; tags?: { name?: string; water?: string; wikidata?: string } }> = osm.elements || []

      if (elements.length > 0) {
        // Prefer relations over ways (relations = larger water bodies like Mälaren, Vättern)
        // Then prefer entries with wikidata (= well-known)
        const sorted = elements
          .filter(e => e.tags?.name)
          .sort((a, b) => {
            if (a.type === 'relation' && b.type !== 'relation') return -1
            if (b.type === 'relation' && a.type !== 'relation') return 1
            if (a.tags?.wikidata && !b.tags?.wikidata) return -1
            if (b.tags?.wikidata && !a.tags?.wikidata) return 1
            return 0
          })

        if (sorted.length > 0) {
          waterBody = sorted[0].tags!.name!
        }
      }
    }

    // Fallback: if Overpass didn't find water, try Mapbox POI search
    if (!waterBody) {
      try {
        const poiRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=poi&language=sv&limit=5&access_token=${token}`
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
              /sjö|tjärn|träsk|älv|viken|fjärd|sund|havet|å\b/i.test(text)
            ) {
              waterBody = text
              break
            }
          }
        }
      } catch {
        // Ignore fallback errors
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
