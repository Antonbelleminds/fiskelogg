'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { extractExif } from '@/lib/exif'
import type { ImageAnalysis } from '@/types/database'

interface BulkItem {
  file: File
  preview: string
  status: 'pending' | 'analyzing' | 'ready' | 'saving' | 'done' | 'error'
  species: string
  weight_kg: string
  length_cm: string
  water_body: string
  fishing_method: string
  caught_at: string
  lat: number | null
  lng: number | null
  ai_fish_description: string
  weather_condition: string
  weather_temp_c: number | null
  moon_phase: string
  notes: string
  is_public: boolean
}

export default function MassuppladdningPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BulkItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [saving, setSaving] = useState(false)

  function updateItem(index: number, updates: Partial<BulkItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)))
  }

  async function handleFiles(files: FileList) {
    const newItems: BulkItem[] = Array.from(files).slice(0, 50).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'pending' as const,
      species: '',
      weight_kg: '',
      length_cm: '',
      water_body: '',
      fishing_method: '',
      caught_at: new Date().toISOString().slice(0, 16),
      lat: null,
      lng: null,
      ai_fish_description: '',
      weather_condition: '',
      weather_temp_c: null,
      moon_phase: '',
      notes: '',
      is_public: false,
    }))

    setItems(newItems)
    setProcessing(true)
    setProgress({ current: 0, total: newItems.length })

    for (let i = 0; i < newItems.length; i++) {
      setProgress({ current: i + 1, total: newItems.length })
      updateItem(i, { status: 'analyzing' })

      try {
        // Extract EXIF
        const exif = await extractExif(newItems[i].file)
        const updates: Partial<BulkItem> = {}

        if (exif.captured_at) {
          updates.caught_at = new Date(exif.captured_at).toISOString().slice(0, 16)
        }
        if (exif.lat && exif.lng) {
          updates.lat = exif.lat
          updates.lng = exif.lng
        }

        // AI analysis
        const base64 = await fileToBase64(newItems[i].file)
        const analysisRes = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mimeType: newItems[i].file.type }),
        })

        if (analysisRes.ok) {
          const analysis: ImageAnalysis = await analysisRes.json()
          updates.species = analysis.species || ''
          updates.ai_fish_description = analysis.fish_description || ''
          updates.weather_condition = analysis.weather_condition || ''
        }

        // Weather data
        if (updates.lat && updates.lng) {
          const dateParam = updates.caught_at || newItems[i].caught_at
          const [weatherRes, moonRes] = await Promise.allSettled([
            fetch(`/api/weather?lat=${updates.lat}&lng=${updates.lng}&date=${dateParam}`),
            fetch(`/api/moon?date=${dateParam}`),
          ])

          if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
            const w = await weatherRes.value.json()
            updates.weather_temp_c = w.weather_temp_c
            updates.weather_condition = w.weather_condition || updates.weather_condition
          }
          if (moonRes.status === 'fulfilled' && moonRes.value.ok) {
            const m = await moonRes.value.json()
            updates.moon_phase = m.moon_phase
          }
        }

        updateItem(i, { ...updates, status: 'ready' })
      } catch {
        updateItem(i, { status: 'error' })
      }
    }

    setProcessing(false)
  }

  async function saveAll() {
    setSaving(true)
    const readyItems = items.filter((item) => item.status === 'ready' || item.status === 'error')

    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== 'ready') continue
      updateItem(i, { status: 'saving' })

      try {
        // Upload image
        const formData = new FormData()
        formData.append('file', items[i].file)
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
        let imageUrl = null
        let imagePath = null

        if (uploadRes.ok) {
          const upload = await uploadRes.json()
          imageUrl = upload.url
          imagePath = upload.path
        }

        // Save catch
        const res = await fetch('/api/catches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caught_at: items[i].caught_at,
            species: items[i].species || null,
            weight_kg: items[i].weight_kg ? parseFloat(items[i].weight_kg) : null,
            length_cm: items[i].length_cm ? parseFloat(items[i].length_cm) : null,
            water_body: items[i].water_body || null,
            fishing_method: items[i].fishing_method || null,
            lat: items[i].lat,
            lng: items[i].lng,
            weather_condition: items[i].weather_condition || null,
            weather_temp_c: items[i].weather_temp_c,
            moon_phase: items[i].moon_phase || null,
            ai_fish_description: items[i].ai_fish_description || null,
            notes: items[i].notes || null,
            is_public: items[i].is_public,
            image_url: imageUrl,
            image_path: imagePath,
          }),
        })

        updateItem(i, { status: res.ok ? 'done' : 'error' })
      } catch {
        updateItem(i, { status: 'error' })
      }
    }

    setSaving(false)
    const doneCount = items.filter((i) => i.status === 'done').length
    if (doneCount > 0) {
      router.push('/loggbok')
    }
  }

  return (
    <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-2">Massuppladdning</h1>
      <p className="text-sm text-slate-500 mb-4">Ladda upp flera bilder och AI analyserar dem åt dig</p>

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

      {items.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-12 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl text-center hover:border-primary-400 hover:bg-primary-50/50 transition"
        >
          <div className="text-4xl mb-2">📸</div>
          <div className="font-medium text-slate-700 dark:text-slate-300">Välj bilder</div>
          <div className="text-xs text-slate-500 mt-1">Max 50 bilder åt gången</div>
        </button>
      ) : (
        <>
          {processing && (
            <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-700" />
                <span className="text-sm font-medium text-primary-800 dark:text-primary-200">
                  Analyserar bild {progress.current} av {progress.total}...
                </span>
              </div>
              <div className="mt-2 h-2 bg-primary-100 dark:bg-primary-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-600 rounded-full transition-all"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex gap-3 p-3">
                  <img src={item.preview} alt="" className="w-20 h-20 object-cover rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={item.status} />
                    </div>
                    <input
                      type="text"
                      value={item.species}
                      onChange={(e) => updateItem(i, { species: e.target.value })}
                      placeholder="Art"
                      className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent mb-1"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={item.weight_kg}
                        onChange={(e) => updateItem(i, { weight_kg: e.target.value })}
                        placeholder="Vikt kg"
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                      />
                      <input
                        type="number"
                        value={item.length_cm}
                        onChange={(e) => updateItem(i, { length_cm: e.target.value })}
                        placeholder="Längd cm"
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!processing && (
            <button
              onClick={saveAll}
              disabled={saving || items.every((i) => i.status !== 'ready')}
              className="w-full mt-4 py-3.5 px-4 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 disabled:opacity-50 transition"
            >
              {saving ? 'Sparar...' : `Spara ${items.filter((i) => i.status === 'ready').length} fångster`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-600',
    analyzing: 'bg-amber-100 text-amber-700',
    ready: 'bg-green-100 text-green-700',
    saving: 'bg-blue-100 text-blue-700',
    done: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  }
  const labels: Record<string, string> = {
    pending: 'Väntar',
    analyzing: 'Analyserar...',
    ready: 'Klar',
    saving: 'Sparar...',
    done: 'Sparad ✓',
    error: 'Fel',
  }

  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
