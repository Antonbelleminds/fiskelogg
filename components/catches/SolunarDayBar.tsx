'use client'

import { useMemo } from 'react'
import { computeSolunar } from '@/lib/solunar'

interface SolunarDayBarProps {
  date: Date
  lat: number
  lng: number
  markerAt?: Date
  sunriseTime?: string | null
  sunsetTime?: string | null
}

export function SolunarDayBar({ date, lat, lng, markerAt, sunriseTime, sunsetTime }: SolunarDayBarProps) {
  const info = useMemo(() => computeSolunar(date, lat, lng), [date, lat, lng])

  const dayStart = useMemo(() => {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
  }, [date])

  function toPct(t: Date): number {
    const ms = t.getTime() - dayStart.getTime()
    return Math.max(0, Math.min(100, (ms / (24 * 60 * 60 * 1000)) * 100))
  }

  const sunrisePct = useMemo(() => {
    if (!sunriseTime) return null
    const [h, m] = sunriseTime.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return null
    return ((h * 60 + m) / (24 * 60)) * 100
  }, [sunriseTime])

  const sunsetPct = useMemo(() => {
    if (!sunsetTime) return null
    const [h, m] = sunsetTime.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return null
    return ((h * 60 + m) / (24 * 60)) * 100
  }, [sunsetTime])

  const markerPct = markerAt ? toPct(markerAt) : null

  return (
    <div className="w-full">
      {/* Bar */}
      <div className="relative w-full h-8 rounded-lg bg-slate-200 dark:bg-slate-700 overflow-hidden">
        {info.minorPeriods.map((p, i) => {
          const start = toPct(p.start)
          const end = toPct(p.end)
          if (end <= 0 || start >= 100) return null
          return (
            <div
              key={`minor-${i}`}
              className="absolute top-0 bottom-0 bg-slate-400/60 dark:bg-slate-500/60"
              style={{ left: `${start}%`, width: `${end - start}%` }}
              title="Minor solunar"
            />
          )
        })}
        {info.majorPeriods.map((p, i) => {
          const start = toPct(p.start)
          const end = toPct(p.end)
          if (end <= 0 || start >= 100) return null
          return (
            <div
              key={`major-${i}`}
              className="absolute top-0 bottom-0 bg-primary-700 dark:bg-white"
              style={{ left: `${start}%`, width: `${end - start}%` }}
              title="Major solunar"
            />
          )
        })}
        {sunrisePct !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400"
            style={{ left: `${sunrisePct}%` }}
            title="Soluppgång"
          />
        )}
        {sunsetPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-500"
            style={{ left: `${sunsetPct}%` }}
            title="Solnedgång"
          />
        )}
        {markerPct !== null && (
          <div
            className="absolute -top-1 -bottom-1 w-1 bg-red-500 rounded-full ring-2 ring-white dark:ring-slate-900"
            style={{ left: `calc(${markerPct}% - 2px)` }}
            title="Fångsttid"
          />
        )}
      </div>

      {/* Hour ticks */}
      <div className="relative w-full text-[10px] text-slate-400 mt-1 h-3">
        {[0, 6, 12, 18, 24].map(h => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
            {h.toString().padStart(2, '0')}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-slate-500 dark:text-slate-400">
        <LegendDot className="bg-primary-700 dark:bg-white" label="Major" />
        <LegendDot className="bg-slate-400/60 dark:bg-slate-500/60" label="Minor" />
        <LegendDot className="bg-amber-400" label="Soluppgång" />
        <LegendDot className="bg-orange-500" label="Solnedgång" />
        {markerPct !== null && <LegendDot className="bg-red-500" label="Fångst" />}
      </div>
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

export function SolunarStrengthPills({ strength }: { strength: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          className={`inline-block w-2.5 h-2.5 rounded-sm ${
            n <= strength ? 'bg-primary-700 dark:bg-white' : 'bg-slate-200 dark:bg-slate-700'
          }`}
        />
      ))}
    </div>
  )
}
