'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface MapCatch {
  id: string
  species: string | null
  weight_kg: number | null
  length_cm: number | null
  exif_lat: number | null
  exif_lng: number | null
  caught_at: string
  user_id: string
  water_body: string | null
  fishing_method: string | null
  lure_type: string | null
  weather_condition: string | null
  moon_phase: string | null
  profiles?: { username: string; display_name: string | null; avatar_url: string | null } | null
}

type MapFilter = 'mine' | 'all'

export default function KartaPage() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [catches, setCatches] = useState<MapCatch[]>([])
  const [friendCatches, setFriendCatches] = useState<MapCatch[]>([])
  const [loading, setLoading] = useState(true)
  const [heatmap, setHeatmap] = useState(false)
  const [mapFilter, setMapFilter] = useState<MapFilter>('mine')
  const [satellite, setSatellite] = useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [filteredIds, setFilteredIds] = useState<string[] | null>(null)
  const allFeaturesRef = useRef<GeoJSON.Feature[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/catches/map').then((r) => r.json()),
      fetch('/api/catches?scope=friends&limit=500').then((r) => r.json()),
    ])
      .then(([myData, friendData]) => {
        setCatches(Array.isArray(myData) ? myData : [])
        setFriendCatches(Array.isArray(friendData) ? friendData : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const updateMapFilter = useCallback((ids: string[] | null) => {
    const map = mapRef.current
    if (!map || !map.getSource('catches')) return

    const source = map.getSource('catches') as mapboxgl.GeoJSONSource
    if (ids === null) {
      source.setData({ type: 'FeatureCollection', features: allFeaturesRef.current })
    } else {
      const idSet = new Set(ids)
      const filtered = allFeaturesRef.current.filter(
        (f) => f.properties && idSet.has(f.properties.id)
      )
      source.setData({ type: 'FeatureCollection', features: filtered })
    }
  }, [])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim() || catches.length === 0) return

    setSearching(true)
    try {
      const searchData = catches.map((c) => ({
        id: c.id,
        species: c.species,
        weight_kg: c.weight_kg,
        length_cm: c.length_cm,
        caught_at: c.caught_at,
        water_body: c.water_body,
        fishing_method: c.fishing_method,
        lure_type: c.lure_type,
        weather_condition: c.weather_condition,
        moon_phase: c.moon_phase,
      }))

      const res = await fetch('/api/catches/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, catches: searchData }),
      })

      if (res.ok) {
        const { matchingIds } = await res.json()
        setFilteredIds(matchingIds)
        updateMapFilter(matchingIds)
      }
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  function clearSearch() {
    setSearchQuery('')
    setFilteredIds(null)
    updateMapFilter(null)
  }

  useEffect(() => {
    if (!mapContainer.current || loading) return

    async function initMap() {
      const mapboxgl = (await import('mapbox-gl')).default
      if (!document.querySelector('link[href*="mapbox-gl"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css'
        document.head.appendChild(link)
      }

      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

      const map = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: [15.5, 62.0],
        zoom: 4,
      })

      mapRef.current = map

      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      map.addControl(
        new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
        'top-right'
      )

      map.on('load', () => {
        // Own catches features
        const features = catches
          .filter((c) => c.exif_lat && c.exif_lng)
          .map((c) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [c.exif_lng!, c.exif_lat!],
            },
            properties: {
              id: c.id,
              species: c.species || 'Okand',
              weight_kg: c.weight_kg || 0,
              caught_at: c.caught_at,
              water_body: c.water_body || '',
            },
          }))

        allFeaturesRef.current = features

        // Friend catches features
        const friendFeatures = friendCatches
          .filter((c) => c.exif_lat && c.exif_lng)
          .map((c) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [c.exif_lng!, c.exif_lat!],
            },
            properties: {
              id: c.id,
              species: c.species || 'Okand',
              weight_kg: c.weight_kg || 0,
              caught_at: c.caught_at,
              water_body: c.water_body || '',
              friend_name: c.profiles?.display_name || c.profiles?.username || 'Van',
            },
          }))

        // Own catches source
        map.addSource('catches', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        })

        // Friend catches source
        map.addSource('friend-catches', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: friendFeatures },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        })

        // Own cluster circles (GREEN)
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'catches',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#16a34a', 10, '#15803d', 30, '#166534'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
        })

        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'catches',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 14,
          },
          paint: { 'text-color': '#fff' },
        })

        // Own individual points (GREEN)
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'catches',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#16a34a',
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
        })

        // Friend cluster circles (BLUE) - hidden by default
        map.addLayer({
          id: 'friend-clusters',
          type: 'circle',
          source: 'friend-catches',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#2563eb', 10, '#1d4ed8', 30, '#1e40af'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
          layout: { visibility: 'none' },
        })

        map.addLayer({
          id: 'friend-cluster-count',
          type: 'symbol',
          source: 'friend-catches',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 14,
            visibility: 'none',
          },
          paint: { 'text-color': '#fff' },
        })

        // Friend individual points (BLUE) - hidden by default
        map.addLayer({
          id: 'friend-unclustered-point',
          type: 'circle',
          source: 'friend-catches',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#2563eb',
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
          layout: { visibility: 'none' },
        })

        // Heatmap layer (hidden by default)
        map.addLayer({
          id: 'catches-heat',
          type: 'heatmap',
          source: 'catches',
          maxzoom: 15,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight_kg'], 0, 0.2, 10, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 15, 15, 30],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(22,163,74,0)',
              0.2, 'rgb(34,197,94)',
              0.4, 'rgb(74,222,128)',
              0.6, 'rgb(251,191,36)',
              0.8, 'rgb(245,158,11)',
              1, 'rgb(239,68,68)',
            ],
          },
          layout: { visibility: 'none' },
        })

        // Click on own cluster to zoom
        map.on('click', 'clusters', (e) => {
          const feats = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
          const clusterId = feats[0].properties!.cluster_id
          const source = map.getSource('catches') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return
            map.easeTo({
              center: (feats[0].geometry as GeoJSON.Point).coordinates as [number, number],
              zoom: zoom!,
            })
          })
        })

        // Click on friend cluster to zoom
        map.on('click', 'friend-clusters', (e) => {
          const feats = map.queryRenderedFeatures(e.point, { layers: ['friend-clusters'] })
          const clusterId = feats[0].properties!.cluster_id
          const source = map.getSource('friend-catches') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return
            map.easeTo({
              center: (feats[0].geometry as GeoJSON.Point).coordinates as [number, number],
              zoom: zoom!,
            })
          })
        })

        // Click on own point
        map.on('click', 'unclustered-point', (e) => {
          const props = e.features![0].properties!
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates.slice() as [number, number]

          const html = `
            <div style="max-width:200px;font-family:system-ui">
              <div style="padding:8px">
                <div style="font-weight:600">${props.species}</div>
                ${props.weight_kg ? `<div style="font-size:13px;color:#64748b">${props.weight_kg} kg</div>` : ''}
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${new Date(props.caught_at).toLocaleDateString('sv')}</div>
                <a href="/fangst/${props.id}" style="display:block;margin-top:6px;font-size:12px;color:#16a34a;text-decoration:none">Visa detaljer &rarr;</a>
              </div>
            </div>
          `

          new mapboxgl.Popup({ offset: 15 }).setLngLat(coords).setHTML(html).addTo(map)
        })

        // Click on friend point
        map.on('click', 'friend-unclustered-point', (e) => {
          const props = e.features![0].properties!
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates.slice() as [number, number]

          const html = `
            <div style="max-width:200px;font-family:system-ui">
              <div style="padding:8px">
                <div style="font-size:11px;color:#2563eb;font-weight:500;margin-bottom:2px">&#x1F464; ${props.friend_name}</div>
                <div style="font-weight:600">${props.species}</div>
                ${props.weight_kg ? `<div style="font-size:13px;color:#64748b">${props.weight_kg} kg</div>` : ''}
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${new Date(props.caught_at).toLocaleDateString('sv')}</div>
              </div>
            </div>
          `

          new mapboxgl.Popup({ offset: 15 }).setLngLat(coords).setHTML(html).addTo(map)
        })

        // Cursors
        const pointerLayers = ['clusters', 'unclustered-point', 'friend-clusters', 'friend-unclustered-point']
        pointerLayers.forEach((layer) => {
          map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
        })

        // Zoom to fit all own catches
        if (features.length > 0) {
          const bounds = new mapboxgl.LngLatBounds()
          features.forEach((f) => bounds.extend(f.geometry.coordinates as [number, number]))
          map.fitBounds(bounds, { padding: 50, maxZoom: 12 })
        }
      })

      return () => map.remove()
    }

    initMap()
  }, [catches, friendCatches, loading])

  function toggleHeatmap() {
    const map = mapRef.current
    if (!map) return
    const next = !heatmap
    setHeatmap(next)
    map.setLayoutProperty('catches-heat', 'visibility', next ? 'visible' : 'none')
    map.setLayoutProperty('clusters', 'visibility', next ? 'none' : 'visible')
    map.setLayoutProperty('cluster-count', 'visibility', next ? 'none' : 'visible')
    map.setLayoutProperty('unclustered-point', 'visibility', next ? 'none' : 'visible')
  }

  function toggleMapFilter() {
    const map = mapRef.current
    if (!map) return
    const next = mapFilter === 'mine' ? 'all' : 'mine'
    setMapFilter(next)
    const showFriends = next === 'all' ? 'visible' : 'none'
    map.setLayoutProperty('friend-clusters', 'visibility', showFriends)
    map.setLayoutProperty('friend-cluster-count', 'visibility', showFriends)
    map.setLayoutProperty('friend-unclustered-point', 'visibility', showFriends)
  }

  function toggleStyle() {
    const map = mapRef.current
    if (!map) return
    const next = !satellite
    setSatellite(next)
    map.setStyle(
      next
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/outdoors-v12'
    )
  }

  const totalWithCoords = catches.filter((c) => c.exif_lat).length
  const shownCount = filteredIds !== null ? filteredIds.length : totalWithCoords

  return (
    <div className="relative h-[calc(100dvh-5rem)]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
        </div>
      )}

      <div ref={mapContainer} className="w-full h-full" />

      {/* Search bar */}
      <div className="absolute top-4 left-14 right-14 z-10">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sok t.ex. 'abborrar pa hosten'"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 shadow-md border border-slate-200 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {searching ? (
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700" />
              </div>
            ) : (
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="px-3 py-2 rounded-lg bg-primary-700 text-white text-sm font-medium shadow-md disabled:opacity-50 hover:bg-primary-800 transition"
          >
            Sok
          </button>
        </form>

        {/* Filter indicator */}
        {filteredIds !== null && (
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 shadow-md text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {shownCount} av {totalWithCoords} fangster
            </span>
            <button
              onClick={clearSearch}
              className="inline-flex items-center px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-medium shadow-md border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50 transition"
            >
              Rensa
            </button>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-6 left-4 flex gap-2 z-10">
        <button
          onClick={toggleStyle}
          className={`px-3 py-2 rounded-lg text-xs font-medium shadow-md transition ${
            satellite
              ? 'bg-indigo-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          {satellite ? '🛰️ Satellit' : '🗺️ Karta'}
        </button>
        <button
          onClick={toggleHeatmap}
          className={`px-3 py-2 rounded-lg text-xs font-medium shadow-md transition ${
            heatmap
              ? 'bg-primary-700 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          {heatmap ? 'Heatmap' : 'Pins'}
        </button>
        <button
          onClick={toggleMapFilter}
          className={`px-3 py-2 rounded-lg text-xs font-medium shadow-md transition ${
            mapFilter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          {mapFilter === 'all' ? 'Alla' : 'Mina'}
        </button>
      </div>

      {/* Legend when showing friends */}
      {mapFilter === 'all' && (
        <div className="absolute bottom-6 right-4 bg-white dark:bg-slate-800 rounded-lg shadow-md px-3 py-2 z-10">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-600 inline-block" /> Mina
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-600 inline-block" /> Vanner
            </span>
          </div>
        </div>
      )}

      {catches.filter((c) => c.exif_lat).length === 0 && !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center shadow-lg pointer-events-auto">
            <div className="text-4xl mb-2">&#x1F5FA;&#xFE0F;</div>
            <h2 className="font-medium mb-1">Inga fangster pa kartan</h2>
            <p className="text-sm text-slate-500">Logga fangster med GPS-position for att se dem har</p>
          </div>
        </div>
      )}
    </div>
  )
}
