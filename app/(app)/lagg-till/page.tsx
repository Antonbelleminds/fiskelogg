'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { extractExif } from '@/lib/exif'
import type { ImageAnalysis } from '@/types/database'

const SPECIES_OPTIONS = [
  'Abborre', 'Gädda', 'Gös', 'Öring', 'Lax', 'Regnbåge', 'Röding', 'Harr',
  'Sik', 'Lake', 'Ål', 'Braxen', 'Mört', 'Karp', 'Torsk', 'Makrill',
  'Havsöring', 'Flundra', 'Rödspätta', 'Sej', 'Annat'
]

const METHOD_OPTIONS = ['Kastfiske', 'Trolling', 'Mete', 'Flugfiske', 'Isfiske', 'Pilkfiske', 'Jiggning', 'Annat']
const LURE_OPTIONS = ['Wobbler', 'Jig', 'Skeddrag', 'Spinner', 'Fluga', 'Mask', 'Räka', 'Annat']
const BOTTOM_OPTIONS = ['Sand', 'Grus', 'Sten', 'Lera', 'Vegetation', 'Okänd']

export default function AddCatchPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'image' | 'form'>('image')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form data
  const [form, setForm] = useState({
    caught_at: new Date().toISOString().slice(0, 16),
    species: '',
    species_confidence: 0,
    weight_kg: '',
    length_cm: '',
    lat: null as number | null,
    lng: null as number | null,
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
    // Auto-filled
    weather_temp_c: null as number | null,
    weather_condition: '',
    wind_speed_ms: null as number | null,
    wind_direction: '',
    cloud_cover_pct: null as number | null,
    precipitation_mm: null as number | null,
    pressure_hpa: null as number | null,
    humidity_pct: null as number | null,
    visibility_km: null as number | null,
    moon_phase: '',
    moon_illumination_pct: null as number | null,
    sunrise_time: '',
    sunset_time: '',
    is_golden_hour: null as boolean | null,
    ai_weather_description: '',
    ai_fish_description: '',
    ai_environment_notes: '',
    exif_captured_at: null as string | null,
  })

  function updateForm(updates: Partial<typeof form>) {
    setForm(prev => ({ ...prev, ...updates }))
  }

  async function handleImageSelect(file: File) {
    setImageFile(file)
    const url = URL.createObjectURL(file)
    setImagePreview(url)
    setAnalyzing(true)
    setError('')

    try {
      // Extract EXIF
      const exif = await extractExif(file)
      const updates: Partial<typeof form> = {}

      if (exif.captured_at) {
        const d = new Date(exif.captured_at)
        updates.caught_at = d.toISOString().slice(0, 16)
        updates.exif_captured_at = d.toISOString()
      }
      if (exif.lat && exif.lng) {
        updates.lat = exif.lat
        updates.lng = exif.lng
      }

      // If no GPS from EXIF, try browser geolocation
      if (!updates.lat) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          )
          updates.lat = pos.coords.latitude
          updates.lng = pos.coords.longitude
        } catch {}
      }

      updateForm(updates)

      // AI analysis
      const base64 = await fileToBase64(file)
      const mimeType = file.type || 'image/jpeg'

      const analysisRes = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })

      if (analysisRes.ok) {
        const analysis: ImageAnalysis = await analysisRes.json()
        updateForm({
          ...updates,
          species: analysis.species || '',
          species_confidence: analysis.species_confidence || 0,
          ai_fish_description: analysis.fish_description || '',
          ai_weather_description: analysis.weather_description || '',
          ai_environment_notes: analysis.environment_notes || '',
          weather_condition: analysis.weather_condition || '',
        })
      }

      // Fetch weather, moon, sun data in parallel
      const dateParam = updates.exif_captured_at || new Date().toISOString()
      const lat = updates.lat || form.lat
      const lng = updates.lng || form.lng

      if (lat && lng) {
        const [weatherRes, moonRes, sunRes] = await Promise.allSettled([
          fetch(`/api/weather?lat=${lat}&lng=${lng}&date=${dateParam}`),
          fetch(`/api/moon?date=${dateParam}`),
          fetch(`/api/sun?lat=${lat}&lng=${lng}&date=${dateParam}`),
        ])

        const weatherUpdates: Partial<typeof form> = {}

        if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
          const w = await weatherRes.value.json()
          Object.assign(weatherUpdates, w)
        }
        if (moonRes.status === 'fulfilled' && moonRes.value.ok) {
          const m = await moonRes.value.json()
          Object.assign(weatherUpdates, m)
        }
        if (sunRes.status === 'fulfilled' && sunRes.value.ok) {
          const s = await sunRes.value.json()
          Object.assign(weatherUpdates, s)
        }

        updateForm(weatherUpdates)
      }
    } catch (err) {
      console.error('Analysis error:', err)
    } finally {
      setAnalyzing(false)
      setStep('form')
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    try {
      let imageUrl = null
      let imagePath = null

      if (imageFile) {
        const formData = new FormData()
        formData.append('file', imageFile)
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
        if (uploadRes.ok) {
          const upload = await uploadRes.json()
          imageUrl = upload.url
          imagePath = upload.path
        }
      }

      const res = await fetch('/api/catches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
          length_cm: form.length_cm ? parseFloat(form.length_cm) : null,
          depth_m: form.depth_m ? parseFloat(form.depth_m) : null,
          water_temp_c: form.water_temp_c ? parseFloat(form.water_temp_c) : null,
          image_url: imageUrl,
          image_path: imagePath,
        }),
      })

      if (!res.ok) throw new Error('Save failed')

      router.push('/loggbok')
      router.refresh()
    } catch {
      setError('Kunde inte spara fångsten. Försök igen.')
    } finally {
      setSaving(false)
    }
  }

  function skipImage() {
    // Try geolocation
    navigator.geolocation.getCurrentPosition(
      (pos) => updateForm({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    )
    setStep('form')
  }

  if (step === 'image') {
    return (
      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-6">Lägg till fångst</h1>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImageSelect(file)
          }}
        />

        <div className="space-y-3">
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.capture = 'environment'
                fileInputRef.current.click()
              }
            }}
            className="w-full py-4 px-6 bg-primary-700 text-white rounded-2xl font-medium flex items-center justify-center gap-3 hover:bg-primary-800 active:scale-[0.98] transition"
          >
            <CameraIcon />
            Ta foto
          </button>

          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture')
                fileInputRef.current.click()
              }
            }}
            className="w-full py-4 px-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-medium flex items-center justify-center gap-3 hover:bg-slate-50 active:scale-[0.98] transition"
          >
            <GalleryIcon />
            Välj från album
          </button>

          <button
            onClick={skipImage}
            className="w-full py-4 px-6 text-slate-500 rounded-2xl font-medium hover:bg-slate-100 active:scale-[0.98] transition"
          >
            Skippa bild
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Lägg till fångst</h1>

      {analyzing && (
        <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-2xl p-4 mb-4 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-700" />
          <span className="text-sm text-primary-800 dark:text-primary-200">Analyserar bild med AI...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
          {error}
        </div>
      )}

      {imagePreview && (
        <div className="mb-4 rounded-2xl overflow-hidden aspect-[4/3]">
          <img src={imagePreview} alt="Fångst" className="w-full h-full object-cover" />
        </div>
      )}

      {form.ai_fish_description && (
        <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-3 mb-4 text-sm">
          <span className="font-medium">AI-analys:</span> {form.ai_fish_description}
        </div>
      )}

      <div className="space-y-4">
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
        <FieldGroup label="Plats / Sjönamn">
          <input
            type="text"
            value={form.water_body}
            onChange={(e) => updateForm({ water_body: e.target.value })}
            placeholder="T.ex. Vättern, Mälaren..."
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

        {/* Publik toggle */}
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium">Visa i socialt flöde</span>
          <button
            type="button"
            onClick={() => updateForm({ is_public: !form.is_public })}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              form.is_public ? 'bg-primary-700' : 'bg-slate-300'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
              form.is_public ? 'translate-x-5' : ''
            }`} />
          </button>
        </div>

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

        <button
          onClick={handleSave}
          disabled={saving || analyzing}
          className="w-full py-3.5 px-4 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 disabled:opacity-50 transition mt-2"
        >
          {saving ? 'Sparar...' : 'Spara fångst'}
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

function CameraIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
    </svg>
  )
}

function GalleryIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
    </svg>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
