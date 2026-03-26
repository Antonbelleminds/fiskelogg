'use client'

import { useState, useEffect } from 'react'

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

      {form.ai_fish_description && (
        <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-3 text-sm">
          <span className="font-medium">AI-analys:</span> {form.ai_fish_description}
        </div>
      )}

      {/* Fångstperson */}
      <FieldGroup label="Fångstperson">
        <input
          type="text"
          value={form.catcher_name}
          onChange={(e) => updateForm({ catcher_name: e.target.value })}
          placeholder="Ditt namn (standard: du)"
          className="input-field"
        />
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
        <input
          type="text"
          value={form.water_body}
          onChange={(e) => updateForm({ water_body: e.target.value })}
          placeholder="T.ex. Vättern, Storån..."
          className="input-field"
        />
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
          onClick={() => onSave(form)}
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
          border-color: #0f766e;
          box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15);
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

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
      {children}
    </div>
  )
}
