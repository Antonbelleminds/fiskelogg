'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getCache, setCache } from '@/lib/cache'
import { useDecryptCatches } from '@/lib/useDecryptCatches'
import { usePin } from '@/contexts/PinContext'

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
  location_encrypted?: boolean
  encrypted_location?: string | null
  encryption_iv?: string | null
  profiles?: { username: string; display_name: string | null; avatar_url: string | null } | null
}

interface SonarSurvey {
  id: string
  name: string
  point_count: number
  min_depth_m: number | null
  max_depth_m: number | null
  bounds: {
    type: 'Polygon'
    coordinates: number[][][]
  } | null
  focus?: {
    type: 'Point'
    coordinates: [number, number]
  } | null
}

interface SonarInspection {
  found: boolean
  depthM: number | null
  minDepthM: number | null
  maxDepthM: number | null
  slopeDeg: number | null
  bottomHardness: number | null
  vegetationHeightM: number | null
  vendorChannelA: number | null
  vendorChannelB: number | null
  waterTempC: number | null
  boatSpeedMs: number | null
  headingDeg: number | null
  catchCount: number
  avgWeightKg: number | null
  maxWeightKg: number | null
  nearestCatchM: number | null
  bottomClassification: string
}

type MapFilter = 'mine' | 'all'
type SonarLayerMode = 'depth' | 'hardness' | 'vegetation'

const mapsWithInteractionHandlers = new WeakSet<object>()

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function fitLargestSonarSurvey(
  map: mapboxgl.Map,
  surveys: SonarSurvey[]
) {
  const focus = surveys.find(
    (survey) =>
      survey.focus?.type === 'Point' &&
      survey.focus.coordinates.length === 2
  )?.focus
  if (focus) {
    map.easeTo({
      center: focus.coordinates,
      zoom: 14,
      duration: 900,
    })
    return
  }

  const survey = surveys
    .filter((candidate) => (candidate.bounds?.coordinates?.[0]?.length ?? 0) > 0)
    .sort((a, b) => b.point_count - a.point_count)[0]
  const coordinates = survey?.bounds?.coordinates?.[0] ?? []
  if (coordinates.length === 0) return

  const west = Math.min(...coordinates.map((coordinate) => coordinate[0]))
  const east = Math.max(...coordinates.map((coordinate) => coordinate[0]))
  const south = Math.min(...coordinates.map((coordinate) => coordinate[1]))
  const north = Math.max(...coordinates.map((coordinate) => coordinate[1]))
  map.fitBounds(
    [[west, south], [east, north]],
    { padding: 48, maxZoom: 14 }
  )
}

