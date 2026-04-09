'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

export const SPECIES_OPTIONS = [
  'Abborre', 'Gädda', 'Gös', 'Öring', 'Lax', 'Regnbåge', 'Röding', 'Harr',
  'Sik', 'Lake', 'Ål', 'Braxen', 'Mört', 'Karp', 'Torsk', 'Makrill',
  'Havsöring', 'Flundra', 'Rödspätta', 'Sej', 'Annat'
]

export const METHOD_OPTIONS = ['Kastfiske', 'Trolling', 'Mete', 'Flugfiske', 'Isfiske', 'Pilkfiske', 'Jiggning', 'Annat']
export const LURE_OPTIONS = ['Wobbler', 'Jig', 'Skeddrag', 'Spinner', 'Fluga', 'Mask', 'Räka', 'Annat']
export const BOTTOM_OPTIONS = ['Sand', 'Grus', 'Sten', 'Lera', 'Vegetation', 'Okänd']

export interface CatchFormData {
  catcher_name: string
  catcher_user_id: string | null
  caught_at: string
  species: string
  species_confidence: number
  weight_kg: string
  length_cm: string
  lat: number | null
  lng: number | null
  location_name: string
  water_body: string
  fishing_method: string
  lure_type: string
  lure_color: string
  lure_name: string
  depth_m: string
  bottom_structure: string
  water_temp_c: string
  is_public: boolean
  notes: string
  weather_temp_c: number | null
  weather_condition: string
  wind_speed_ms: number | null
  wind_direction: string
  cloud_cover_pct: number | null
  precipitation_mm: number | null
  pressure_hpa: number | null
  humidity_pct: number | null
  visibility_km: number | null
  moon_phase: string
  moon_illumination_pct: number | null
  sunrise_time: string
  sunset_time: string
  is_golden_hour: boolean | null
  ai_weather_description: string
  ai_fish_description: string
  ai_environment_notes: string
  exif_captured_at: string | null
}

export function getDefaultFormData(): CatchFormData {
  return {
    catcher_name: '',
    catcher_user_id: null,
    caught_at: new Date().toISOString().slice(0, 16),
    species: '',
    species_confidence: 0,
    weight_kg: '',
    length_cm: '',
    lat: null,
    lng: null,
    location_name: '',
    water_body: '',
    fishing_method: '',
    lure_type: '',
    lure_color: '',
    lure_name: '',
    depth_m: '',
    bottom_structure: '',
    water_temp_c: '',
    is_public: false,
    notes: '',
    weather_temp_c: null,
    weather_condition: '',
    wind_speed_ms: null,
    wind_direction: '',
    cloud_cover_pct: null,
    precipitation_mm: null,
    pressure_hpa: null,
    humidity_pct: null,
    visibility_km: null,
    moon_phase: '',
    moon_illumination_pct: null,
    sunrise_time: '',
    sunset_time: '',
    is_golden_hour: null,
    ai_weather_description: '',
    ai_fish_description: '',
    ai_environment_notes: '',
    exif_captured_at: null,
  }
}

interface CatchFormProps {
  initialData: CatchFormData
  onSave: (data: CatchFormData) => Promise<void>
  saving: boolean
  error?: string
  submitLabel?: string
  onCancel?: () => void
}

