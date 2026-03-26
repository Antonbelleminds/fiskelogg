'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import type { CatchWithProfile } from '@/types/database'

export default function CatchDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [catchData, setCatchData] = useState<CatchWithProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [liked, setLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(0)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/catches/${id}`)
      if (res.ok) {
        const data = await res.json()
        setCatchData(data)
        setLikesCount(data.likes_count || 0)

        // Check if user has liked
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
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
            <h1 className="text-2xl font-semibold">{c.species || 'Okänd art'} 🐟</h1>
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
              {liked ? '❤️' : '🤍'} {likesCount > 0 && <span className="text-xs">{likesCount}</span>}
            </button>
          </div>
        </div>

        {/* Key info */}
        <div className="grid grid-cols-2 gap-3">
          {c.weight_kg && <InfoBox label="Vikt" value={`${c.weight_kg} kg`} icon="⚖️" />}
          {c.length_cm && <InfoBox label="Längd" value={`${c.length_cm} cm`} icon="📏" />}
          <InfoBox label="Datum" value={format(new Date(c.caught_at), 'd MMMM yyyy HH:mm', { locale: sv })} icon="📅" />
          {c.water_body && <InfoBox label="Vatten" value={c.water_body} icon="💧" />}
          {c.fishing_method && <InfoBox label="Metod" value={c.fishing_method} icon="🎣" />}
          {c.lure_type && <InfoBox label="Bete" value={`${c.lure_type}${c.lure_color ? ` (${c.lure_color})` : ''}`} icon="🪝" />}
          {c.depth_m && <InfoBox label="Djup" value={`${c.depth_m} m`} icon="🌊" />}
          {c.bottom_structure && <InfoBox label="Botten" value={c.bottom_structure} icon="🪨" />}
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
              {c.moon_phase && <span>🌙 {c.moon_phase} {c.moon_illumination_pct !== null ? `(${c.moon_illumination_pct}%)` : ''}</span>}
              {c.sunrise_time && <span>🌅 Uppgång: {c.sunrise_time}</span>}
              {c.sunset_time && <span>🌇 Nedgång: {c.sunset_time}</span>}
              {c.is_golden_hour && <span className="text-amber-600 font-medium">✨ Gyllene timmen</span>}
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

        {/* Delete button (only owner) */}
        <button
          onClick={handleDelete}
          className="w-full py-2.5 text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition mt-4"
        >
          Ta bort fångst
        </button>
      </div>
    </div>
  )
}

function InfoBox({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
      <div className="text-xs text-slate-500 mb-0.5">{icon} {label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}
