'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import CatchForm, { type CatchFormData } from '@/components/catches/CatchForm'
import { ImageCropPositioner } from '@/components/catches/ImageCropPositioner'
import { SolunarDayBar, SolunarStrengthPills } from '@/components/catches/SolunarDayBar'
import type { CatchWithProfile } from '@/types/database'
import { usePin } from '@/contexts/PinContext'

interface SonarEnrichment {
  match_distance_m: number
  match_time_delta_seconds: number
  depth_m: number | null
  bottom_hardness: number | null
  slope_deg: number | null
  distance_to_dropoff_m: number | null
  distance_to_vegetation_m: number | null
  distance_to_structure_m: number | null
  water_temp_c: number | null
  boat_speed_ms: number | null
  heading_deg: number | null
  matched_at: string
}

type SonarLevel = 'low' | 'medium' | 'high' | 'unknown'
type DepthEdgeStatus = 'on_edge' | 'near_edge' | 'flat' | 'unknown'

interface SonarLocationContext {
  found: boolean
  depthM: number | null
  minDepthM: number | null
  maxDepthM: number | null
  slopeDeg: number | null
  coverageConfidence: number | null
  cellDistanceM: number | null
  signalDistanceM: number | null
  vendorChannelA: number | null
  vendorChannelB: number | null
  hardnessClass: SonarLevel
  vegetationClass: SonarLevel
  distanceToDepthEdgeM: number | null
  depthEdgeSlopeDeg: number | null
  depthEdgeStatus: DepthEdgeStatus
  distanceToVegetationM: number | null
  observedAt: string | null
  waterTempC: number | null
  boatSpeedMs: number | null
  headingDeg: number | null
}

type CatchDetails = CatchWithProfile & {
  sonar_enrichment?: SonarEnrichment | null
}

