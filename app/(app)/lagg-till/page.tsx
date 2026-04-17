'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { extractExif } from '@/lib/exif'
import CatchForm, { getDefaultFormData, SPECIES_OPTIONS, type CatchFormData } from '@/components/catches/CatchForm'
import { ImageCropPositioner } from '@/components/catches/ImageCropPositioner'
import type { ImageAnalysis } from '@/types/database'
import { invalidateCache } from '@/lib/cache'
import { usePin } from '@/contexts/PinContext'
import { computeImageHash } from '@/lib/imageHash'
import { computeSolunar } from '@/lib/solunar'

export default function AddCatchPage() {
  const router = useRouter()
  const { hasPinSet, isUnlocked, encrypt } = usePin()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'image' | 'form'>('image')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imagePosition, setImagePosition] = useState<string>('50% 50%')
  const [imageHash, setImageHash] = useState<string | null>(null)
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; species: string | null; caught_at: string } | null>(null)
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
    setDuplicateOf(null)
    setImageHash(null)

    // Hash original file and check for duplicates (fire-and-forget; result blocks save)
    computeImageHash(file).then(async (hash) => {
      setImageHash(hash)
      try {
        const res = await fetch('/api/catches/check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hash }),
        })
        if (res.ok) {
          const body = await res.json()
          if (body.duplicate && body.catch) setDuplicateOf(body.catch)
        }
      } catch {}
    }).catch(() => {})

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

        // Match AI species to dropdown options (case-insensitive)
        let matchedSpecies = ''
        if (analysis.species) {
          const aiSpecies = analysis.species.trim().toLowerCase()
          matchedSpecies = SPECIES_OPTIONS.find(
            s => s.toLowerCase() === aiSpecies
          ) || analysis.species // Keep AI value even if not in list
        }

        setFormData(prev => ({
          ...prev,
          species: matchedSpecies || prev.species,
          species_confidence: analysis.species_confidence || 0,
          ai_fish_description: analysis.fish_description || '',
          ai_weather_description: analysis.weather_description || '',
          ai_environment_notes: analysis.environment_notes || '',
          weather_condition: prev.weather_condition || analysis.weather_condition || '',
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

    if (duplicateOf) {
      setError('Den här bilden är redan uppladdad.')
      setSaving(false)
      return
    }

    try {
      let imageUrl = null
      let imagePath = null

      if (imageFile) {
        const compressed = await compressForUpload(imageFile)
        const fd = new FormData()
        fd.append('file', compressed, 'photo.jpg')
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd })
        if (uploadRes.ok) {
          const upload = await uploadRes.json()
          imageUrl = upload.url
          imagePath = upload.path
        }
      }

      // Encrypt location if fiskepin is active
      let encryptionFields: Record<string, unknown> = {}
      if (hasPinSet && isUnlocked && data.lat) {
        const encrypted = await encrypt({
          exif_lat: data.lat, exif_lng: data.lng,
          location_name: data.location_name || null,
          water_body: data.water_body || null,
        })
        if (encrypted) {
          encryptionFields = {
            location_encrypted: true,
            encrypted_location: encrypted.encrypted_location,
            encryption_iv: encrypted.encryption_iv,
          }
        }
      }

      const isEncrypted = !!encryptionFields.location_encrypted

      let solunarPeriod: 'major' | 'minor' | 'none' | null = null
      let solunarStrength: number | null = null
      if (data.lat && data.lng && data.caught_at) {
        try {
          const info = computeSolunar(new Date(data.caught_at), data.lat, data.lng)
          solunarPeriod = info.period
          solunarStrength = info.strength
        } catch {}
      }

      const catchBody = {
        caught_at: data.caught_at || new Date().toISOString(),
        species: data.species || null,
        species_confidence: data.species_confidence || null,
        weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
        length_cm: data.length_cm ? parseFloat(data.length_cm) : null,
        depth_m: data.depth_m ? parseFloat(data.depth_m) : null,
        water_temp_c: data.water_temp_c ? parseFloat(data.water_temp_c as string) : null,
        lat: isEncrypted ? null : (data.lat || null),
        lng: isEncrypted ? null : (data.lng || null),
        location_name: isEncrypted ? null : (data.location_name || null),
        water_body: isEncrypted ? null : (data.water_body || null),
        ...encryptionFields,
        fishing_method: data.fishing_method || null,
        lure_type: data.lure_type || null,
        lure_color: data.lure_color || null,
        lure_name: data.lure_name || null,
        bottom_structure: data.bottom_structure || null,
        is_public: data.is_public ?? false,
        notes: data.notes || null,
        weather_temp_c: data.weather_temp_c ?? null,
        weather_condition: data.weather_condition || null,
        wind_speed_ms: data.wind_speed_ms ?? null,
        wind_direction: data.wind_direction || null,
        cloud_cover_pct: data.cloud_cover_pct ?? null,
        precipitation_mm: data.precipitation_mm ?? null,
        pressure_hpa: data.pressure_hpa ?? null,
        humidity_pct: data.humidity_pct ?? null,
        visibility_km: data.visibility_km ?? null,
        moon_phase: data.moon_phase || null,
        moon_illumination_pct: data.moon_illumination_pct ?? null,
        sunrise_time: data.sunrise_time || null,
        sunset_time: data.sunset_time || null,
        is_golden_hour: data.is_golden_hour ?? null,
        ai_weather_description: data.ai_weather_description || null,
        ai_fish_description: data.ai_fish_description || null,
        ai_environment_notes: data.ai_environment_notes || null,
        catcher_name: data.catcher_name || null,
        exif_captured_at: data.exif_captured_at || null,
        image_url: imageUrl,
        image_path: imagePath,
        image_position: imagePosition,
        image_hash: imageHash,
        solunar_period: solunarPeriod,
        solunar_strength: solunarStrength,
      }

      const res = await fetch('/api/catches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catchBody),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        if (res.status === 409 && errBody.duplicate) {
          setError('Den här bilden är redan uppladdad.')
          setSaving(false)
          return
        }
        console.error('Save catch failed:', errBody)
        throw new Error(errBody.error || 'Save failed')
      }

      // Invalidate caches so all tabs show fresh data
      invalidateCache('home-catches', 'stats-catches', 'map-catches')

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

        <div className="space-y-4">
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.capture = 'environment'
                fileInputRef.current.click()
              }
            }}
            className="w-full py-8 px-6 bg-primary-700 text-white rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 hover:bg-primary-800 active:scale-[0.98] transition"
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
            className="w-full py-8 px-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 hover:bg-slate-50 active:scale-[0.98] transition"
          >
            <GalleryIcon />
            Välj från album
          </button>

          <Link
            href="/massuppladdning"
            className="w-full py-8 px-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 hover:bg-slate-50 active:scale-[0.98] transition"
          >
            <BulkIcon />
            Bulk uppladdning
          </Link>

          <div className="pt-4">
            <button
              onClick={skipImage}
              className="w-full py-4 px-6 text-slate-500 rounded-2xl font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.98] transition"
            >
              Skippa bild
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Lägg till fångst</h1>

      {imagePreview && (
        <div className="mb-4">
          <ImageCropPositioner
            imageSrc={imagePreview}
            value={imagePosition}
            onChange={setImagePosition}
          />
        </div>
      )}

      {duplicateOf && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-sm flex items-start gap-3">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="flex-1">
            <p className="font-medium">Den här bilden är redan uppladdad</p>
            <p className="text-xs mt-0.5">
              Sparad{duplicateOf.species ? ` som ${duplicateOf.species}` : ''} {new Date(duplicateOf.caught_at).toLocaleDateString('sv-SE')}.{' '}
              <Link href={`/fangst/${duplicateOf.id}`} className="underline font-medium">Visa fångst</Link>
            </p>
          </div>
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
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
    </svg>
  )
}

function GalleryIcon() {
  return (
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
    </svg>
  )
}

function BulkIcon() {
  return (
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 19.5V5.25A2.25 2.25 0 0 1 8.25 3h7.5A2.25 2.25 0 0 1 18 5.25V19.5m-10.5 0h9m-9 0a1.5 1.5 0 0 1-1.5-1.5m10.5 1.5a1.5 1.5 0 0 0 1.5-1.5m-12 0V4.5A2.25 2.25 0 0 0 3.75 6.75v10.5A2.25 2.25 0 0 0 6 19.5m12 0V4.5a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 18 19.5" />
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

async function compressForUpload(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1920
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height * MAX) / width); width = MAX }
        else { width = Math.round((width * MAX) / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(objectUrl)
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', 0.85)
    }
    img.onerror = reject
    img.src = objectUrl
  })
}

// Resize + compress image before sending to AI (phone cameras produce huge files that timeout Vercel)
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1024
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height * MAX) / width); width = MAX }
        else { width = Math.round((width * MAX) / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(objectUrl)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = reject
    img.src = objectUrl
  })
}
