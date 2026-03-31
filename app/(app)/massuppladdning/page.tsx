'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { extractExif } from '@/lib/exif'
import { SPECIES_OPTIONS } from '@/components/catches/CatchForm'
import { invalidateCache } from '@/lib/cache'

const MAX_IMAGES = 20

interface BulkItem {
  file: File
  preview: string
  catcher_name: string
  species: string
  caught_at: string
  lat: number | null
  lng: number | null
  exif_captured_at: string | null
  skipped: boolean
  // Background-fetched data
  location_name: string
  water_body: string
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
  backgroundLoaded: boolean
}

type Step = 'select' | 'wizard' | 'saving' | 'done'

export default function MassuppladdningPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BulkItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [step, setStep] = useState<Step>('select')
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0, failed: 0 })
  const [catcherSuggestions, setCatcherSuggestions] = useState<string[]>([])
  const [speciesFilter, setSpeciesFilter] = useState('')
  const [showSpeciesDropdown, setShowSpeciesDropdown] = useState(false)
  const [showCatcherDropdown, setShowCatcherDropdown] = useState(false)

  // Fetch autocomplete suggestions for catcher_name
  useEffect(() => {
    fetch('/api/autocomplete?field=catcher_name')
      .then(r => r.ok ? r.json() : [])
      .then(setCatcherSuggestions)
      .catch(() => {})
  }, [])

  function updateCurrentItem(updates: Partial<BulkItem>) {
    setItems(prev => prev.map((item, i) => i === currentIndex ? { ...item, ...updates } : item))
  }

  function updateItemByIndex(index: number, updates: Partial<BulkItem>) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item))
  }

  async function handleFiles(files: FileList) {
    const selected = Array.from(files).slice(0, MAX_IMAGES)
    const newItems: BulkItem[] = []

    for (const file of selected) {
      const preview = URL.createObjectURL(file)
      let caught_at = new Date().toISOString().slice(0, 16)
      let lat: number | null = null
      let lng: number | null = null
      let exif_captured_at: string | null = null

      try {
        const exif = await extractExif(file)
        if (exif.captured_at) {
          const d = new Date(exif.captured_at)
          caught_at = d.toISOString().slice(0, 16)
          exif_captured_at = d.toISOString()
        }
        if (exif.lat && exif.lng) {
          lat = exif.lat
          lng = exif.lng
        }
      } catch {}

      newItems.push({
        file,
        preview,
        catcher_name: '',
        species: '',
        caught_at,
        lat,
        lng,
        exif_captured_at,
        skipped: false,
        location_name: '',
        water_body: '',
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
        backgroundLoaded: false,
      })
    }

    setItems(newItems)
    setCurrentIndex(0)
    setStep('wizard')

    // Fire background fetches for all images with GPS data (non-blocking)
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i]
      if (!item.lat || !item.lng) continue

      const lat = item.lat
      const lng = item.lng
      const dateParam = item.exif_captured_at || new Date().toISOString()

      // Fire all four APIs in parallel per image
      Promise.allSettled([
        fetch(`/api/geocode?lat=${lat}&lng=${lng}`),
        fetch(`/api/weather?lat=${lat}&lng=${lng}&date=${dateParam}`),
        fetch(`/api/moon?date=${dateParam}`),
        fetch(`/api/sun?lat=${lat}&lng=${lng}&date=${dateParam}`),
      ]).then(async ([geocodeRes, weatherRes, moonRes, sunRes]) => {
        const bgUpdates: Partial<BulkItem> = { backgroundLoaded: true }

        if (geocodeRes.status === 'fulfilled' && geocodeRes.value.ok) {
          const g = await geocodeRes.value.json()
          if (g.water_body) bgUpdates.water_body = g.water_body
          if (g.location_name) bgUpdates.location_name = g.location_name
        }
        if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
          const w = await weatherRes.value.json()
          bgUpdates.weather_temp_c = w.weather_temp_c ?? null
          bgUpdates.weather_condition = w.weather_condition || ''
          bgUpdates.wind_speed_ms = w.wind_speed_ms ?? null
          bgUpdates.wind_direction = w.wind_direction || ''
          bgUpdates.cloud_cover_pct = w.cloud_cover_pct ?? null
          bgUpdates.precipitation_mm = w.precipitation_mm ?? null
          bgUpdates.pressure_hpa = w.pressure_hpa ?? null
          bgUpdates.humidity_pct = w.humidity_pct ?? null
          bgUpdates.visibility_km = w.visibility_km ?? null
        }
        if (moonRes.status === 'fulfilled' && moonRes.value.ok) {
          const m = await moonRes.value.json()
          bgUpdates.moon_phase = m.moon_phase || ''
          bgUpdates.moon_illumination_pct = m.moon_illumination_pct ?? null
          bgUpdates.sunrise_time = m.sunrise_time || ''
          bgUpdates.sunset_time = m.sunset_time || ''
        }
        if (sunRes.status === 'fulfilled' && sunRes.value.ok) {
          const s = await sunRes.value.json()
          bgUpdates.is_golden_hour = s.is_golden_hour ?? null
        }

        updateItemByIndex(i, bgUpdates)
      })
    }
  }

  const currentItem = items[currentIndex]
  const activeItems = items.filter(i => !i.skipped)
  const isLast = currentIndex === items.length - 1

  function goNext() {
    if (isLast) {
      startSaving()
    } else {
      // Pre-fill catcher_name from current item for next
      const currentName = currentItem?.catcher_name || ''
      const currentSpecies = currentItem?.species || ''
      setItems(prev => prev.map((item, i) => {
        if (i === currentIndex + 1 && !item.catcher_name) {
          return { ...item, catcher_name: currentName }
        }
        return item
      }))
      setCurrentIndex(prev => prev + 1)
      setSpeciesFilter('')
      setShowSpeciesDropdown(false)
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1)
      setSpeciesFilter('')
      setShowSpeciesDropdown(false)
    }
  }

  function skipCurrent() {
    updateCurrentItem({ skipped: true })
    if (isLast) {
      startSaving()
    } else {
      setCurrentIndex(prev => prev + 1)
    }
  }

  async function startSaving() {
    const toSave = items.filter(i => !i.skipped && i.catcher_name.trim())
    if (toSave.length === 0) {
      router.push('/')
      return
    }

    setStep('saving')
    setSaveProgress({ current: 0, total: toSave.length, failed: 0 })
    let failed = 0

    for (let i = 0; i < toSave.length; i++) {
      setSaveProgress(prev => ({ ...prev, current: i + 1 }))
      const item = toSave[i]

      try {
        // Compress and upload image
        const compressed = await compressForUpload(item.file)
        const fd = new FormData()
        fd.append('file', compressed, 'photo.jpg')
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd })
        let imageUrl = null
        let imagePath = null

        if (uploadRes.ok) {
          const upload = await uploadRes.json()
          imageUrl = upload.url
          imagePath = upload.path
        }

        const res = await fetch('/api/catches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caught_at: item.caught_at || new Date().toISOString(),
            species: item.species || null,
            catcher_name: item.catcher_name || null,
            lat: item.lat,
            lng: item.lng,
            location_name: item.location_name || null,
            water_body: item.water_body || null,
            exif_captured_at: item.exif_captured_at || null,
            weather_temp_c: item.weather_temp_c,
            weather_condition: item.weather_condition || null,
            wind_speed_ms: item.wind_speed_ms,
            wind_direction: item.wind_direction || null,
            cloud_cover_pct: item.cloud_cover_pct,
            precipitation_mm: item.precipitation_mm,
            pressure_hpa: item.pressure_hpa,
            humidity_pct: item.humidity_pct,
            visibility_km: item.visibility_km,
            moon_phase: item.moon_phase || null,
            moon_illumination_pct: item.moon_illumination_pct,
            sunrise_time: item.sunrise_time || null,
            sunset_time: item.sunset_time || null,
            is_golden_hour: item.is_golden_hour,
            image_url: imageUrl,
            image_path: imagePath,
            is_public: false,
          }),
        })

        if (!res.ok) failed++
      } catch {
        failed++
      }
    }

    setSaveProgress(prev => ({ ...prev, failed }))
    invalidateCache('home-catches', 'stats-catches', 'map-catches')
    setStep('done')
  }

  // --- SELECT STEP ---
  if (step === 'select') {
    return (
      <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="mb-4 text-sm text-slate-500 flex items-center gap-1">
          <ArrowLeftIcon /> Tillbaka
        </button>
        <h1 className="text-xl font-semibold mb-2">Bulk uppladdning</h1>
        <p className="text-sm text-slate-500 mb-6">
          Välj upp till {MAX_IMAGES} bilder. Du går sedan igenom dem en i taget och anger fångstperson och art.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files)
          }}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-12 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl text-center hover:border-primary-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
        >
          <PhotoStackIcon />
          <div className="font-medium text-slate-700 dark:text-slate-300 mt-3">Välj bilder</div>
          <div className="text-xs text-slate-500 mt-1">Max {MAX_IMAGES} bilder</div>
        </button>
      </div>
    )
  }

  // --- SAVING STEP ---
  if (step === 'saving') {
    return (
      <div className="px-4 pt-6 pb-8 max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700 mb-6" />
        <p className="text-lg font-semibold mb-2">
          Sparar {saveProgress.current} av {saveProgress.total}...
        </p>
        <div className="w-full max-w-xs h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-700 rounded-full transition-all"
            style={{ width: `${(saveProgress.current / saveProgress.total) * 100}%` }}
          />
        </div>
      </div>
    )
  }

  // --- DONE STEP ---
  if (step === 'done') {
    const saved = saveProgress.total - saveProgress.failed
    return (
      <div className="px-4 pt-6 pb-8 max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <CheckIcon />
        </div>
        <p className="text-lg font-semibold mb-1">
          {saved} {saved === 1 ? 'fångst sparad' : 'fångster sparade'}
        </p>
        {saveProgress.failed > 0 && (
          <p className="text-sm text-red-500 mb-4">
            {saveProgress.failed} kunde inte sparas
          </p>
        )}
        <button
          onClick={() => { router.push('/'); router.refresh() }}
          className="mt-4 py-3 px-8 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 transition"
        >
          Till startsidan
        </button>
      </div>
    )
  }

  // --- WIZARD STEP ---
  const filteredSpecies = speciesFilter
    ? SPECIES_OPTIONS.filter(s => s.toLowerCase().includes(speciesFilter.toLowerCase()))
    : SPECIES_OPTIONS

  const filteredCatchers = currentItem?.catcher_name
    ? catcherSuggestions.filter(s => s.toLowerCase().includes(currentItem.catcher_name.toLowerCase()) && s.toLowerCase() !== currentItem.catcher_name.toLowerCase())
    : catcherSuggestions

  return (
    <div className="px-4 pt-4 pb-8 max-w-lg mx-auto">
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => currentIndex === 0 ? setStep('select') : goPrev()} className="text-sm text-slate-500 flex items-center gap-1">
          <ArrowLeftIcon /> {currentIndex === 0 ? 'Bilder' : 'Föregående'}
        </button>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
          {currentIndex + 1} av {items.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-primary-700 rounded-full transition-all"
          style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}
        />
      </div>

      {/* Image thumbnail strip */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { setCurrentIndex(i); setSpeciesFilter(''); setShowSpeciesDropdown(false) }}
            className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition ${
              i === currentIndex ? 'border-primary-700 ring-1 ring-primary-700' :
              item.skipped ? 'border-slate-200 opacity-40' :
              item.catcher_name ? 'border-green-400' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <img src={item.preview} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {currentItem && (
        <>
          {/* Main image */}
          <div className="rounded-2xl overflow-hidden aspect-[4/3] relative mb-4">
            <img src={currentItem.preview} alt="Fångst" className="w-full h-full object-cover" />
            {currentItem.skipped && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="text-white font-medium">Hoppas över</span>
              </div>
            )}
          </div>

          {/* Form fields */}
          <div className="space-y-3">
            {/* Catcher name */}
            <div className="relative">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Fångstperson <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={currentItem.catcher_name}
                onChange={(e) => { updateCurrentItem({ catcher_name: e.target.value }); setShowCatcherDropdown(true) }}
                onFocus={() => setShowCatcherDropdown(true)}
                onBlur={() => setTimeout(() => setShowCatcherDropdown(false), 200)}
                placeholder="Vem fångade fisken?"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
              />
              {showCatcherDropdown && filteredCatchers.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-32 overflow-y-auto">
                  {filteredCatchers.slice(0, 5).map(name => (
                    <button
                      key={name}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { updateCurrentItem({ catcher_name: name }); setShowCatcherDropdown(false) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Species */}
            <div className="relative">
              <label className="block text-xs font-medium text-slate-500 mb-1">Art</label>
              <input
                type="text"
                value={currentItem.species || speciesFilter}
                onChange={(e) => {
                  setSpeciesFilter(e.target.value)
                  updateCurrentItem({ species: e.target.value })
                  setShowSpeciesDropdown(true)
                }}
                onFocus={() => setShowSpeciesDropdown(true)}
                onBlur={() => setTimeout(() => setShowSpeciesDropdown(false), 200)}
                placeholder="Välj eller skriv art"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
              />
              {showSpeciesDropdown && filteredSpecies.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                  {filteredSpecies.map(s => (
                    <button
                      key={s}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { updateCurrentItem({ species: s }); setSpeciesFilter(''); setShowSpeciesDropdown(false) }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                        currentItem.species === s ? 'bg-primary-50 dark:bg-primary-900/20 font-medium' : ''
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date/time (from EXIF) */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Datum & tid</label>
              <input
                type="datetime-local"
                value={currentItem.caught_at}
                onChange={(e) => updateCurrentItem({ caught_at: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-6 space-y-3">
            <button
              onClick={goNext}
              disabled={!currentItem.catcher_name.trim()}
              className="w-full py-3.5 px-4 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 disabled:opacity-40 transition flex items-center justify-center gap-2"
            >
              {isLast ? (
                <>Spara alla ({activeItems.length} st)</>
              ) : (
                <>Nästa <ArrowRightIcon /></>
              )}
            </button>

            <button
              onClick={skipCurrent}
              className="w-full py-2.5 px-4 rounded-xl text-slate-500 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm"
            >
              Hoppa över denna bild
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// --- Icons ---

function ArrowLeftIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

function PhotoStackIcon() {
  return (
    <div className="flex justify-center">
      <svg className="w-12 h-12 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 19.5V5.25A2.25 2.25 0 0 1 8.25 3h7.5A2.25 2.25 0 0 1 18 5.25V19.5m-10.5 0h9m-9 0a1.5 1.5 0 0 1-1.5-1.5m10.5 1.5a1.5 1.5 0 0 0 1.5-1.5m-12 0V4.5A2.25 2.25 0 0 0 3.75 6.75v10.5A2.25 2.25 0 0 0 6 19.5m12 0V4.5a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 18 19.5" />
      </svg>
    </div>
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