export default function CatchForm({ initialData, onSave, saving, error, submitLabel = 'Spara fångst', onCancel }: CatchFormProps) {
  const [form, setForm] = useState<CatchFormData>(initialData)
  const [showMapModal, setShowMapModal] = useState(false)
  const [catcherError, setCatcherError] = useState(false)

  function handleSave() {
    if (!form.catcher_name || !form.catcher_name.trim()) {
      setCatcherError(true)
      // Scroll to top where catcher field is
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setCatcherError(false)
    onSave(form)
  }

  // Sync background-loaded fields (geocode, weather, moon) into form state
  // Only applies when parent updates initialData after initial mount (e.g. geocode returns)
  useEffect(() => {
    setForm(prev => {
      const bgFields: (keyof CatchFormData)[] = [
        'water_body', 'location_name',
        'weather_temp_c', 'weather_condition', 'wind_speed_ms', 'wind_direction',
        'cloud_cover_pct', 'precipitation_mm', 'pressure_hpa', 'humidity_pct',
        'visibility_km', 'moon_phase', 'moon_illumination_pct',
        'sunrise_time', 'sunset_time', 'is_golden_hour',
        'ai_weather_description', 'ai_environment_notes',
        'species', 'species_confidence', 'ai_fish_description',
        'catcher_name',
      ]
      const updates: Partial<CatchFormData> = {}
      for (const field of bgFields) {
        const incoming = initialData[field]
        const current = prev[field]
        // Only overwrite if incoming has a value and current is empty/null/zero
        if (incoming && !current) {
          (updates as Record<string, unknown>)[field] = incoming
        }
      }
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialData.water_body, initialData.location_name,
    initialData.weather_condition, initialData.weather_temp_c,
    initialData.moon_phase, initialData.pressure_hpa,
    initialData.species, initialData.ai_fish_description,
  ])

  function updateForm(updates: Partial<CatchFormData>) {
    setForm(prev => ({ ...prev, ...updates }))
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Fångstperson (obligatorisk) */}
      <FieldGroup label="Fångstperson *">
        <AutocompleteInput
          value={form.catcher_name}
          onChange={(val) => { updateForm({ catcher_name: val }); if (val.trim()) setCatcherError(false) }}
          placeholder="Vem fångade fisken?"
          field="catcher_name"
        />
        {catcherError && (
          <p className="text-xs text-red-500 mt-1">Du måste ange vem som fångade fisken</p>
        )}
        {form.catcher_user_id && form.catcher_name && (
          <div className="text-xs text-primary-600 mt-1">Matchad med profil</div>
        )}
      </FieldGroup>

      {/* Datum/tid */}
      <FieldGroup label="Datum & tid">
        <input
          type="datetime-local"
          value={form.caught_at}
          onChange={(e) => updateForm({ caught_at: e.target.value })}
          className="input-field"
        />
      </FieldGroup>

      {/* Art */}
      <FieldGroup label={`Art ${form.species_confidence > 0 ? `(AI: ${Math.round(form.species_confidence * 100)}% säker)` : ''}`}>
        <select
          value={form.species}
          onChange={(e) => updateForm({ species: e.target.value })}
          className="input-field"
        >
          <option value="">Välj art...</option>
          {SPECIES_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </FieldGroup>

      {/* Vikt & Längd */}
      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label="Vikt (kg)">
          <input
            type="number"
            step="0.01"
            value={form.weight_kg}
            onChange={(e) => updateForm({ weight_kg: e.target.value })}
            placeholder="0.00"
            className="input-field"
          />
        </FieldGroup>
        <FieldGroup label="Längd (cm)">
          <input
            type="number"
            step="1"
            value={form.length_cm}
            onChange={(e) => updateForm({ length_cm: e.target.value })}
            placeholder="0"
            className="input-field"
          />
        </FieldGroup>
      </div>

      {/* Plats */}
      <FieldGroup label="Sjönamn / Vatten">
        <div className="flex gap-2">
          <input
            type="text"
            value={form.water_body}
            onChange={(e) => updateForm({ water_body: e.target.value })}
            placeholder="T.ex. Vättern, Storån..."
            className="input-field flex-1"
          />
          <button
            type="button"
            onClick={() => setShowMapModal(true)}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            title="Välj plats på karta"
          >
            <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="Region / Län">
        <input
          type="text"
          value={form.location_name}
          onChange={(e) => updateForm({ location_name: e.target.value })}
          placeholder="T.ex. Dalarna, Stockholms län..."
          className="input-field"
        />
      </FieldGroup>

      {form.lat && form.lng && (
        <div className="text-xs text-slate-500">
          GPS: {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
        </div>
      )}

      {/* Kartmodal — interaktiv */}
      {showMapModal && (
        <LocationPickerModal
          lat={form.lat}
          lng={form.lng}
          onClose={() => setShowMapModal(false)}
          onConfirm={(lat, lng, waterBody, locationName) => {
            updateForm({ lat, lng, water_body: waterBody || form.water_body, location_name: locationName || form.location_name })
            setShowMapModal(false)
          }}
        />
      )}

      {/* Metod */}
      <FieldGroup label="Fiskemetod">
        <select
          value={form.fishing_method}
          onChange={(e) => updateForm({ fishing_method: e.target.value })}
          className="input-field"
        >
          <option value="">Välj metod...</option>
          {METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </FieldGroup>

      {/* Bete */}
      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label="Betetyp">
          <select
            value={form.lure_type}
            onChange={(e) => updateForm({ lure_type: e.target.value })}
            className="input-field"
          >
            <option value="">Välj...</option>
            {LURE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Betefärg">
          <input
            type="text"
            value={form.lure_color}
            onChange={(e) => updateForm({ lure_color: e.target.value })}
            placeholder="T.ex. Silver"
            className="input-field"
          />
        </FieldGroup>
      </div>

      <FieldGroup label="Bete (fritext)">
        <AutocompleteInput
          value={form.lure_name}
          onChange={(val) => updateForm({ lure_name: val })}
          placeholder="T.ex. Toby 18g, Rapala X-Rap 10cm..."
          field="lure_name"
        />
      </FieldGroup>

      {/* Djup & Botten */}
      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label="Djup (m)">
          <input
            type="number"
            step="0.5"
            value={form.depth_m}
            onChange={(e) => updateForm({ depth_m: e.target.value })}
            placeholder="0"
            className="input-field"
          />
        </FieldGroup>
        <FieldGroup label="Botten">
          <select
            value={form.bottom_structure}
            onChange={(e) => updateForm({ bottom_structure: e.target.value })}
            className="input-field"
          >
            <option value="">Välj...</option>
            {BOTTOM_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </FieldGroup>
      </div>

      {/* Vattentemperatur */}
      <FieldGroup label="Vattentemperatur (°C)">
        <input
          type="number"
          step="0.5"
          value={form.water_temp_c}
          onChange={(e) => updateForm({ water_temp_c: e.target.value })}
          placeholder="0"
          className="input-field"
        />
      </FieldGroup>

      {/* Väderinfo (auto) */}
      {form.weather_condition && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 space-y-1">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">Väder (automatiskt)</h3>
          <div className="text-xs text-blue-700 dark:text-blue-300 grid grid-cols-2 gap-1">
            {form.weather_temp_c !== null && <span>Temp: {form.weather_temp_c}°C</span>}
            <span>Väder: {form.weather_condition}</span>
            {form.wind_speed_ms !== null && <span>Vind: {form.wind_speed_ms} m/s {form.wind_direction}</span>}
            {form.moon_phase && <span>Måne: {form.moon_phase}</span>}
            {form.sunrise_time && <span>Soluppgång: {form.sunrise_time}</span>}
            {form.sunset_time && <span>Solnedgång: {form.sunset_time}</span>}
            {form.is_golden_hour && <span className="text-amber-600 font-medium">Gyllene timmen!</span>}
          </div>
        </div>
      )}

      {/* Anteckningar */}
      <FieldGroup label="Anteckningar">
        <textarea
          value={form.notes}
          onChange={(e) => updateForm({ notes: e.target.value })}
          placeholder="Fritext..."
          rows={3}
          className="input-field resize-none"
        />
      </FieldGroup>

      <div className="flex gap-3 mt-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 font-medium text-sm hover:bg-slate-50 transition"
          >
            Avbryt
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`${onCancel ? 'flex-1' : 'w-full'} py-3.5 px-4 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 disabled:opacity-50 transition`}
        >
          {saving ? 'Sparar...' : submitLabel}
        </button>
      </div>

      <style jsx global>{`
        .input-field {
          width: 100%;
          padding: 0.625rem 0.875rem;
          border-radius: 0.75rem;
          border: 1px solid #e2e8f0;
          background: white;
          font-size: 0.875rem;
          outline: none;
          transition: all 0.15s;
        }
        .input-field:focus {
          border-color: #27272a;
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08);
        }
        .dark .input-field {
          background: #1e293b;
          border-color: #334155;
          color: #f8fafc;
        }
      `}</style>
    </div>
  )
}

function LocationPickerModal({ lat, lng, onClose, onConfirm }: {
  lat: number | null
  lng: number | null
  onClose: () => void
  onConfirm: (lat: number, lng: number, waterBody?: string, locationName?: string) => void
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const [pickedLat, setPickedLat] = useState(lat ?? 62.0)
  const [pickedLng, setPickedLng] = useState(lng ?? 15.0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [geocoding, setGeocoding] = useState(false)

  const defaultCenter: [number, number] = [lng ?? 15.0, lat ?? 62.0]
  const defaultZoom = lat && lng ? 12 : 4

  useEffect(() => {
    if (!mapContainer.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: defaultCenter,
      zoom: defaultZoom,
    })

    const marker = new mapboxgl.Marker({ draggable: true, color: '#000000' })
      .setLngLat(defaultCenter)
      .addTo(map)

    marker.on('dragend', () => {
      const pos = marker.getLngLat()
      setPickedLat(pos.lat)
      setPickedLng(pos.lng)
    })

    map.on('click', (e) => {
      marker.setLngLat(e.lngLat)
      setPickedLat(e.lngLat.lat)
      setPickedLng(e.lngLat.lng)
    })

    mapRef.current = map
    markerRef.current = marker

    return () => { map.remove() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch() {
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    try {
      const res = await fetch(`/api/geocode-search?q=${encodeURIComponent(searchQuery.trim())}`)
      if (res.ok) {
        const data = await res.json()
        if (data.lat && data.lng) {
          setPickedLat(data.lat)
          setPickedLng(data.lng)
          markerRef.current?.setLngLat([data.lng, data.lat])
          mapRef.current?.flyTo({ center: [data.lng, data.lat], zoom: 12 })
        }
      }
    } catch { /* ignore */ }
    setSearching(false)
  }

  async function handleConfirm() {
    setGeocoding(true)
    let waterBody = ''
    let locationName = ''
    try {
      const res = await fetch(`/api/geocode?lat=${pickedLat}&lng=${pickedLng}`)
      if (res.ok) {
        const data = await res.json()
        waterBody = data.water_body || ''
        locationName = data.location_name || ''
      }
    } catch { /* ignore */ }
    setGeocoding(false)
    onConfirm(pickedLat, pickedLng, waterBody, locationName)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl overflow-hidden w-full max-w-md shadow-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-sm">Välj plats</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Sök plats..."
              className="input-field flex-1"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching}
              className="shrink-0 px-3 py-2 rounded-xl bg-primary-700 text-white text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition"
            >
              {searching ? '...' : 'Sök'}
            </button>
          </div>
        </div>

        {/* Map */}
        <div ref={mapContainer} className="w-full flex-1" style={{ minHeight: 200 }} />

        {/* Footer */}
        <div className="p-4 space-y-2 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 text-center">
            Tryck på kartan eller dra markören för att flytta platsen
          </p>
          <div className="text-xs text-slate-400 text-center">
            {pickedLat.toFixed(5)}, {pickedLng.toFixed(5)}
          </div>
          <button
            onClick={handleConfirm}
            disabled={geocoding}
            className="w-full py-2.5 bg-primary-700 text-white rounded-xl font-medium text-sm hover:bg-primary-800 disabled:opacity-50 transition"
          >
            {geocoding ? 'Hämtar platsnamn...' : 'Bekräfta plats'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
      {children}
    </div>
  )
}

function AutocompleteInput({ value, onChange, placeholder, field }: {
  value: string
  onChange: (val: string) => void
  placeholder: string
  field: string
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [filtered, setFiltered] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch suggestions once on mount
  useEffect(() => {
    fetch(`/api/autocomplete?field=${field}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setSuggestions(data))
      .catch(() => {})
  }, [field])

  // Filter as user types
  const handleChange = useCallback((text: string) => {
    onChange(text)
    if (text.length > 0 && suggestions.length > 0) {
      const lower = text.toLowerCase()
      const matches = suggestions.filter(s =>
        s.toLowerCase().includes(lower) && s.toLowerCase() !== lower
      )
      setFiltered(matches)
      setShowDropdown(matches.length > 0)
      setHighlightIndex(-1)
    } else {
      setShowDropdown(false)
    }
  }, [onChange, suggestions])

  const selectSuggestion = useCallback((s: string) => {
    onChange(s)
    setShowDropdown(false)
    setHighlightIndex(-1)
    inputRef.current?.blur()
  }, [onChange])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex(prev => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      selectSuggestion(filtered[highlightIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }, [showDropdown, highlightIndex, filtered, selectSuggestion])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          if (value.length > 0 && filtered.length > 0) setShowDropdown(true)
          else if (value.length === 0 && suggestions.length > 0) {
            setFiltered(suggestions.slice(0, 8))
            setShowDropdown(true)
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="input-field"
        autoComplete="off"
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {filtered.slice(0, 8).map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s) }}
              className={`w-full text-left px-3 py-2 text-sm transition ${
                i === highlightIndex
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
