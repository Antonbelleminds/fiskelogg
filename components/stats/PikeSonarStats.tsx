'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { usePin } from '@/contexts/PinContext'
import {
  buildCatchSonarSummary,
  type CatchSonarContext,
  type CatchSonarSummary,
  type SonarSignalLevel,
} from '@/lib/sonar/catch-context-stats'

export interface PikeCatchInput {
  id: string
  species: string | null
  weight_kg: number | null
  length_cm: number | null
  caught_at: string
  exif_lat?: number | null
  exif_lng?: number | null
  location_encrypted?: boolean | null
  encrypted_location?: string | null
  encryption_iv?: string | null
}

interface ContextResponse {
  contexts: CatchSonarContext[]
}

const signalLabel: Record<SonarSignalLevel, string> = {
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
  unknown: '–',
}

function isPike(species: string | null): boolean {
  return species?.trim().toLocaleLowerCase('sv-SE') === 'gädda'
}

export default function PikeSonarStats({
  catches,
}: {
  catches: PikeCatchInput[]
}) {
  const { isUnlocked, decrypt } = usePin()
  const pikeCatches = useMemo(
    () => catches.filter((caught) => isPike(caught.species)).slice(0, 100),
    [catches]
  )
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<CatchSonarSummary | null>(null)
  const [error, setError] = useState('')

  if (pikeCatches.length === 0) return null

  async function analyze() {
    setLoading(true)
    setError('')

    try {
      if (
        !isUnlocked &&
        pikeCatches.some((caught) => caught.location_encrypted)
      ) {
        throw new Error('pin_locked')
      }

      const located = await Promise.all(
        pikeCatches.map(async (caught) => {
          if (
            typeof caught.exif_lat === 'number' &&
            Number.isFinite(caught.exif_lat) &&
            typeof caught.exif_lng === 'number' &&
            Number.isFinite(caught.exif_lng)
          ) {
            return {
              catchId: caught.id,
              lat: caught.exif_lat,
              lon: caught.exif_lng,
            }
          }

          if (
            caught.location_encrypted &&
            caught.encrypted_location &&
            caught.encryption_iv
          ) {
            const location = await decrypt(
              caught.encrypted_location,
              caught.encryption_iv
            )
            if (
              location &&
              typeof location.exif_lat === 'number' &&
              Number.isFinite(location.exif_lat) &&
              typeof location.exif_lng === 'number' &&
              Number.isFinite(location.exif_lng)
            ) {
              return {
                catchId: caught.id,
                lat: location.exif_lat,
                lon: location.exif_lng,
              }
            }
          }

          return null
        })
      )
      const points = located.filter(
        (point): point is NonNullable<typeof point> => point !== null
      )

      if (points.length === 0) throw new Error('no_positions')

      const response = await fetch('/api/sonar/catch-contexts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
      })
      if (!response.ok) throw new Error('analysis_failed')

      const data = (await response.json()) as ContextResponse
      setSummary(buildCatchSonarSummary(data.contexts ?? []))
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'analysis_failed'
      setError(
        message === 'pin_locked'
          ? 'Lås upp Fiskepin när appen startar för att analysera fångstplatserna.'
          : message === 'no_positions'
            ? 'Gäddfångsterna saknar upplåsta GPS-positioner.'
            : 'Kunde inte matcha gäddorna mot ekolodsdata just nu.'
      )
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !summary && !loading) void analyze()
  }

  return (
    <section className="mb-4 rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/25">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left group"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200">
          <FishDepthIcon />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">
            Gädda × ekolod
          </span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400">
            Djup, hårdhet och växtlighet vid fångst
          </span>
        </span>
        <span className="text-[10px] text-slate-400 transition group-hover:text-slate-600 dark:group-hover:text-slate-200">
          {open ? 'Dölj' : 'Analysera'}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="mt-4 border-t border-emerald-100 pt-4 dark:border-emerald-900/70">
          {loading && (
            <div className="space-y-2 animate-pulse">
              <div className="h-16 rounded-xl bg-white dark:bg-slate-800" />
              <div className="h-24 rounded-xl bg-white dark:bg-slate-800" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-rose-200 bg-white p-3 dark:border-rose-900 dark:bg-slate-800">
              <p className="text-xs text-rose-700 dark:text-rose-200">{error}</p>
              <button
                type="button"
                onClick={() => void analyze()}
                className="mt-2 text-xs font-semibold text-rose-800 underline underline-offset-2 dark:text-rose-100"
              >
                Försök igen
              </button>
            </div>
          )}

          {!loading && summary && (
            <>
              {summary.matchedCount === 0 ? (
                <div className="rounded-xl border border-emerald-100 bg-white p-3 text-xs leading-relaxed text-slate-600 dark:border-emerald-900 dark:bg-slate-800 dark:text-slate-300">
                  Ingen gäddfångst ligger ännu inom 20 meter från en
                  kvalitetssäkrad ekolodsmätning.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Metric
                      label="Typiskt djup"
                      value={
                        summary.medianDepthM !== null
                          ? `${summary.medianDepthM.toFixed(1)} m`
                          : '–'
                      }
                    />
                    <Metric
                      label="Djupspann"
                      value={
                        summary.minDepthM !== null && summary.maxDepthM !== null
                          ? `${summary.minDepthM.toFixed(1)}–${summary.maxDepthM.toFixed(1)} m`
                          : '–'
                      }
                    />
                    <Metric
                      label="Matchade"
                      value={`${summary.matchedCount}/${pikeCatches.length}`}
                    />
                  </div>

                  {summary.depthCount > 0 && (
                    <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-3 dark:border-emerald-900/70 dark:bg-slate-800">
                      <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                        Gäddor per djup
                      </h3>
                      <div className="mt-2 space-y-2">
                        {summary.depthBands.map((band) => (
                          <DepthBand
                            key={band.label}
                            label={band.label}
                            count={band.count}
                            total={summary.depthCount}
                            averageWeightKg={band.averageWeightKg}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <SignalCard title="Bottenhårdhet β" values={summary.hardness} />
                    <SignalCard title="Växtlighet β" values={summary.vegetation} />
                  </div>

                  <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-3 dark:border-emerald-900/70 dark:bg-slate-800">
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                      Matchade gäddor
                    </h3>
                    <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
                      {summary.items.slice(0, 8).map((item) => (
                        <Link
                          key={item.catchId}
                          href={`/fangst/${item.catchId}`}
                          className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                              {item.weightKg !== null
                                ? `${item.weightKg} kg`
                                : item.lengthCm !== null
                                  ? `${item.lengthCm} cm`
                                  : 'Gädda'}
                            </span>
                            <span className="block text-[9px] text-slate-400">
                              {new Date(item.caughtAt).toLocaleDateString('sv-SE')}
                            </span>
                          </span>
                          <ContextPill
                            label={
                              item.depthReliable && item.depthM !== null
                                ? `${item.depthM.toFixed(1)} m`
                                : 'Djup –'
                            }
                          />
                          <ContextPill
                            label={`H ${signalLabel[item.hardnessClass]}`}
                          />
                          <ContextPill
                            label={`V ${signalLabel[item.vegetationClass]}`}
                          />
                        </Link>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                Endast mätningar inom 20 m används. Hårdhet och växtlighet är
                relativa Humminbird-signaler i beta.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white px-2 py-2.5 text-center dark:border-emerald-900/70 dark:bg-slate-800">
      <p className="text-sm font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-[8px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
    </div>
  )
}

function DepthBand({
  label,
  count,
  total,
  averageWeightKg,
}: {
  label: string
  count: number
  total: number
  averageWeightKg: number | null
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px]">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <span className="text-slate-400">
          {count} gäddor
          {averageWeightKg !== null ? ` · Ø ${averageWeightKg} kg` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-emerald-50 dark:bg-slate-700">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  )
}

function SignalCard({
  title,
  values,
}: {
  title: string
  values: { low: number; medium: number; high: number }
}) {
  const total = values.low + values.medium + values.high
  return (
    <div className="rounded-xl border border-emerald-100 bg-white p-3 dark:border-emerald-900/70 dark:bg-slate-800">
      <h3 className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">
        {title}
      </h3>
      {total === 0 ? (
        <p className="mt-2 text-[9px] text-slate-400">Ingen säker signal</p>
      ) : (
        <div className="mt-2 space-y-1 text-[9px] text-slate-500 dark:text-slate-400">
          <SignalRow label="Låg" value={values.low} />
          <SignalRow label="Medel" value={values.medium} />
          <SignalRow label="Hög" value={values.high} />
        </div>
      )}
    </div>
  )
}

function SignalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-semibold text-slate-700 dark:text-slate-200">
        {value}
      </span>
    </div>
  )
}

function ContextPill({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-1 text-[8px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
      {label}
    </span>
  )
}

function FishDepthIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12c3-4 7-5 12-3l4-3v12l-4-3c-5 2-9 1-12-3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11h.01M5 20h14M8 17h8" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-slate-400 transition-transform ${
        open ? 'rotate-180' : ''
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  )
}
