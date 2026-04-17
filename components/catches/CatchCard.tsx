'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import type { CatchWithProfile } from '@/types/database'

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
            style={{ objectPosition: c.image_position || 'center' }}
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

        {/* Art + vikt/längd + datum/tid */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75s1.5 6 4.5 8.25c1.5 1.125 3 1.5 4.5 1.5s3-.375 4.5-1.5c3-2.25 4.5-8.25 4.5-8.25M3.75 3.75C5.25 6 7.5 7.5 12 7.5s6.75-1.5 8.25-3.75M3.75 3.75 2.25 2.25M20.25 3.75l1.5-1.5M12 7.5v3m0 0-2.25 2.25M12 10.5l2.25 2.25" />
              </svg>
              <h3 className="font-semibold text-base dark:text-white">{c.species || 'Okänd art'}</h3>
            </div>
            <div className="flex items-center gap-2 text-sm mt-0.5 ml-0.5">
              {c.weight_kg && (
                <span className="font-medium text-slate-700 dark:text-slate-300">{c.weight_kg} kg</span>
              )}
              {c.length_cm && (
                <span className="text-slate-500 dark:text-slate-400">{c.length_cm} cm</span>
              )}
              {!c.weight_kg && !c.length_cm && (
                <span className="text-slate-400 dark:text-slate-500 text-xs">Ingen mätdata</span>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <div>{format(new Date(c.caught_at), 'd MMM yyyy', { locale: sv })}</div>
            <div>{format(new Date(c.caught_at), 'HH:mm')}</div>
          </div>
        </div>

        {/* Plats: sjönamn + region */}
        {(c.water_body || c.location_name) && (
          <div className="mt-2 space-y-0.5">
            {c.water_body && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12c3-4 6-4 9 0s6 4 9 0" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 17c3-4 6-4 9 0s6 4 9 0" />
                </svg>
                <span className="truncate">{c.water_body}</span>
              </div>
            )}
            {c.location_name && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
                <span className="truncate">{c.location_name}</span>
              </div>
            )}
          </div>
        )}

        {/* Väder + metod */}
        {(c.weather_condition || c.fishing_method) && (
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400">
            {c.weather_condition && (
              <div className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 .75-7.414 5.25 5.25 0 0 0-10.233-2.33 3 3 0 0 0-3.758 3.848A4.5 4.5 0 0 0 2.25 15Z" />
                </svg>
                <span>{c.weather_condition}{c.weather_temp_c !== null ? ` ${c.weather_temp_c}°` : ''}</span>
              </div>
            )}
            {c.fishing_method && (
              <div className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25c0 2.071-1.679 3.75-3.75 3.75S8.25 19.321 8.25 17.25c0-1.813 1.285-3.319 3-3.662V5.25a.75.75 0 0 1 1.5 0v8.338c1.715.343 3 1.849 3 3.662Z" />
                </svg>
                <span>{c.fishing_method}</span>
              </div>
            )}
          </div>
        )}

        {/* Likes */}
        {c.likes_count > 0 && (
          <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
            </svg>
            <span>{c.likes_count}</span>
          </div>
        )}
      </div>
    </Link>
  )
}
