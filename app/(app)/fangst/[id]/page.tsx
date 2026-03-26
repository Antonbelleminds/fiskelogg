'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import CatchForm, { type CatchFormData } from '@/components/catches/CatchForm'
import type { CatchWithProfile } from '@/types/database'

export default function CatchDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [catchData, setCatchData] = useState<CatchWithProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [liked, setLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/catches/${id}`)
      if (res.ok) {
        const data = await res.json()
        setCatchData(data)
        setLikesCount(data.likes_count || 0)

        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          setCurrentUserId(user.id)
          const { data: likeData } = await supabase
            .from('catch_likes')
            .select('id')
            .eq('catch_id', id as string)
            .eq('user_id', user.id)
            .single()
          setLiked(!!likeData)
        }
      }
      setLoading(false)
    }
    load()
  }, [id, supabase])

  const isOwner = currentUserId && catchData?.user_id === currentUserId

  async function toggleLike() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    if (liked) {
      await supabase.from('catch_likes').delete().eq('catch_id', id as string).eq('user_id', user.id)
      setLiked(false)
      setLikesCount((c) => c - 1)
    } else {
      await supabase.from('catch_likes').insert({ catch_id: id as string, user_id: user.id })
      setLiked(true)
      setLikesCount((c) => c + 1)
    }
  }

  async function handleDelete() {
    if (!confirm('Vill du verkligen ta bort denna fångst?')) return
    const res = await fetch(`/api/catches/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/loggbok')
      router.refresh()
    }
  }

  async function handleSave(data: CatchFormData) {
    setSaving(true)
    setEditError('')

    try {
      const res = await fetch(`/api/catches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
          length_cm: data.length_cm ? parseFloat(data.length_cm) : null,
          depth_m: data.depth_m ? parseFloat(data.depth_m) : null,
          water_temp_c: data.water_temp_c ? parseFloat(data.water_temp_c as string) : null,
        }),
      })

      if (!res.ok) throw new Error('Save failed')

      const updated = await res.json()
      setCatchData((prev) => prev ? { ...prev, ...updated } : prev)
      setEditing(false)
    } catch {
      setEditError('Kunde inte spara ändringar. Försök igen.')
    } finally {
      setSaving(false)
    }
  }

  function catchToFormData(c: CatchWithProfile): CatchFormData {
    return {
      catcher_name: (c as unknown as Record<string, unknown>).catcher_name as string || '',
      catcher_user_id: (c as unknown as Record<string, unknown>).catcher_user_id as string || null,
      caught_at: new Date(c.caught_at).toISOString().slice(0, 16),
      species: c.species || '',
      species_confidence: c.species_confidence || 0,
      weight_kg: c.weight_kg?.toString() || '',
      length_cm: c.length_cm?.toString() || '',
      lat: c.exif_lat || null,
      lng: c.exif_lng || null,
      location_name: c.location_name || '',
      water_body: c.water_body || '',
      fishing_method: c.fishing_method || '',
      lure_type: c.lure_type || '',
      lure_color: c.lure_color || '',
      depth_m: c.depth_m?.toString() || '',
      bottom_structure: c.bottom_structure || '',
      water_temp_c: c.water_temp_c?.toString() || '',
      is_public: c.is_public || false,
      notes: c.notes || '',
      weather_temp_c: c.weather_temp_c,
      weather_condition: c.weather_condition || '',
      wind_speed_ms: c.wind_speed_ms,
      wind_direction: c.wind_direction || '',
      cloud_cover_pct: c.cloud_cover_pct,
      precipitation_mm: c.precipitation_mm,
      pressure_hpa: c.pressure_hpa,
      humidity_pct: c.humidity_pct,
      visibility_km: c.visibility_km,
      moon_phase: c.moon_phase || '',
      moon_illumination_pct: c.moon_illumination_pct,
      sunrise_time: c.sunrise_time || '',
      sunset_time: c.sunset_time || '',
      is_golden_hour: c.is_golden_hour,
      ai_weather_description: c.ai_weather_description || '',
      ai_fish_description: c.ai_fish_description || '',
      ai_environment_notes: c.ai_environment_notes || '',
      exif_captured_at: c.exif_captured_at || null,
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
      </div>
    )
  }

  if (!catchData) {
    return (
      <div className="px-4 pt-6 text-center">
        <h1 className="text-lg font-medium">Fångst hittades inte</h1>
        <button onClick={() => router.back()} className="mt-4 text-primary-700 text-sm">
          Gå tillbaka
        </button>
      </div>
    )
  }

  const c = catchData

  // Edit mode
  if (editing) {
    return (
      <div className="max-w-lg mx-auto pb-8">
        <div className="px-4 pt-4 mb-4">
          <h1 className="text-xl font-semibold">Redigera fångst</h1>
        </div>

        {c.image_url && (
          <div className="aspect-[4/3] overflow-hidden mb-4">
            <img src={c.image_url} alt={c.species || 'Fångst'} className="w-full h-full object-cover" />
          </div>
        )}

        <div className="px-4">
          <CatchForm
            initialData={catchToFormData(c)}
            onSave={handleSave}
            saving={saving}
            error={editError}
            submitLabel="Spara ändringar"
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    )
  }

  // View mode
  return (
    <div className="max-w-lg mx-auto pb-8">
      {/* Back button */}
      <div className="px-4 pt-4">
        <button onClick={() => router.back()} className="text-sm text-slate-500 flex items-center gap-1 hover:text-slate-700">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Tillbaka
        </button>
      </div>

      {/* Image */}
      {c.image_url && (
        <div className="aspect-[4/3] overflow-hidden mt-2">
          <img src={c.image_url} alt={c.species || 'Fångst'} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="px-4 pt-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{c.species || 'Okänd art'}</h1>
            {c.profiles && (
              <p className="text-sm text-slate-500">
                av {c.profiles.display_name || c.profiles.username}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLike}
              className={`p-2 rounded-full transition ${liked ? 'text-red-500' : 'text-slate-400 hover:text-red-400'}`}
            >
              {liked ? (
                <svg className="w-5 h-5 fill-red-500" viewBox="0 0 24 24"><path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" /></svg>
              )}
              {likesCount > 0 && <span className="text-xs ml-0.5">{likesCount}</span>}
            </button>
          </div>
        </div>

        {/* Key info */}
        <div className="grid grid-cols-2 gap-3">
          {c.weight_kg && <InfoBox label="Vikt" value={`${c.weight_kg} kg`} />}
          {c.length_cm && <InfoBox label="Längd" value={`${c.length_cm} cm`} />}
          <InfoBox label="Datum" value={format(new Date(c.caught_at), 'd MMMM yyyy HH:mm', { locale: sv })} />
          {c.water_body && <InfoBox label="Vatten" value={c.water_body} />}
          {c.fishing_method && <InfoBox label="Metod" value={c.fishing_method} />}
          {c.lure_type && <InfoBox label="Bete" value={`${c.lure_type}${c.lure_color ? ` (${c.lure_color})` : ''}`} />}
          {c.depth_m && <InfoBox label="Djup" value={`${c.depth_m} m`} />}
          {c.bottom_structure && <InfoBox label="Botten" value={c.bottom_structure} />}
        </div>

        {/* Weather section */}
        {c.weather_condition && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">Väder</h2>
            <div className="grid grid-cols-2 gap-2 text-xs text-blue-700 dark:text-blue-300">
              <span>{c.weather_condition} {c.weather_temp_c !== null ? `${c.weather_temp_c}°C` : ''}</span>
              {c.wind_speed_ms !== null && <span>Vind: {c.wind_speed_ms} m/s {c.wind_direction}</span>}
              {c.cloud_cover_pct !== null && <span>Moln: {c.cloud_cover_pct}%</span>}
              {c.pressure_hpa !== null && <span>Tryck: {c.pressure_hpa} hPa</span>}
              {c.humidity_pct !== null && <span>Fukt: {c.humidity_pct}%</span>}
              {c.precipitation_mm !== null && <span>Nederbörd: {c.precipitation_mm} mm</span>}
            </div>
          </div>
        )}

        {/* Moon & Sun */}
        {(c.moon_phase || c.sunrise_time) && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 mb-2">Astronomi</h2>
            <div className="grid grid-cols-2 gap-2 text-xs text-indigo-700 dark:text-indigo-300">
              {c.moon_phase && <span>{c.moon_phase}{c.moon_illumination_pct !== null ? ` (${c.moon_illumination_pct}%)` : ''}</span>}
              {c.sunrise_time && <span>Uppgång: {c.sunrise_time}</span>}
              {c.sunset_time && <span>Nedgång: {c.sunset_time}</span>}
              {c.is_golden_hour && <span className="text-amber-600 font-medium">Gyllene timmen</span>}
            </div>
          </div>
        )}

        {/* AI Analysis */}
        {c.ai_fish_description && (
          <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-2">AI-analys</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">{c.ai_fish_description}</p>
            {c.ai_environment_notes && (
              <p className="text-xs text-slate-500 mt-1">Miljö: {c.ai_environment_notes}</p>
            )}
          </div>
        )}

        {/* Notes */}
        {c.notes && (
          <div>
            <h2 className="text-sm font-semibold mb-1">Anteckningar</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{c.notes}</p>
          </div>
        )}

        {/* Owner actions */}
        {isOwner && (
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 py-2.5 text-primary-700 text-sm font-medium rounded-xl border border-primary-200 hover:bg-primary-50 transition"
            >
              Redigera
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 py-2.5 text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition"
            >
              Ta bort
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}
