'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { extractExif } from '@/lib/exif'
import CatchForm, { getDefaultFormData, type CatchFormData } from '@/components/catches/CatchForm'
import type { ImageAnalysis } from '@/types/database'

export default function AddCatchPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'image' | 'form'>('image')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState<CatchFormData>(getDefaultFormData())
  const [analysisResult, setAnalysisResult] = useState<ImageAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const [backgroundLoading, setBackgroundLoading] = useState(false)

  async function handleImageSelect(file: File) {
    setImageFile(file)
    const url = URL.createObjectURL(file)
    setImagePreview(url)
    setError('')
    setAnalysisError('')
    setAnalysisResult(null)

    const updates: Partial<CatchFormData> = {}

    // Step 1: Extract EXIF (fast, local)
    try {
      const exif = await extractExif(file)
      if (exif.captured_at) {
        const d = new Date(exif.captured_at)
        updates.caught_at = d.toISOString().slice(0, 16)
        updates.exif_captured_at = d.toISOString()
      }
      if (exif.lat && exif.lng) {
        updates.lat = exif.lat
        updates.lng = exif.lng
      }
    } catch {}

    // Step 2: Try browser geolocation if no EXIF GPS
    if (!updates.lat) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 })
        )
        updates.lat = pos.coords.latitude
        updates.lng = pos.coords.longitude
      } catch {}
    }

    // Show the form immediately with what we have
    setFormData(prev => ({ ...prev, ...updates }))
    setStep('form')

    // Step 3: Fetch geocode + weather + moon + sun in background (non-blocking)
    const lat = updates.lat
    const lng = updates.lng
    const dateParam = updates.exif_captured_at || new Date().toISOString()

    if (lat && lng) {
      setBackgroundLoading(true)
      Promise.allSettled([
        fetch(`/api/geocode?lat=${lat}&lng=${lng}`),
        fetch(`/api/weather?lat=${lat}&lng=${lng}&date=${dateParam}`),
        fetch(`/api/moon?date=${dateParam}`),
        fetch(`/api/sun?lat=${lat}&lng=${lng}&date=${dateParam}`),
      ]).then(async ([geocodeRes, weatherRes, moonRes, sunRes]) => {
        const bgUpdates: Partial<CatchFormData> = {}

        if (geocodeRes.status === 'fulfilled' && geocodeRes.value.ok) {
          const g = await geocodeRes.value.json()
          if (g.water_body) bgUpdates.water_body = g.water_body
          if (g.location_name) bgUpdates.location_name = g.location_name
        }
        if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
          Object.assign(bgUpdates, await weatherRes.value.json())
        }
        if (moonRes.status === 'fulfilled' && moonRes.value.ok) {
          Object.assign(bgUpdates, await moonRes.value.json())
        }
        if (sunRes.status === 'fulfilled' && sunRes.value.ok) {
          Object.assign(bgUpdates, await sunRes.value.json())
        }

        // Only update fields the user hasn't touched yet
        setFormData(prev => ({
          ...prev,
          water_body: prev.water_body || bgUpdates.water_body || '',
          location_name: prev.location_name || bgUpdates.location_name || '',
          ...Object.fromEntries(
            Object.entries(bgUpdates).filter(([k]) =>
              !['water_body', 'location_name'].includes(k)
            )
          ),
        }))
      }).finally(() => setBackgroundLoading(false))
    }
  }

  async function handleAnalyzeImage() {
    if (!imageFile) return
    setAnalyzing(true)
    setAnalysisError('')

    try {
      const base64 = await fileToBase64(imageFile)
      const mimeType = imageFile.type || 'image/jpeg'

      const res = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })

      if (res.ok) {
        const analysis: ImageAnalysis = await res.json()
        setAnalysisResult(analysis)
        setFormData(prev => ({
          ...prev,
          species: analysis.species || prev.species,
          species_confidence: analysis.species_confidence || 0,
          ai_fish_description: analysis.fish_description || '',
          ai_weather_description: analysis.weather_description || '',
          ai_environment_notes: analysis.environment_notes || '',
          weather_condition: prev.weather_condition || analysis.weather_condition || '',
          // Auto-fill catcher from person visible in photo
          catcher_name: prev.catcher_name || (analysis.person_visible ? (analysis.person_description || '') : ''),
        }))
      } else {
        const errBody = await res.json().catch(() => ({}))
        setAnalysisError(errBody.error || 'AI-analysen misslyckades. Försök igen.')
      }
    } catch {
      setAnalysisError('Kunde inte nå AI-tjänsten.')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSave(data: CatchFormData) {
    setSaving(true)
    setError('')

    try {
      let imageUrl = null
      let imagePath = null

      if (imageFile) {
        const fd = new FormData()
        fd.append('file', imageFile)
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd })
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
          ...data,
          weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
          length_cm: data.length_cm ? parseFloat(data.length_cm) : null,
          depth_m: data.depth_m ? parseFloat(data.depth_m) : null,
          water_temp_c: data.water_temp_c ? parseFloat(data.water_temp_c as string) : null,
          image_url: imageUrl,
          image_path: imagePath,
        }),
      })

      if (!res.ok) throw new Error('Save failed')

      router.push('/')
      router.refresh()
    } catch {
      setError('Kunde inte spara fångsten. Försök igen.')
    } finally {
      setSaving(false)
    }
  }

  function skipImage() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setFormData(prev => ({ ...prev, lat: pos.coords.latitude, lng: pos.coords.longitude })),
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

      {imagePreview && (
        <div className="mb-4 rounded-2xl overflow-hidden aspect-[4/3] relative">
          <img src={imagePreview} alt="Fångst" className="w-full h-full object-cover" />
        </div>
      )}

      {/* AI Analyze button */}
      {imageFile && (
        <div className="mb-4">
          {analysisResult ? (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-green-700 dark:text-green-300 font-medium text-sm">AI-analys klar</span>
                {analysisResult.species_confidence > 0 && (
                  <span className="text-xs text-green-600 dark:text-green-400">
                    {Math.round(analysisResult.species_confidence * 100)}% säker
                  </span>
                )}
              </div>
              {analysisResult.fish_description && (
                <p className="text-xs text-green-700 dark:text-green-300">{analysisResult.fish_description}</p>
              )}
            </div>
          ) : (
            <button
              onClick={handleAnalyzeImage}
              disabled={analyzing}
              className="w-full py-3 px-4 rounded-2xl border-2 border-dashed border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition disabled:opacity-50"
            >
              {analyzing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700" />
                  Analyserar med AI...
                </>
              ) : (
                <>
                  <SparkleIcon />
                  Analysera bild med AI
                </>
              )}
            </button>
          )}

          {analysisError && (
            <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-xl text-xs flex items-center justify-between">
              <span>{analysisError}</span>
              <button onClick={handleAnalyzeImage} className="font-medium underline ml-2 shrink-0">
                Försök igen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Background loading indicator */}
      {backgroundLoading && (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-400">
          <div className="animate-spin rounded-full h-3 w-3 border-b border-slate-400" />
          Hämtar plats och väder...
        </div>
      )}

      <CatchForm
        initialData={formData}
        onSave={handleSave}
        saving={saving}
        error={error}
        submitLabel="Spara fångst"
      />
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

function SparkleIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
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