export default function KartaPage() {
  const router = useRouter()
  const { hasPinSet, isUnlocked, unlock } = usePin()
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [catches, setCatches] = useState<MapCatch[]>([])
  const [friendCatches, setFriendCatches] = useState<MapCatch[]>([])
  const [loading, setLoading] = useState(true)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsLoaded, setFriendsLoaded] = useState(false)
  const [heatmap, setHeatmap] = useState(false)
  const [mapFilter, setMapFilter] = useState<MapFilter>('mine')
  const [satellite, setSatellite] = useState(false)
  const [depthMap, setDepthMap] = useState(false)
  const [sonarLayerMode, setSonarLayerMode] =
    useState<SonarLayerMode>('depth')
  const [showSonarContours, setShowSonarContours] = useState(true)
  const [showSonarHillshade, setShowSonarHillshade] = useState(true)
  const [showSonarTracks, setShowSonarTracks] = useState(false)
  const [sonarPanelMinimized, setSonarPanelMinimized] = useState(false)
  const [surveys, setSurveys] = useState<SonarSurvey[]>([])
  const [mapGeneration, setMapGeneration] = useState(0)
  const [mapPin, setMapPin] = useState('')
  const [mapPinError, setMapPinError] = useState('')

  // Refs to track current visibility state (needed after style reload)
  const heatmapRef = useRef(false)
  const depthMapRef = useRef(false)
  const sonarLayerModeRef = useRef<SonarLayerMode>('depth')
  const sonarContoursRef = useRef(true)
  const sonarHillshadeRef = useRef(true)
  const sonarTracksRef = useRef(false)
  const mapFilterRef = useRef<MapFilter>('mine')
  const shouldAutoFocusSonarRef = useRef(false)
  const requestedCatchIdRef = useRef<string | null>(null)
  const allFeaturesRef = useRef<GeoJSON.Feature[]>([])
  const friendFeaturesRef = useRef<GeoJSON.Feature[]>([])

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [filteredIds, setFilteredIds] = useState<string[] | null>(null)

  // Load own catches on mount (cached)
  useEffect(() => {
    const cached = getCache<MapCatch[]>('map-catches')
    if (cached) {
      setCatches(cached)
      setLoading(false)
      return
    }
    fetch('/api/catches/map')
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : []
        setCatches(arr)
        setCache('map-catches', arr)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    requestedCatchIdRef.current = searchParams.get('fangst')

    if (searchParams.get('djupkarta') === '1') {
      setDepthMap(true)
      depthMapRef.current = true
      shouldAutoFocusSonarRef.current = !requestedCatchIdRef.current
    }

    fetch('/api/sonar/surveys')
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setSurveys(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Decrypt encrypted catches when PIN is unlocked
  const decryptStatus = useDecryptCatches(catches, setCatches)

  // Lazy-load friend catches only when "Alla" filter is selected
  useEffect(() => {
    if (mapFilter !== 'all' || friendsLoaded || friendsLoading) return
    const cached = getCache<MapCatch[]>('map-friend-catches')
    if (cached) {
      setFriendCatches(cached)
      setFriendsLoaded(true)
      return
    }
    setFriendsLoading(true)
    fetch('/api/catches?scope=friends&limit=500')
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : []
        setFriendCatches(arr)
        setFriendsLoaded(true)
        setCache('map-friend-catches', arr)
      })
      .catch(() => {})
      .finally(() => setFriendsLoading(false))
  }, [mapFilter, friendsLoaded, friendsLoading])

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

  const syncSonarLayerVisibility = useCallback((map: mapboxgl.Map) => {
    const active = depthMapRef.current
    const mode = sonarLayerModeRef.current
    const setVisibility = (layerId: string, visible: boolean) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          'visibility',
          visible ? 'visible' : 'none'
        )
      }
    }

    setVisibility('sonar-depth-fill', active && mode === 'depth')
    setVisibility('sonar-hardness-fill', active && mode === 'hardness')
    setVisibility('sonar-vegetation-fill', active && mode === 'vegetation')
    setVisibility(
      'sonar-hillshade',
      active && sonarHillshadeRef.current
    )
    for (const layerId of [
      'sonar-contours-minor',
      'sonar-contours-major',
      'sonar-contour-labels',
    ]) {
      setVisibility(layerId, active && sonarContoursRef.current)
    }
    setVisibility('sonar-waypoints', active)
    setVisibility(
      'sonar-tracks',
      active && sonarTracksRef.current
    )
  }, [])

  useEffect(() => {
    if (!mapContainer.current || loading) return

    let disposed = false
    let initializedMap: mapboxgl.Map | null = null

    async function initMap() {
      const mapboxgl = (await import('mapbox-gl')).default
      if (disposed || !mapContainer.current) return

      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

      const map = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: [15.5, 62.0],
        zoom: 4,
      })

      initializedMap = map
      mapRef.current = map

      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      map.addControl(
        new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
        'top-right'
      )

      // Build features
      const features = catches
        .filter((c) => c.exif_lat && c.exif_lng)
        .map((c) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [c.exif_lng!, c.exif_lat!] },
          properties: {
            id: c.id,
            species: c.species || 'Okänd',
            weight_kg: c.weight_kg || 0,
            length_cm: c.length_cm || 0,
            caught_at: c.caught_at,
            water_body: c.water_body || '',
          },
        }))

      const friendFeatures = friendCatches
        .filter((c) => c.exif_lat && c.exif_lng)
        .map((c) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [c.exif_lng!, c.exif_lat!] },
          properties: {
            id: c.id,
            species: c.species || 'Okänd',
            weight_kg: c.weight_kg || 0,
            length_cm: c.length_cm || 0,
            caught_at: c.caught_at,
            water_body: c.water_body || '',
            friend_name: c.profiles?.display_name || c.profiles?.username || 'Vän',
          },
        }))

      allFeaturesRef.current = features
      friendFeaturesRef.current = friendFeatures

      // Extracted function to add all sources and layers
      function addSourcesAndLayers() {
        // Remove existing sources/layers if they exist (safety)
        const layerIds = [
          'sonar-depth-fill', 'sonar-hardness-fill',
          'sonar-vegetation-fill', 'sonar-hillshade',
          'sonar-contours-minor', 'sonar-contours-major',
          'sonar-contour-labels',
          'sonar-tracks', 'sonar-waypoints',
          'clusters', 'cluster-count', 'unclustered-point', 'catch-hit-area',
          'friend-clusters', 'friend-cluster-count', 'friend-unclustered-point',
          'friend-catch-hit-area',
          'catches-heat',
        ]
        layerIds.forEach((id) => {
          if (map.getLayer(id)) map.removeLayer(id)
        })
        if (map.getSource('catches')) map.removeSource('catches')
        if (map.getSource('friend-catches')) map.removeSource('friend-catches')
        if (map.getSource('sonar-depth')) map.removeSource('sonar-depth')
        if (map.getSource('sonar-signals')) map.removeSource('sonar-signals')

        const showDepth = depthMapRef.current
        const sonarMode = sonarLayerModeRef.current
        const showTracks = showDepth && sonarTracksRef.current

        map.addSource('sonar-depth', {
          type: 'vector',
          tiles: [`${window.location.origin}/api/sonar/tiles/{z}/{x}/{y}?surface=3`],
          minzoom: 0,
          maxzoom: 18,
        })

        map.addSource('sonar-signals', {
          type: 'vector',
          tiles: [
            `${window.location.origin}/api/sonar/tiles/{z}/{x}/{y}?surface=signals`,
          ],
          minzoom: 0,
          maxzoom: 18,
        })

        map.addLayer({
          id: 'sonar-depth-fill',
          type: 'fill',
          source: 'sonar-depth',
          'source-layer': 'depth_cells',
          paint: {
            'fill-color': [
              'interpolate',
              ['linear'],
              ['to-number', ['get', 'depth'], 0],
              0, '#ef4444',
              1, '#f97316',
              2, '#facc15',
              3.5, '#84cc16',
              5, '#22c55e',
              7.5, '#14b8a6',
              10, '#38bdf8',
              15, '#2563eb',
              25, '#1e3a8a',
              40, '#0f172a',
            ],
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['to-number', ['get', 'confidence'], 1],
              0, 0.2,
              0.35, 0.55,
              0.7, 0.78,
              1, 0.92,
            ],
            'fill-antialias': false,
            'fill-outline-color': 'rgba(0,0,0,0)',
          },
          layout: {
            visibility:
              showDepth && sonarMode === 'depth' ? 'visible' : 'none',
          },
        })

        map.addLayer({
          id: 'sonar-hardness-fill',
          type: 'fill',
          source: 'sonar-signals',
          'source-layer': 'signals',
          filter: [
            '>=',
            ['to-number', ['get', 'hardness_signal'], -1],
            0,
          ],
          paint: {
            'fill-color': [
              'interpolate',
              ['linear'],
              ['to-number', ['get', 'hardness_signal'], 0],
              0, '#f8fafc',
              2.5, '#d6d3d1',
              4.5, '#fde68a',
              6.5, '#fbbf24',
              9.7, '#f97316',
              18.2, '#7c2d12',
              30, '#1c1917',
            ],
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['to-number', ['get', 'samples'], 1],
              1, 0.55,
              8, 0.76,
              30, 0.9,
            ],
            'fill-antialias': false,
            'fill-outline-color': 'rgba(255,255,255,0.12)',
          },
          layout: {
            visibility:
              showDepth && sonarMode === 'hardness' ? 'visible' : 'none',
          },
        })

        map.addLayer({
          id: 'sonar-vegetation-fill',
          type: 'fill',
          source: 'sonar-signals',
          'source-layer': 'signals',
          filter: [
            '>=',
            ['to-number', ['get', 'vegetation_signal'], -1],
            0,
          ],
          paint: {
            'fill-color': [
              'interpolate',
              ['linear'],
              ['to-number', ['get', 'vegetation_signal'], 0],
              0, '#ecfccb',
              0.15, '#d9f99d',
              0.5, '#a3e635',
              1, '#4ade80',
              1.7, '#16a34a',
              5, '#14532d',
              10, '#052e16',
            ],
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['to-number', ['get', 'vegetation_signal'], 0],
              0, 0.18,
              0.15, 0.34,
              0.5, 0.56,
              1.7, 0.76,
              5, 0.92,
            ],
            'fill-antialias': false,
            'fill-outline-color': 'rgba(255,255,255,0.1)',
          },
          layout: {
            visibility:
              showDepth && sonarMode === 'vegetation' ? 'visible' : 'none',
          },
        })

        map.addLayer({
          id: 'sonar-hillshade',
          type: 'fill',
          source: 'sonar-depth',
          'source-layer': 'depth_cells',
          paint: {
            'fill-color': '#020617',
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'hillshade'], 1],
              0, 0.32,
              0.5, 0.12,
              1, 0,
            ],
          },
          layout: {
            visibility:
              showDepth && sonarHillshadeRef.current ? 'visible' : 'none',
          },
        })

        map.addLayer({
          id: 'sonar-contours-minor',
          type: 'line',
          source: 'sonar-depth',
          'source-layer': 'contours',
          minzoom: 10,
          filter: [
            '!=',
            [
              '%',
              [
                'round',
                ['*', ['to-number', ['get', 'depth'], 0], 2],
              ],
              5,
            ],
            0,
          ],
          paint: {
            'line-color': 'rgba(15,23,42,0.64)',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 0.2,
              13, 0.55,
              17, 1,
            ],
            'line-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 0.28,
              12, 0.52,
              15, 0.72,
            ],
          },
          layout: {
            visibility:
              showDepth && sonarContoursRef.current ? 'visible' : 'none',
            'line-cap': 'round',
            'line-join': 'round',
          },
        })

        map.addLayer({
          id: 'sonar-contours-major',
          type: 'line',
          source: 'sonar-depth',
          'source-layer': 'contours',
          minzoom: 9,
          filter: [
            '==',
            [
              '%',
              [
                'round',
                ['*', ['to-number', ['get', 'depth'], 0], 2],
              ],
              5,
            ],
            0,
          ],
          paint: {
            'line-color': 'rgba(2,6,23,0.82)',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              9, 0.5,
              13, 1,
              17, 1.8,
            ],
            'line-opacity': 0.86,
          },
          layout: {
            visibility:
              showDepth && sonarContoursRef.current ? 'visible' : 'none',
            'line-cap': 'round',
            'line-join': 'round',
          },
        })

        map.addLayer({
          id: 'sonar-contour-labels',
          type: 'symbol',
          source: 'sonar-depth',
          'source-layer': 'contours',
          minzoom: 12,
          filter: [
            '==',
            [
              '%',
              [
                'round',
                ['*', ['to-number', ['get', 'depth'], 0], 2],
              ],
              5,
            ],
            0,
          ],
          layout: {
            visibility:
              showDepth && sonarContoursRef.current ? 'visible' : 'none',
            'symbol-placement': 'line',
            'symbol-spacing': 220,
            'text-field': [
              'concat',
              [
                'number-format',
                ['to-number', ['get', 'depth'], 0],
                {
                  'min-fraction-digits': 0,
                  'max-fraction-digits': 1,
                },
              ],
              ' m',
            ],
            'text-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              12, 9,
              16, 11,
            ],
            'text-max-angle': 35,
            'text-padding': 3,
          },
          paint: {
            'text-color': '#0f172a',
            'text-halo-color': 'rgba(255,255,255,0.92)',
            'text-halo-width': 1.5,
            'text-halo-blur': 0.5,
          },
        })

        map.addLayer({
          id: 'sonar-tracks',
          type: 'line',
          source: 'sonar-depth',
          'source-layer': 'tracks',
          paint: {
            'line-color': '#f59e0b',
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 16, 1.8],
            'line-opacity': 0.62,
          },
          layout: { visibility: showTracks ? 'visible' : 'none' },
        })

        map.addLayer({
          id: 'sonar-waypoints',
          type: 'circle',
          source: 'sonar-depth',
          'source-layer': 'waypoints',
          paint: {
            'circle-color': '#f59e0b',
            'circle-radius': 5,
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
          },
          layout: { visibility: showDepth ? 'visible' : 'none' },
        })
        syncSonarLayerVisibility(map)

        // Own catches source
        map.addSource('catches', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: allFeaturesRef.current },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        })

        // Friend catches source
        map.addSource('friend-catches', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: friendFeaturesRef.current },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        })

        const showHeat = heatmapRef.current
        const showFriends = mapFilterRef.current === 'all'

        // Own cluster circles (BLACK)
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'catches',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#27272a', 10, '#18181b', 30, '#09090b'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
          layout: { visibility: showHeat ? 'none' : 'visible' },
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
            visibility: showHeat ? 'none' : 'visible',
          },
          paint: { 'text-color': '#fff' },
        })

        // Own individual points (BLACK)
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'catches',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#27272a',
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
          layout: { visibility: showHeat ? 'none' : 'visible' },
        })

        // Larger transparent touch target so sonar cells do not win taps near a catch.
        map.addLayer({
          id: 'catch-hit-area',
          type: 'circle',
          source: 'catches',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#000',
            'circle-radius': 20,
            'circle-opacity': 0.001,
          },
          layout: { visibility: showHeat ? 'none' : 'visible' },
        })

        // Friend cluster circles (BLUE)
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
          layout: { visibility: showFriends ? 'visible' : 'none' },
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
            visibility: showFriends ? 'visible' : 'none',
          },
          paint: { 'text-color': '#fff' },
        })

        // Friend individual points (BLUE)
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
          layout: { visibility: showFriends ? 'visible' : 'none' },
        })

        map.addLayer({
          id: 'friend-catch-hit-area',
          type: 'circle',
          source: 'friend-catches',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#000',
            'circle-radius': 20,
            'circle-opacity': 0.001,
          },
          layout: { visibility: showFriends ? 'visible' : 'none' },
        })

        // Heatmap layer
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
          layout: { visibility: showHeat ? 'visible' : 'none' },
        })

        if (mapsWithInteractionHandlers.has(map)) return
        mapsWithInteractionHandlers.add(map)

        // Click on own cluster to zoom
        map.on('click', 'clusters', (e) => {
          const feats = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
          const clusterId = feats[0].properties!.cluster_id
          const source = map.getSource('catches') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return
            map.easeTo({ center: (feats[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom! })
          })
        })

        // Click on friend cluster to zoom
        map.on('click', 'friend-clusters', (e) => {
          const feats = map.queryRenderedFeatures(e.point, { layers: ['friend-clusters'] })
          const clusterId = feats[0].properties!.cluster_id
          const source = map.getSource('friend-catches') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return
            map.easeTo({ center: (feats[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom! })
          })
        })

        // Click on own point
        map.on('click', 'catch-hit-area', (e) => {
          const props = e.features![0].properties!
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates.slice() as [number, number]
          const details = [
            props.weight_kg ? `${props.weight_kg} kg` : '',
            props.length_cm ? `${props.length_cm} cm` : '',
          ].filter(Boolean).join(' · ')
          const html = `
            <div style="max-width:200px;font-family:system-ui">
              <div style="padding:8px">
                <div style="font-weight:600">${escapeHtml(props.species)}</div>
                ${details ? `<div style="font-size:13px;color:#64748b">${details}</div>` : ''}
                ${props.water_body ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${escapeHtml(props.water_body)}</div>` : ''}
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${new Date(props.caught_at).toLocaleDateString('sv')}</div>
                <a href="/fangst/${encodeURIComponent(props.id)}" data-catch-details style="display:block;margin-top:6px;font-size:12px;color:#27272a;text-decoration:none;font-weight:500">Visa detaljer &rarr;</a>
              </div>
            </div>
          `
          const popup = new mapboxgl.Popup({ offset: 15 })
            .setLngLat(coords)
            .setHTML(html)
            .addTo(map)
          popup
            .getElement()
            ?.querySelector<HTMLAnchorElement>('[data-catch-details]')
            ?.addEventListener('click', (event) => {
              event.preventDefault()
              popup.remove()
              router.push(`/fangst/${encodeURIComponent(props.id)}`)
            }, { once: true })
        })

        // Click on friend point
        map.on('click', 'friend-catch-hit-area', (e) => {
          const props = e.features![0].properties!
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates.slice() as [number, number]
          const details = [
            props.weight_kg ? `${props.weight_kg} kg` : '',
            props.length_cm ? `${props.length_cm} cm` : '',
          ].filter(Boolean).join(' · ')
          const html = `
            <div style="max-width:200px;font-family:system-ui">
              <div style="padding:8px">
                <div style="font-size:11px;color:#64748b;font-weight:500;margin-bottom:2px">${escapeHtml(props.friend_name)}</div>
                <div style="font-weight:600">${escapeHtml(props.species)}</div>
                ${details ? `<div style="font-size:13px;color:#64748b">${details}</div>` : ''}
                ${props.water_body ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${escapeHtml(props.water_body)}</div>` : ''}
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${new Date(props.caught_at).toLocaleDateString('sv')}</div>
              </div>
            </div>
          `
          new mapboxgl.Popup({ offset: 15 }).setLngLat(coords).setHTML(html).addTo(map)
        })

        const inspectSonarPoint = async (e: mapboxgl.MapLayerMouseEvent) => {
          if (!depthMapRef.current) return
          const catchLayers = [
            'catch-hit-area',
            'friend-catch-hit-area',
            'clusters',
            'friend-clusters',
          ].filter((layerId) => Boolean(map.getLayer(layerId)))
          if (
            catchLayers.length > 0 &&
            map.queryRenderedFeatures(e.point, { layers: catchLayers }).length > 0
          ) {
            return
          }
          const { lng, lat } = e.lngLat
          const popup = new mapboxgl.Popup({ offset: 12 })
            .setLngLat([lng, lat])
            .setHTML('<div style="padding:8px;font-family:system-ui">Analyserar…</div>')
            .addTo(map)

          try {
            const response = await fetch(
              `/api/sonar/inspect?lon=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`
            )
            if (!response.ok) throw new Error('Inspect failed')
            const info = (await response.json()) as SonarInspection
            if (!info.found) {
              popup.setHTML('<div style="padding:8px;font-family:system-ui">Ingen mätning inom 100 meter.</div>')
              return
            }

            const row = (label: string, value: string) =>
              `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:5px"><span style="color:#64748b">${label}</span><strong>${value}</strong></div>`
            const optionalRows = [
              info.waterTempC != null ? row('Vattentemperatur', `${info.waterTempC.toFixed(1)} °C`) : '',
              info.boatSpeedMs != null ? row('Båtfart', `${info.boatSpeedMs.toFixed(1)} m/s`) : '',
              info.nearestCatchM != null ? row('Närmaste fångst', `${Math.round(info.nearestCatchM)} m`) : '',
              info.avgWeightKg != null ? row('Medelvikt', `${info.avgWeightKg.toFixed(1)} kg`) : '',
              info.maxWeightKg != null ? row('Största fisk', `${info.maxWeightKg.toFixed(1)} kg`) : '',
            ].join('')
            const selectedSignalRow =
              sonarLayerModeRef.current === 'hardness' &&
              info.vendorChannelA != null
                ? row('Bottenrespons β', info.vendorChannelA.toFixed(1))
                : sonarLayerModeRef.current === 'vegetation' &&
                    info.vendorChannelB != null
                  ? row('Vegetationssignal β', info.vendorChannelB.toFixed(1))
                  : ''
            const betaNote =
              sonarLayerModeRef.current === 'hardness' ||
              sonarLayerModeRef.current === 'vegetation'
                ? '<div style="margin-top:8px;color:#64748b;font-size:11px;line-height:1.35">Relativ Humminbird-signal. Högre värde betyder starkare respons; exakt skala kalibreras mot kända platser.</div>'
                : ''

            popup.setHTML(`
              <div style="min-width:210px;padding:8px;font-family:system-ui;font-size:13px">
                <div style="font-weight:700;font-size:14px;margin-bottom:8px">Egen djupkarta</div>
                ${row('Djup', info.depthM != null ? `${info.depthM.toFixed(1)} m` : '–')}
                ${row('Botten', escapeHtml(info.bottomClassification || 'Ej klassificerad'))}
                ${row('Lutning', info.slopeDeg != null ? `${Math.round(info.slopeDeg)}°` : '–')}
                ${selectedSignalRow}
                ${row('Fångster här', String(info.catchCount ?? 0))}
                ${optionalRows}
                ${betaNote}
              </div>
            `)
          } catch {
            popup.setHTML('<div style="padding:8px;font-family:system-ui">Kunde inte läsa punktinformationen.</div>')
          }
        }

        for (const layerId of [
          'sonar-depth-fill',
          'sonar-hardness-fill',
          'sonar-vegetation-fill',
        ]) {
          map.on('click', layerId, inspectSonarPoint)
        }

        // Cursors
        const pointerLayers = [
          'sonar-depth-fill',
          'sonar-hardness-fill',
          'sonar-vegetation-fill',
          'clusters',
          'catch-hit-area',
          'friend-clusters',
          'friend-catch-hit-area',
        ]
        pointerLayers.forEach((layer) => {
          map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
        })
      }

      map.on('load', () => {
        addSourcesAndLayers()

        // Store addSourcesAndLayers on the map instance for style reloads
        ;(map as any)._addSourcesAndLayers = addSourcesAndLayers

        const requestedCatch = requestedCatchIdRef.current
          ? features.find(
              (feature) =>
                feature.properties?.id === requestedCatchIdRef.current
            )
          : null

        if (requestedCatch) {
          map.easeTo({
            center: requestedCatch.geometry.coordinates as [number, number],
            zoom: 16,
            duration: 0,
          })
          requestedCatchIdRef.current = null
        } else if (!requestedCatchIdRef.current && features.length > 0) {
          // Normal map entry: zoom to fit all own catches.
          const bounds = new mapboxgl.LngLatBounds()
          features.forEach((f) => bounds.extend(f.geometry.coordinates as [number, number]))
          map.fitBounds(bounds, { padding: 50, maxZoom: 12 })
        }
        setMapGeneration((generation) => generation + 1)
      })

    }

    void initMap()
    return () => {
      disposed = true
      initializedMap?.remove()
      if (mapRef.current === initializedMap) mapRef.current = null
    }
  }, [catches, friendCatches, loading, router, syncSonarLayerVisibility])

  useEffect(() => {
    const map = mapRef.current
    if (
      !map ||
      !depthMap ||
      surveys.length === 0 ||
      !shouldAutoFocusSonarRef.current
    ) {
      return
    }
    shouldAutoFocusSonarRef.current = false
    fitLargestSonarSurvey(map, surveys)
  }, [depthMap, surveys, mapGeneration])

  function toggleHeatmap() {
    const map = mapRef.current
    if (!map) return
    const next = !heatmap
    setHeatmap(next)
    heatmapRef.current = next
    const visibilityByLayer: Record<string, 'visible' | 'none'> = {
      'catches-heat': next ? 'visible' : 'none',
      clusters: next ? 'none' : 'visible',
      'cluster-count': next ? 'none' : 'visible',
      'unclustered-point': next ? 'none' : 'visible',
      'catch-hit-area': next ? 'none' : 'visible',
    }
    Object.entries(visibilityByLayer).forEach(([layer, visibility]) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', visibility)
      }
    })
  }

  function toggleMapFilter() {
    const map = mapRef.current
    if (!map) return
    const next = mapFilter === 'mine' ? 'all' : 'mine'
    setMapFilter(next)
    mapFilterRef.current = next
    const showFriends = next === 'all' ? 'visible' : 'none'
    for (const layer of [
      'friend-clusters',
      'friend-cluster-count',
      'friend-unclustered-point',
      'friend-catch-hit-area',
    ]) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', showFriends)
      }
    }
  }

  function toggleStyle() {
    const map = mapRef.current
    if (!map) return
    const next = !satellite
    setSatellite(next)

    // Re-add all sources/layers after style loads
    map.once('style.load', () => {
      const addFn = (map as any)._addSourcesAndLayers
      if (addFn) addFn()
    })

    map.setStyle(
      next
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/outdoors-v12'
    )
  }

  function toggleDepthMap() {
    const map = mapRef.current
    if (!map) return
    shouldAutoFocusSonarRef.current = false
    const next = !depthMap
    setDepthMap(next)
    depthMapRef.current = next
    syncSonarLayerVisibility(map)
  }

  function selectSonarLayer(mode: SonarLayerMode) {
    setSonarLayerMode(mode)
    sonarLayerModeRef.current = mode
    const map = mapRef.current
    if (map) syncSonarLayerVisibility(map)
  }

  function toggleSonarContours() {
    const next = !showSonarContours
    setShowSonarContours(next)
    sonarContoursRef.current = next
    const map = mapRef.current
    if (map) syncSonarLayerVisibility(map)
  }

  function toggleSonarHillshade() {
    const next = !showSonarHillshade
    setShowSonarHillshade(next)
    sonarHillshadeRef.current = next
    const map = mapRef.current
    if (map) syncSonarLayerVisibility(map)
  }

  function toggleSonarTracks() {
    const next = !showSonarTracks
    setShowSonarTracks(next)
    sonarTracksRef.current = next
    const map = mapRef.current
    if (map) syncSonarLayerVisibility(map)
  }

  function focusOwnCatches() {
    const map = mapRef.current
    if (!map || allFeaturesRef.current.length === 0) return
    const coordinates = allFeaturesRef.current.flatMap(feature =>
      feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates as [number, number]]
        : []
    )
    if (coordinates.length === 0) return
    const longitudes = coordinates.map(coordinate => coordinate[0])
    const latitudes = coordinates.map(coordinate => coordinate[1])
    map.fitBounds(
      [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ],
      { padding: 50, maxZoom: 12 }
    )
  }

  const totalWithCoords = catches.filter(
    caught => caught.exif_lat != null && caught.exif_lng != null
  ).length
  const shownCount = filteredIds !== null ? filteredIds.length : totalWithCoords
  const lockedCatchCount = catches.filter(
    (caught) =>
      caught.location_encrypted &&
      caught.encrypted_location &&
      caught.encryption_iv &&
      (caught.exif_lat == null || caught.exif_lng == null)
  ).length

  async function handleMapPinSubmit(event: React.FormEvent) {
    event.preventDefault()
    setMapPinError('')
    const unlocked = await unlock(mapPin)
    if (!unlocked) {
      setMapPin('')
      setMapPinError('Fel fiskepin. Försök igen.')
    }
  }

  return (
    <div className="relative h-[calc(100dvh-8.75rem)]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
        </div>
      )}

      <div ref={mapContainer} className="w-full h-full" />

      {/* Search bar */}
      <div className="absolute top-3 left-14 right-14 z-10">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sök t.ex. 'abborre på hösten'"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 shadow-md border border-slate-200 dark:border-slate-700 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {searching ? (
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700" />
              </div>
            ) : (
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="px-3 py-2 rounded-lg bg-primary-700 text-white text-sm font-medium shadow-md disabled:opacity-50 hover:bg-primary-800 transition"
          >
            Sök
          </button>
        </form>

        {filteredIds !== null && (
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 shadow-md text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {shownCount} av {totalWithCoords} fångster
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

      {depthMap && surveys.length > 0 && (
        <div className={`absolute left-3 top-16 z-10 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200/80 bg-white/95 p-2.5 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 ${
          sonarPanelMinimized ? 'w-40' : 'w-52'
        }`}>
          <div className={`flex items-center justify-between gap-2 ${
            sonarPanelMinimized ? '' : 'mb-1.5'
          }`}>
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Sjökarta
              </div>
              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                AutoChart
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!sonarPanelMinimized && (
                <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[8px] font-semibold text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
                  {surveys.length} mätningar
                </span>
              )}
              <button
                type="button"
                onClick={() => setSonarPanelMinimized((minimized) => !minimized)}
                aria-label={
                  sonarPanelMinimized
                    ? 'Visa sjökartans kontroller'
                    : 'Minimera sjökartan'
                }
                aria-expanded={!sonarPanelMinimized}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${
                    sonarPanelMinimized ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 15 6-6 6 6" />
                </svg>
              </button>
            </div>
          </div>

          {!sonarPanelMinimized && (
            <>
              <div
                role="tablist"
                aria-label="Sjökartslager"
                className="grid grid-cols-3 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
              >
                {([
                  ['depth', 'Djup'],
                  ['hardness', 'Hård β'],
                  ['vegetation', 'Växt β'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={sonarLayerMode === mode}
                    onClick={() => selectSonarLayer(mode)}
                    className={`rounded-md px-1 py-1 text-[9px] font-semibold transition ${
                      sonarLayerMode === mode
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[9px] font-medium text-slate-600 dark:text-slate-300">
              <span>
                {sonarLayerMode === 'depth'
                  ? 'Djup'
                  : sonarLayerMode === 'hardness'
                    ? 'Hårdhet'
                    : 'Vegetation'}
              </span>
              <span>
                {sonarLayerMode === 'depth' ? 'meter' : 'beta'}
              </span>
            </div>
            <div
              className="h-2.5 rounded-full ring-1 ring-black/5"
              style={{
                background:
                  sonarLayerMode === 'depth'
                    ? 'linear-gradient(90deg, #ef4444 0%, #f97316 8%, #facc15 18%, #84cc16 30%, #22c55e 42%, #14b8a6 56%, #38bdf8 70%, #2563eb 84%, #1e3a8a 100%)'
                    : sonarLayerMode === 'hardness'
                      ? 'linear-gradient(90deg, #f8fafc 0%, #d6d3d1 18%, #fde68a 35%, #fbbf24 50%, #f97316 68%, #7c2d12 86%, #1c1917 100%)'
                      : 'linear-gradient(90deg, #ecfccb 0%, #d9f99d 18%, #a3e635 38%, #4ade80 56%, #16a34a 76%, #14532d 92%, #052e16 100%)',
              }}
            />
            <div className="mt-1 flex justify-between text-[9px] text-slate-500 dark:text-slate-400">
              {sonarLayerMode === 'depth' ? (
                <>
                  <span>0</span>
                  <span>2</span>
                  <span>5</span>
                  <span>10</span>
                  <span>20+</span>
                </>
              ) : (
                <>
                  <span>Låg</span>
                  <span>Medel</span>
                  <span>Hög</span>
                </>
              )}
            </div>
          </div>

              {sonarLayerMode !== 'depth' && (
                <p className="mt-1.5 text-[8px] leading-3 text-slate-500 dark:text-slate-400">
                  Relativ ACU-signal (beta).
                </p>
              )}

              <div className="mt-2 grid grid-cols-3 gap-1 border-t border-slate-200 pt-1.5 dark:border-slate-700">
            <button
              type="button"
              aria-pressed={showSonarContours}
              onClick={toggleSonarContours}
              className={`rounded-md px-1 py-1 text-[8px] font-semibold transition ${
                showSonarContours
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              Kurvor
            </button>
            <button
              type="button"
              aria-pressed={showSonarHillshade}
              onClick={toggleSonarHillshade}
              className={`rounded-md px-1 py-1 text-[8px] font-semibold transition ${
                showSonarHillshade
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              Terräng
            </button>
            <button
              type="button"
              aria-pressed={showSonarTracks}
              onClick={toggleSonarTracks}
              className={`rounded-md px-1 py-1 text-[8px] font-semibold transition ${
                showSonarTracks
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              Spår
            </button>
          </div>
            </>
          )}
        </div>
      )}

      {isUnlocked && decryptStatus.isDecrypting && (
        <div className="absolute right-4 top-24 z-10 rounded-lg bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-md dark:bg-slate-800/95 dark:text-slate-200">
          Låser upp fångstplatser…
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute bottom-6 left-4 right-4 flex flex-wrap gap-2 z-10">
        <button
          onClick={toggleDepthMap}
          disabled={surveys.length === 0}
          className={`px-3 py-2 rounded-lg text-xs font-medium shadow-md transition disabled:opacity-40 ${
            depthMap
              ? 'bg-cyan-800 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          Djupkarta
        </button>
        <button
          onClick={toggleStyle}
          className={`px-3 py-2 rounded-lg text-xs font-medium shadow-md transition ${
            satellite
              ? 'bg-slate-800 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          {satellite ? 'Satellit' : 'Karta'}
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
              ? 'bg-slate-800 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          {mapFilter === 'all' ? 'Alla' : 'Mina'}
        </button>
        {totalWithCoords > 0 && (
          <button
            onClick={focusOwnCatches}
            className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-md transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Fångster ({totalWithCoords})
          </button>
        )}
      </div>

      {/* Legend when showing friends */}
      {mapFilter === 'all' && (
        <div className="absolute bottom-6 right-4 bg-white dark:bg-slate-800 rounded-lg shadow-md px-3 py-2 z-10">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-slate-800 dark:bg-slate-200 inline-block" /> Mina
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-600 inline-block" /> Vänner
            </span>
          </div>
        </div>
      )}

      {lockedCatchCount > 0 && hasPinSet && !isUnlocked && !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-lg pointer-events-auto dark:bg-slate-800">
            <div className="mb-2 flex justify-center text-slate-400">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 0 0-9 0v3.75m-.75 0h10.5A2.25 2.25 0 0 1 19.5 12.75v6A2.25 2.25 0 0 1 17.25 21H6.75A2.25 2.25 0 0 1 4.5 18.75v-6a2.25 2.25 0 0 1 2.25-2.25Z" />
              </svg>
            </div>
            <h2 className="font-medium">Fångstplatserna är låsta</h2>
            <p className="mt-1 text-sm text-slate-500">
              {lockedCatchCount} fångster har PIN-krypterade positioner. Lås upp dem för att visa kartnålarna.
            </p>
            <form onSubmit={handleMapPinSubmit} className="mt-4 space-y-2">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mapPin}
                onChange={(event) =>
                  setMapPin(event.target.value.replace(/\D/g, ''))
                }
                placeholder="Fiskepin"
                aria-label="Fiskepin"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-center text-lg tracking-[0.35em] focus:outline-none focus:ring-2 focus:ring-primary-700 dark:border-slate-700 dark:bg-slate-900"
              />
              {mapPinError && (
                <p className="text-sm text-red-500">{mapPinError}</p>
              )}
              <button
                type="submit"
                disabled={mapPin.length < 4}
                className="w-full rounded-xl bg-primary-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Lås upp fångster
              </button>
            </form>
          </div>
        </div>
      )}

      {isUnlocked &&
        !decryptStatus.isDecrypting &&
        decryptStatus.failedCount > 0 &&
        totalWithCoords === 0 &&
        !loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-4 pointer-events-none">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-lg pointer-events-auto dark:bg-slate-800">
            <h2 className="font-medium">Fångstplatserna kunde inte låsas upp</h2>
            <p className="mt-2 text-sm text-slate-500">
              PIN-koden verifierades, men Fiskepins säkerhetsmetadata matchar
              inte metadata som användes när platserna krypterades. Dina
              fångster är kvar och har inte ändrats.
            </p>
          </div>
        </div>
      )}

      {totalWithCoords === 0 &&
        lockedCatchCount === 0 &&
        surveys.length === 0 &&
        !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center shadow-lg pointer-events-auto">
            <div className="mb-2 flex justify-center text-slate-300">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" /></svg>
        </div>
            <h2 className="font-medium mb-1">Inga fångster på kartan</h2>
            <p className="text-sm text-slate-500">Logga fångster med GPS-position för att se dem här</p>
          </div>
        </div>
      )}
    </div>
  )
}
