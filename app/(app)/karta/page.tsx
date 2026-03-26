'use client'

import { useEffect, useRef, useState } from 'react'
import type { CatchWithProfile } from '@/types/database'

export default function KartaPage() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [catches, setCatches] = useState<CatchWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [heatmap, setHeatmap] = useState(false)

  useEffect(() => {
    fetch('/api/catches?limit=500')
      .then((r) => r.json())
      .then((data) => {
        setCatches(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!mapContainer.current || loading) return

    async function initMap() {
      const mapboxgl = (await import('mapbox-gl')).default
      // CSS imported via head link instead of dynamic import
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
        center: [15.5, 62.0], // Sweden center
        zoom: 4,
      })

      mapRef.current = map

      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      map.addControl(
        new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
        'top-right'
      )

      map.on('load', () => {
        // Create GeoJSON from catches
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
              species: c.species || 'Okänd',
              weight_kg: c.weight_kg || 0,
              caught_at: c.caught_at,
              image_url: c.image_url || '',
              water_body: c.water_body || '',
            },
          }))

        map.addSource('catches', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        })

        // Cluster circles
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'catches',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#0f766e', 10, '#0d9488', 30, '#14b8a6'],
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
        })

        // Cluster count labels
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

        // Individual points
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'catches',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#0f766e',
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
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
              0, 'rgba(15,118,110,0)',
              0.2, 'rgb(20,184,166)',
              0.4, 'rgb(45,212,191)',
              0.6, 'rgb(251,191,36)',
              0.8, 'rgb(245,158,11)',
              1, 'rgb(239,68,68)',
            ],
          },
          layout: { visibility: 'none' },
        })

        // Click on cluster to zoom
        map.on('click', 'clusters', (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
          const clusterId = features[0].properties!.cluster_id
          const source = map.getSource('catches') as mapboxgl.GeoJSONSource
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return
            map.easeTo({
              center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
              zoom: zoom!,
            })
          })
        })

        // Click on point to show popup
        map.on('click', 'unclustered-point', (e) => {
          const props = e.features![0].properties!
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates.slice() as [number, number]

          const html = `
            <div style="max-width:200px;font-family:system-ui">
              ${props.image_url ? `<img src="${props.image_url}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px 8px 0 0" />` : ''}
              <div style="padding:8px">
                <div style="font-weight:600">${props.species} 🐟</div>
                ${props.weight_kg ? `<div style="font-size:13px;color:#64748b">${props.weight_kg} kg</div>` : ''}
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${new Date(props.caught_at).toLocaleDateString('sv')}</div>
                <a href="/fangst/${props.id}" style="display:block;margin-top:6px;font-size:12px;color:#0f766e;text-decoration:none">Visa detaljer →</a>
              </div>
            </div>
          `

          new mapboxgl.Popup({ offset: 15 }).setLngLat(coords).setHTML(html).addTo(map)
        })

        // Cursors
        map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })
        map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = '' })

        // Zoom to fit all catches
        if (features.length > 0) {
          const bounds = new mapboxgl.LngLatBounds()
          features.forEach((f) => bounds.extend(f.geometry.coordinates as [number, number]))
          map.fitBounds(bounds, { padding: 50, maxZoom: 12 })
        }
      })

      return () => map.remove()
    }

    initMap()
  }, [catches, loading])

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

  return (
    <div className="relative h-[calc(100dvh-5rem)]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
        </div>
      )}

      <div ref={mapContainer} className="w-full h-full" />

      {/* Heatmap toggle */}
      <button
        onClick={toggleHeatmap}
        className={`absolute top-4 left-4 px-3 py-2 rounded-lg text-xs font-medium shadow-md transition z-10 ${
          heatmap
            ? 'bg-primary-700 text-white'
            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
        }`}
      >
        {heatmap ? '🔥 Heatmap' : '📍 Pins'}
      </button>

      {catches.filter((c) => c.exif_lat).length === 0 && !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center shadow-lg pointer-events-auto">
            <div className="text-4xl mb-2">🗺️</div>
            <h2 className="font-medium mb-1">Inga fångster på kartan</h2>
            <p className="text-sm text-slate-500">Logga fångster med GPS-position för att se dem här</p>
          </div>
        </div>
      )}
    </div>
  )
}