export default function CatchDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const { isUnlocked, decrypt } = usePin()
  const [catchData, setCatchData] = useState<CatchDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [liked, setLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [editImagePosition, setEditImagePosition] = useState<string | null>(null)
  const [sonarContext, setSonarContext] =
    useState<SonarLocationContext | null>(null)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/catches/${id}`)
      if (res.ok) {
        const data = await res.json()
        setCatchData(data)

        const { data: { user } } = await supabase.auth.getUser()
        if (user) setCurrentUserId(user.id)

        const likesRes = await fetch(`/api/catches/${id}/likes`)
        if (likesRes.ok) {
          const likesData = await likesRes.json()
          setLikesCount(likesData.count || 0)
          setLiked(!!likesData.userLiked)
        } else {
          setLikesCount(data.likes_count || 0)
        }
      }
      setLoading(false)
    }
    load()
  }, [id, supabase])

  // Decrypt location if encrypted and PIN is unlocked
  useEffect(() => {
    if (!isUnlocked || !catchData) return
    if (!catchData.location_encrypted || !catchData.encrypted_location || !catchData.encryption_iv) return
    if (catchData.exif_lat) return // already decrypted

    decrypt(catchData.encrypted_location, catchData.encryption_iv).then(loc => {
      if (!loc) return
      setCatchData(prev => prev ? {
        ...prev,
        exif_lat: loc.exif_lat,
        exif_lng: loc.exif_lng,
        water_body: loc.water_body,
        location_name: loc.location_name,
      } : null)
    })
  }, [isUnlocked, catchData, decrypt])

  useEffect(() => {
    const lat = catchData?.exif_lat
    const lon = catchData?.exif_lng
    const ownsCatch =
      currentUserId != null && currentUserId === catchData?.user_id

    if (!ownsCatch || lat == null || lon == null) {
      return
    }

    const controller = new AbortController()

    fetch(
      `/api/sonar/inspect?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`,
      { signal: controller.signal }
    )
      .then((response) => {
        if (!response.ok) throw new Error('Sonar context failed')
        return response.json() as Promise<SonarLocationContext>
      })
      .then((context) => {
        if (!controller.signal.aborted) {
          setSonarContext(context.found ? context : null)
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          setSonarContext(null)
        }
      })

    return () => controller.abort()
  }, [
    currentUserId,
    catchData?.user_id,
    catchData?.exif_lat,
    catchData?.exif_lng,
  ])

  const isOwner = currentUserId && catchData?.user_id === currentUserId

  async function toggleLike() {
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikesCount((c) => wasLiked ? c - 1 : c + 1)
    try {
      const res = await fetch(`/api/catches/${id}/likes`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setLiked(!!data.liked)
        setLikesCount(data.count || 0)
      } else {
        setLiked(wasLiked)
        setLikesCount((c) => wasLiked ? c + 1 : c - 1)
      }
    } catch {
      setLiked(wasLiked)
      setLikesCount((c) => wasLiked ? c + 1 : c - 1)
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
          image_position: editImagePosition ?? catchData?.image_position ?? null,
        }),
      })

      if (!res.ok) throw new Error('Save failed')

      const updated = await res.json()
      setCatchData((prev) => prev ? { ...prev, ...updated } : prev)
      setEditing(false)
      setEditImagePosition(null)
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
      lure_name: c.lure_name || '',
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
          <div className="mb-4 px-4">
            <ImageCropPositioner
              imageSrc={c.image_url}
              value={editImagePosition ?? c.image_position ?? '50% 50%'}
              onChange={setEditImagePosition}
            />
          </div>
        )}

        <div className="px-4">
          <CatchForm
            initialData={catchToFormData(c)}
            onSave={handleSave}
            saving={saving}
            error={editError}
            submitLabel="Spara ändringar"
            onCancel={() => { setEditing(false); setEditImagePosition(null) }}
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
          <img
            src={c.image_url}
            alt={c.species || 'Fångst'}
            className="w-full h-full object-cover"
            style={{ objectPosition: c.image_position || 'center' }}
            loading="lazy"
          />
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
          {c.lure_type && <InfoBox label="Betetyp" value={`${c.lure_type}${c.lure_color ? ` (${c.lure_color})` : ''}`} />}
          {c.lure_name && <InfoBox label="Bete" value={c.lure_name} />}
          {c.depth_m && <InfoBox label="Djup" value={`${c.depth_m} m`} />}
          {c.bottom_structure && <InfoBox label="Botten" value={c.bottom_structure} />}
        </div>

        {sonarContext && (
          <SonarContextCard context={sonarContext} catchId={c.id} />
        )}

        {!sonarContext && c.sonar_enrichment && (
          <div className="rounded-xl bg-cyan-50 p-4 dark:bg-cyan-950/20">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">
                  Matchad ekolodsdata
                </h2>
                <p className="mt-0.5 text-[11px] text-cyan-700 dark:text-cyan-300">
                  Separat från dina manuella fångstfält · {Math.round(c.sonar_enrichment.match_distance_m)} m bort
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-cyan-900 dark:text-cyan-100">
              {c.sonar_enrichment.depth_m != null && (
                <span>Djup: {c.sonar_enrichment.depth_m.toFixed(1)} m</span>
              )}
              {c.sonar_enrichment.slope_deg != null && (
                <span>Lutning: {Math.round(c.sonar_enrichment.slope_deg)}°</span>
              )}
              {c.sonar_enrichment.water_temp_c != null && (
                <span>Vattentemp: {c.sonar_enrichment.water_temp_c.toFixed(1)}°C</span>
              )}
              {c.sonar_enrichment.boat_speed_ms != null && (
                <span>Båtfart: {c.sonar_enrichment.boat_speed_ms.toFixed(1)} m/s</span>
              )}
              {c.sonar_enrichment.heading_deg != null && (
                <span>Kurs: {Math.round(c.sonar_enrichment.heading_deg)}°</span>
              )}
              {c.sonar_enrichment.distance_to_dropoff_m != null && (
                <span>Brant kant: {Math.round(c.sonar_enrichment.distance_to_dropoff_m)} m</span>
              )}
              {c.sonar_enrichment.distance_to_structure_m != null && (
                <span>Struktur: {Math.round(c.sonar_enrichment.distance_to_structure_m)} m</span>
              )}
            </div>
          </div>
        )}

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

        {/* Solunar */}
        {c.exif_lat && c.exif_lng && (
          <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Solunar</h2>
              {c.solunar_strength !== null && c.solunar_strength !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">Dagens styrka</span>
                  <SolunarStrengthPills strength={c.solunar_strength} />
                </div>
              )}
            </div>
            <SolunarDayBar
              date={new Date(c.caught_at)}
              lat={c.exif_lat}
              lng={c.exif_lng}
              markerAt={new Date(c.caught_at)}
              sunriseTime={c.sunrise_time}
              sunsetTime={c.sunset_time}
            />
            {c.solunar_period && c.solunar_period !== 'none' && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-3">
                Fångad under <strong>{c.solunar_period === 'major' ? 'major' : 'minor'}</strong> solunar-period.
              </p>
            )}
            {c.solunar_period === 'none' && (
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-3">
                Fångad utanför aktiv solunar-period.
              </p>
            )}
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

const sonarLevelLabels: Record<SonarLevel, string> = {
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
  unknown: 'Saknas',
}

function SonarContextCard({
  context,
  catchId,
}: {
  context: SonarLocationContext
  catchId: string
}) {
  const depthSpread =
    context.minDepthM != null && context.maxDepthM != null
      ? context.maxDepthM - context.minDepthM
      : null
  const isCloseEnough =
    context.cellDistanceM == null || context.cellDistanceM <= 20
  const depthReliable =
    context.depthM != null &&
    context.coverageConfidence != null &&
    context.coverageConfidence >= 0.45 &&
    depthSpread != null &&
    depthSpread <= Math.max(3, context.depthM) &&
    isCloseEnough
  const edgeValue =
    !depthReliable
      ? 'Inte kvalitetssäkrad'
      : context.depthEdgeStatus === 'on_edge'
      ? 'I en djupkant'
      : context.depthEdgeStatus === 'near_edge'
        ? 'Nära djupkant'
        : context.depthEdgeStatus === 'flat'
          ? 'Flackare område'
          : 'Okänt'
  const edgeDetail =
    !isCloseEnough
      ? 'Närmaste djupyta ligger mer än 20 m bort'
      : !depthReliable
        ? 'Mätpunkterna nära platsen skiljer sig för mycket'
        : context.distanceToDepthEdgeM != null
      ? `${Math.round(context.distanceToDepthEdgeM)} m till brantaste kanten`
      : context.slopeDeg != null
        ? `${Math.round(context.slopeDeg)}° lokal lutning`
        : undefined
  const confidence =
    !depthReliable
      ? 'Osäker'
      : context.coverageConfidence == null
      ? 'Okänd'
      : context.coverageConfidence >= 0.75
        ? 'Hög'
        : context.coverageConfidence >= 0.45
          ? 'Medel'
          : 'Låg'

  return (
    <section className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-sky-50 p-4 dark:border-cyan-900 dark:from-cyan-950/30 dark:to-sky-950/20">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-cyan-950 dark:text-cyan-100">
            Ekolodsdata vid fångstplatsen
          </h2>
          <p className="mt-0.5 text-[11px] leading-4 text-cyan-700 dark:text-cyan-300">
            Matchat mot din privata Humminbird-djupkarta
            {context.cellDistanceM != null
              ? ` · ${Math.round(context.cellDistanceM)} m till mätområdet`
              : ''}
          </p>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
          Sonar
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {depthReliable && context.depthM != null ? (
          <SonarInfoBox
            label="Djup"
            value={`${context.depthM.toFixed(1)} m`}
            detail={
              context.minDepthM != null && context.maxDepthM != null
                ? `${context.minDepthM.toFixed(1)}–${context.maxDepthM.toFixed(1)} m i mätcellen`
                : 'Från interpolerad djupyta'
            }
          />
        ) : (
          <SonarInfoBox
            label="Djupdata"
            value="Kvalitetsvarning"
            detail={
              !isCloseEnough
                ? 'Ingen sonarmätning inom 20 m'
                : 'Motstridiga sonarmätningar – visar inget osäkert djup'
            }
          />
        )}
        <SonarInfoBox
          label="Djupkant"
          value={edgeValue}
          detail={edgeDetail}
        />
        {context.vendorChannelA != null && (
          <SonarInfoBox
            label="Bottenhårdhet β"
            value={`${sonarLevelLabels[context.hardnessClass]} (${context.vendorChannelA.toFixed(1)})`}
            detail="Experimentell relativ Humminbird-bottenrespons"
          />
        )}
        {context.vendorChannelB != null && (
          <SonarInfoBox
            label="Vegetation β"
            value={`${sonarLevelLabels[context.vegetationClass]} (${context.vendorChannelB.toFixed(1)})`}
            detail={
              context.distanceToVegetationM != null &&
              context.vegetationClass !== 'high'
                ? `Tätare signal ${Math.round(context.distanceToVegetationM)} m bort`
                : 'Experimentell relativ Humminbird-vegetationssignal'
            }
          />
        )}
        {depthReliable && context.slopeDeg != null && (
          <SonarInfoBox
            label="Lutning"
            value={`${Math.round(context.slopeDeg)}°`}
            detail={
              context.depthEdgeSlopeDeg != null
                ? `Närmaste kant ${Math.round(context.depthEdgeSlopeDeg)}°`
                : 'Beräknad från djupytan'
            }
          />
        )}
        <SonarInfoBox
          label="Mätkvalitet"
          value={confidence}
          detail={
            !depthReliable
              ? 'Osäkra djup används inte för fångstanalys'
              : context.coverageConfidence != null
              ? `${Math.round(context.coverageConfidence * 100)} % täckningssäkerhet`
              : context.signalDistanceM != null
                ? `${Math.round(context.signalDistanceM)} m till sonarsignal`
                : undefined
          }
        />
        {context.waterTempC != null && (
          <SonarInfoBox
            label="Vattentemperatur"
            value={`${context.waterTempC.toFixed(1)} °C`}
          />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-cyan-200/70 pt-3 text-[10px] text-cyan-700 dark:border-cyan-900 dark:text-cyan-300">
        <span>Ändrar inte fångstens manuella uppgifter</span>
        <Link
          href={`/karta?djupkarta=1&fangst=${encodeURIComponent(catchId)}`}
          className="font-semibold hover:text-cyan-950 dark:hover:text-white"
        >
          Visa kartan →
        </Link>
      </div>
    </section>
  )
}

function SonarInfoBox({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-xl border border-white/80 bg-white/75 p-3 shadow-sm dark:border-cyan-900/70 dark:bg-slate-900/60">
      <div className="text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-[9px] leading-3 text-slate-500 dark:text-slate-400">
          {detail}
        </div>
      ) : null}
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
