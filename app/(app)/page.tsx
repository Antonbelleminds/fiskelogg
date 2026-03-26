'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import type { CatchWithProfile } from '@/types/database'
import { getCache, setCache } from '@/lib/cache'

type Tab = 'mine' | 'friends'

export default function HomePage() {
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [username, setUsername] = useState('')
  const [myCatches, setMyCatches] = useState<CatchWithProfile[]>([])
  const [friendCatches, setFriendCatches] = useState<CatchWithProfile[]>([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsLoaded, setFriendsLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('mine')
  const [filterSpecies, setFilterSpecies] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const pageRef = useRef(0)
  const PAGE_SIZE = 10

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUsername(user.email?.split('@')[0] || 'Fiskare')
      }

      // Use cache to avoid re-fetching on tab switch
      const cached = getCache<CatchWithProfile[]>('home-catches')
      if (cached) {
        setMyCatches(cached)
        setHasMore(cached.length >= PAGE_SIZE)
        setLoading(false)
        return
      }

      const res = await fetch(`/api/catches?limit=${PAGE_SIZE}`)
      if (res.ok) {
        const d = await res.json()
        const arr = Array.isArray(d) ? d : []
        setMyCatches(arr)
        setHasMore(arr.length >= PAGE_SIZE)
        setCache('home-catches', arr)
      }

      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (activeTab === 'friends' && !friendsLoaded && !friendsLoading) {
      const cached = getCache<CatchWithProfile[]>('friend-catches')
      if (cached) {
        setFriendCatches(cached)
        setFriendsLoaded(true)
        return
      }
      setFriendsLoading(true)
      fetch('/api/catches?scope=friends&limit=100')
        .then((r) => r.json())
        .then((d) => {
          const arr = Array.isArray(d) ? d : []
          setFriendCatches(arr)
          setFriendsLoaded(true)
          setCache('friend-catches', arr)
        })
        .catch(() => {})
        .finally(() => setFriendsLoading(false))
    }
  }, [activeTab, friendsLoaded, friendsLoading])

  async function loadMore() {
    setLoadingMore(true)
    pageRef.current += 1
    try {
      const res = await fetch(`/api/catches?limit=${PAGE_SIZE}&page=${pageRef.current}`)
      if (res.ok) {
        const d = await res.json()
        const arr = Array.isArray(d) ? d : []
        setMyCatches((prev) => [...prev, ...arr])
        setHasMore(arr.length >= PAGE_SIZE)
      }
    } catch (err) {
      console.error('Load more failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
      </div>
    )
  }

  const rawCatches = activeTab === 'mine' ? myCatches : friendCatches
  const activeCatches = rawCatches.filter((c) => {
    if (filterSpecies && c.species !== filterSpecies) return false
    if (filterMethod && c.fishing_method !== filterMethod) return false
    return true
  })
  const totalCatches = myCatches.length
  const heaviest = myCatches.reduce((max, c) =>
    c.weight_kg && c.weight_kg > (max?.weight_kg || 0) ? c : max, myCatches[0]
  )
  const speciesCount = new Set(myCatches.filter((c) => c.species).map((c) => c.species)).size

  // Insights
  const hourCounts: Record<number, number> = {}
  const lureCounts: Record<string, number> = {}
  const waterCounts: Record<string, number> = {}
  myCatches.forEach((c) => {
    if (c.lure_type) lureCounts[c.lure_type] = (lureCounts[c.lure_type] || 0) + 1
    const hour = new Date(c.caught_at).getHours()
    hourCounts[hour] = (hourCounts[hour] || 0) + 1
    if (c.water_body) waterCounts[c.water_body] = (waterCounts[c.water_body] || 0) + 1
  })
  const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]
  const bestLure = Object.entries(lureCounts).sort((a, b) => b[1] - a[1])[0]
  const bestWater = Object.entries(waterCounts).sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold">Hej, {username}!</h1>
      </div>

      {/* Tab bar */}
      <div className="px-4 mb-3">
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('mine')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              activeTab === 'mine'
                ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Mina
          </button>
          <button
            onClick={() => setActiveTab('friends')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              activeTab === 'friends'
                ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Vänner
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {activeTab === 'mine' && (
        <div className="px-4 mb-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
            Filtrera
            {(filterSpecies || filterMethod) && (
              <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary-700 text-white text-[10px]">
                {[filterSpecies, filterMethod].filter(Boolean).length}
              </span>
            )}
          </button>

          {showFilters && (
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                value={filterSpecies}
                onChange={(e) => setFilterSpecies(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none"
              >
                <option value="">Alla arter</option>
                {Array.from(new Set(myCatches.filter(c => c.species).map(c => c.species!))).sort().map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <select
                value={filterMethod}
                onChange={(e) => setFilterMethod(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none"
              >
                <option value="">Alla metoder</option>
                {Array.from(new Set(myCatches.filter(c => c.fishing_method).map(c => c.fishing_method!))).sort().map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {(filterSpecies || filterMethod) && (
                <button
                  onClick={() => { setFilterSpecies(''); setFilterMethod('') }}
                  className="text-xs px-2 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 border border-red-200 dark:border-red-800"
                >
                  Rensa
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Feed */}
      {activeTab === 'friends' && friendsLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
        </div>
      ) : activeCatches.length > 0 ? (
        <div className="space-y-0">
          {activeCatches.map((c) => (
            <FeedCard key={c.id} catch={c} showUser={activeTab === 'friends'} />
          ))}

          {/* Visa fler (only for own catches tab) */}
          {activeTab === 'mine' && hasMore && (
            <div className="px-4 py-6 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700" />
                    Laddar...
                  </>
                ) : (
                  'Visa fler'
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center border border-slate-200 dark:border-slate-700">
            <div className="mb-4 flex justify-center text-slate-300">
              {activeTab === 'mine' ? <FishingIcon /> : <UsersIcon />}
            </div>
            <h2 className="text-lg font-semibold mb-2">
              {activeTab === 'mine' ? 'Välkommen till FiskeLogg!' : 'Inga vänners fångster'}
            </h2>
            <p className="text-slate-500 text-sm mb-5">
              {activeTab === 'mine'
                ? 'Logga din första fångst genom att trycka på + knappen nedan. Fota fisken så identifierar AI:n arten automatiskt!'
                : 'Lägg till vänner via din profil för att se deras fångster här.'}
            </p>
            {activeTab === 'mine' ? (
              <Link
                href="/lagg-till"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-700 text-white rounded-xl font-medium text-sm hover:bg-primary-800 transition"
              >
                Logga din första fångst
              </Link>
            ) : (
              <Link
                href="/profil"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-700 text-white rounded-xl font-medium text-sm hover:bg-primary-800 transition"
              >
                Gå till profil
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Dashboard summary at the bottom */}
      {activeTab === 'mine' && totalCatches > 0 && (
        <div className="px-4 pt-6 pb-4">
          <h2 className="text-lg font-semibold mb-3">Din statistik</h2>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <MiniStat label="Fångster" value={totalCatches.toString()} />
            <MiniStat label="Arter" value={speciesCount.toString()} />
            <MiniStat label="PB" value={heaviest?.weight_kg ? `${heaviest.weight_kg} kg` : '—'} />
          </div>

          {totalCatches >= 3 && (
            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-3 border border-primary-100 dark:border-primary-800">
              <h3 className="text-xs font-semibold text-primary-800 dark:text-primary-200 mb-1.5">Insikter</h3>
              <div className="space-y-1 text-xs text-primary-700 dark:text-primary-300">
                {bestHour && <p>Bästa tid: kl {bestHour[0]}:00</p>}
                {bestLure && <p>Bästa bete: {bestLure[0]}</p>}
                {bestWater && <p>Hetaste vatten: {bestWater[0]}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FeedCard({ catch: c, showUser = false }: { catch: CatchWithProfile; showUser?: boolean }) {
  return (
    <Link href={`/fangst/${c.id}`} className="block border-b border-slate-100 dark:border-slate-800">
      {/* User line */}
      {showUser && c.profiles && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
          </div>
          <span className="text-sm font-medium">
            {c.profiles.display_name || c.profiles.username}
          </span>
        </div>
      )}

      {/* Image */}
      {c.image_url ? (
        <div className="aspect-[4/3] bg-slate-200 dark:bg-slate-800">
          <img
            src={c.image_url}
            alt={c.species || 'Fångst'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="aspect-[4/3] bg-gradient-to-br from-primary-100 to-primary-50 dark:from-primary-900/30 dark:to-slate-800 flex items-center justify-center">
          <svg className="w-16 h-16 text-primary-200" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
        </div>
      )}

      {/* Info */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-tight">
              {c.species || 'Okänd art'}
            </h3>
            <div className="flex items-center gap-3 mt-1">
              {c.weight_kg != null && (
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {c.weight_kg} kg
                </span>
              )}
              {c.length_cm != null && (
                <span className="text-sm text-slate-500">
                  {c.length_cm} cm
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm text-slate-500">
              {format(new Date(c.caught_at), 'd MMM', { locale: sv })}
            </div>
            <div className="text-xs text-slate-400">
              {format(new Date(c.caught_at), 'HH:mm')} &middot; {format(new Date(c.caught_at), 'yyyy')}
            </div>
          </div>
        </div>

        {/* Tags row */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {c.water_body && (
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs text-slate-600 dark:text-slate-400">
              {c.water_body}
            </span>
          )}
          {c.fishing_method && (
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs text-slate-600 dark:text-slate-400">
              {c.fishing_method}
            </span>
          )}
          {c.weather_condition && (
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs text-slate-600 dark:text-slate-400">
              {c.weather_condition}{c.weather_temp_c != null ? ` ${c.weather_temp_c}°` : ''}
            </span>
          )}
          {c.lure_type && (
            <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs text-slate-600 dark:text-slate-400">
              {c.lure_type}{c.lure_color ? ` (${c.lure_color})` : ''}
            </span>
          )}
        </div>

        {/* Likes */}
        {c.likes_count > 0 && (
          <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
            <svg className="w-3 h-3 fill-slate-400" viewBox="0 0 24 24"><path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" /></svg>
            {c.likes_count}
          </div>
        )}
      </div>
    </Link>
  )
}

function FishingIcon() {
  return (
    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}
