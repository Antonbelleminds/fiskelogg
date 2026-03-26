'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import type { CatchWithProfile } from '@/types/database'

const weatherIcons: Record<string, string> = {
  'Klart': '☀️',
  'Delvis molnigt': '⛅',
  'Molnigt': '🌥️',
  'Mulet': '☁️',
  'Regn': '🌧️',
  'Dimma': '🌫️',
}

export default function CatchCard({ catch: c, showUser = false }: { catch: CatchWithProfile; showUser?: boolean }) {
  return (
    <Link
      href={`/fangst/${c.id}`}
      className="block bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-md transition-shadow"
    >
      {c.image_url && (
        <div className="aspect-[4/3] overflow-hidden">
          <img
            src={c.image_url}
            alt={c.species || 'Fångst'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      <div className="p-3">
        {showUser && c.profiles && (
          <div className="text-xs text-slate-500 mb-1">
            {c.profiles.display_name || c.profiles.username}
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-base">
              {c.species || 'Okänd art'}
              {c.species && <span className="ml-1 text-lg">🐟</span>}
            </h3>
            <div className="flex items-center gap-2 text-sm text-slate-500 mt-0.5">
              {c.weight_kg && <span className="font-medium text-slate-700 dark:text-slate-300">{c.weight_kg} kg</span>}
              {c.length_cm && <span>{c.length_cm} cm</span>}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500 shrink-0">
            <div>{format(new Date(c.caught_at), 'd MMM yyyy', { locale: sv })}</div>
            <div>{format(new Date(c.caught_at), 'HH:mm')}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
          {c.weather_condition && (
            <span>{weatherIcons[c.weather_condition] || '🌤️'} {c.weather_temp_c !== null ? `${c.weather_temp_c}°` : ''}</span>
          )}
          {c.location_name && (
            <span className="truncate">📍 {c.location_name}</span>
          )}
          {!c.location_name && c.water_body && (
            <span className="truncate">📍 {c.water_body}</span>
          )}
          {c.fishing_method && (
            <span>🎣 {c.fishing_method}</span>
          )}
        </div>

        {c.likes_count > 0 && (
          <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
            <span>❤️</span>
            <span>{c.likes_count}</span>
          </div>
        )}
      </div>
    </Link>
  )
}
