'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import type { CatchWithProfile } from '@/types/database'
import { getCache, setCache } from '@/lib/cache'
import { useDecryptCatches } from '@/lib/useDecryptCatches'

type Tab = 'mine' | 'friends'

export default function HomePage() {
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [myCatches, setMyCatches] = useState<CatchWithProfile[]>([])
  const [friendCatches, setFriendCatches] = useState<CatchWithProfile[]>([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsLoaded, setFriendsLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('mine')
  const [filterSpecies, setFilterSpecies] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterCatcher, setFilterCatcher] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [availableYears, setAvailableYears] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const pageRef = useRef(0)
  const PAGE_SIZE = 10

  // Decrypt encrypted catches when PIN is unlocked
  useDecryptCatches(myCatches, setMyCatches)

  useEffect(() => {
    async function load() {
      // Fetch available years from DB (cached 10 min)
      const cachedYears = getCache<string[]>('available-years')
      if (cachedYears) {
        setAvailableYears(cachedYears)
      } else {
        fetch('/api/catches/years')
          .then(r => r.ok ? r.json() : [])
          .then((years: string[]) => { setAvailableYears(years); setCache('available-years', years) })
          .catch(() => {})
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

  // Re-fetch server-side when year filter changes
  useEffect(() => {
    async function fetchByYear() {
      setLoading(true)
      pageRef.current = 0
      const params = new URLSearchParams({ limit: '50' })
      if (filterYear) params.set('year', filterYear)
      const res = await fetch(`/api/catches?${params}`)
      if (res.ok) {
        const d = await res.json()
        const arr = Array.isArray(d) ? d : []
        setMyCatches(arr)
        setHasMore(arr.length >= 50)
        // Don't cache filtered results
        if (!filterYear) setCache('home-catches', arr)
      }
      setLoading(false)
    }
    // Only run after initial mount (availableYears is populated or filterYear changes)
    if (activeTab === 'mine') fetchByYear()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYear])

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

  const rawCatches = activeTab === 'mine' ? myCatches : friendCatches
  const activeCatches = useMemo(() => rawCatches.filter((c) => {
    if (filterSpecies && c.species !== filterSpecies) return false
    if (filterMethod && c.fishing_method !== filterMethod) return false
    if (filterCatcher && c.catcher_name !== filterCatcher) return false
    if (filterYear && new Date(c.caught_at).getFullYear().toString() !== filterYear) return false
    return true
  }), [rawCatches, filterSpecies, filterMethod, filterCatcher, filterYear])

  const { totalCatches, heaviest, speciesCount, bestHour, bestLure, bestWater } = useMemo(() => {
    const total = myCatches.length
    const heavy = myCatches.reduce((max, c) =>
      c.weight_kg && c.weight_kg > (max?.weight_kg || 0) ? c : max, myCatches[0]
    )
    const species = new Set(myCatches.filter((c) => c.species).map((c) => c.species)).size

    const hourCounts: Record<number, number> = {}
    const lureCounts: Record<string, number> = {}
    const waterCounts: Record<string, number> = {}
    myCatches.forEach((c) => {
      if (c.lure_type) lureCounts[c.lure_type] = (lureCounts[c.lure_type] || 0) + 1
      const hour = new Date(c.caught_at).getHours()
      hourCounts[hour] = (hourCounts[hour] || 0) + 1
      if (c.water_body) waterCounts[c.water_body] = (waterCounts[c.water_body] || 0) + 1
    })

    return {
      totalCatches: total,
      heaviest: heavy,
      speciesCount: species,
      bestHour: Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0],
      bestLure: Object.entries(lureCounts).sort((a, b) => b[1] - a[1])[0],
      bestWater: Object.entries(waterCounts).sort((a, b) => b[1] - a[1])[0],
    }
  }, [myCatches])

  if (loading) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="px-4 pt-4 mb-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 h-10" />
        </div>
        <div className="space-y-0">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-4 py-3 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1">
                  <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-1.5" />
                  <div className="h-2.5 w-16 bg-slate-100 dark:bg-slate-800 rounded" />
                </div>
              </div>
              <div className="aspect-[4/3] bg-slate-200 dark:bg-slate-700 rounded-xl mb-3" />
              <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Tab bar */}
      <div className="px-4 pt-4 mb-3">
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
            {(filterSpecies || filterMethod || filterCatcher || filterYear) && (
              <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary-700 text-white text-[10px]">
                {[filterSpecies, filterMethod, filterCatcher, filterYear].filter(Boolean).length}
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

              <select
                value={filterCatcher}
                onChange={(e) => setFilterCatcher(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none"
              >
                <option value="">Alla fångstpersoner</option>
                {Array.from(new Set(myCatches.filter(c => c.catcher_name && c.catcher_name.trim()).map(c => c.catcher_name!))).sort().map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>

              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none"
              >
                <option value="">Alla år</option>
                {availableYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>

              {(filterSpecies || filterMethod || filterCatcher || filterYear) && (
                <button
                  onClick={() => { setFilterSpecies(''); setFilterMethod(''); setFilterCatcher(''); setFilterYear('') }}
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

interface Comment {
  id: string
  user_id: string
  text: string
  created_at: string
  profiles?: { display_name: string | null; username: string | null; avatar_url: string | null }
}

function FeedCard({ catch: c, showUser = false }: { catch: CatchWithProfile; showUser?: boolean }) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [likeLoading, setLikeLoading] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentCount, setCommentCount] = useState(0)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Handle mobile keyboard resize via visualViewport
  useEffect(() => {
    if (!showComments) return
    const vv = window.visualViewport
    if (!vv) return

    function onResize() {
      setViewportHeight(window.visualViewport?.height || window.innerHeight)
    }
    onResize()
    vv.addEventListener('resize', onResize)
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden'
    return () => {
      vv.removeEventListener('resize', onResize)
      document.body.style.overflow = ''
    }
  }, [showComments])

  // Auto-scroll to bottom when new comments arrive
  useEffect(() => {
    if (showComments && commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [comments.length, showComments])

  // Load likes status
  useEffect(() => {
    fetch(`/api/catches/${c.id}/likes`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setLiked(data.userLiked)
          setLikeCount(data.count)
        }
      })
      .catch(() => {})
  }, [c.id])

  async function toggleLike(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (likeLoading) return
    setLikeLoading(true)

    const wasLiked = liked
    // Optimistic update
    setLiked(!wasLiked)
    setLikeCount(prev => wasLiked ? prev - 1 : prev + 1)

    try {
      const res = await fetch(`/api/catches/${c.id}/likes`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setLiked(data.liked)
        setLikeCount(data.count)
      } else {
        // Revert on error
        setLiked(wasLiked)
        setLikeCount(prev => wasLiked ? prev + 1 : prev - 1)
      }
    } catch {
      setLiked(wasLiked)
      setLikeCount(prev => wasLiked ? prev + 1 : prev - 1)
    } finally {
      setLikeLoading(false)
    }
  }

  async function loadComments() {
    try {
      const res = await fetch(`/api/catches/${c.id}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(data)
        setCommentCount(data.length)
        setCommentsLoaded(true)
      }
    } catch {}
  }

  function handleToggleComments(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !showComments
    setShowComments(next)
    if (next) loadComments()
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!commentText.trim() || commentLoading) return
    setCommentLoading(true)
    try {
      const res = await fetch(`/api/catches/${c.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim() }),
      })
      if (res.ok) {
        const newComment = await res.json()
        setComments(prev => [...prev, newComment])
        setCommentCount(prev => prev + 1)
        setCommentText('')
      }
    } catch {}
    setCommentLoading(false)
  }

  return (
    <div className="border-b border-slate-100 dark:border-slate-800">
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

      {/* Image - clickable link */}
      <Link href={`/fangst/${c.id}`}>
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
      </Link>

      {/* Action bar - like & comment buttons */}
      <div className="px-4 pt-2 flex items-center gap-4">
        <button onClick={toggleLike} className="flex items-center gap-1.5 group">
          {liked ? (
            <svg className="w-6 h-6 fill-red-500 transition-transform active:scale-125" viewBox="0 0 24 24">
              <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-slate-500 group-hover:text-red-400 transition" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
            </svg>
          )}
        </button>
        <button onClick={handleToggleComments} className="flex items-center gap-1.5 group">
          <svg className="w-6 h-6 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
          </svg>
          {commentCount > 0 && (
            <span className="text-xs text-slate-500">{commentCount}</span>
          )}
        </button>
      </div>

      {/* Like count */}
      {likeCount > 0 && (
        <div className="px-4 pt-1">
          <span className="text-xs font-semibold dark:text-slate-300">{likeCount} {likeCount === 1 ? 'gilla' : 'gillar'}</span>
        </div>
      )}

      {/* Info */}
      <Link href={`/fangst/${c.id}`}>
        <div className="px-4 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold leading-tight">
                {c.species || 'Okänd art'}
              </h3>
              <div className="flex items-center gap-3 mt-0.5">
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
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
        </div>
      </Link>

      {/* Comments modal — centered dialog */}
      {showComments && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4"
          onClick={handleToggleComments}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl"
            style={{ maxHeight: 'min(500px, 70vh)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h3 className="font-semibold text-sm">Kommentarer</h3>
              <button onClick={handleToggleComments} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Comments list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[80px]">
              {comments.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">Inga kommentarer ännu. Bli först!</p>
              )}
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
                      <span className="text-xs font-semibold dark:text-slate-300">
                        {comment.profiles?.display_name || comment.profiles?.username || 'Okänd'}
                      </span>
                      <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{comment.text}</p>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 ml-1">
                      {format(new Date(comment.created_at), 'd MMM HH:mm', { locale: sv })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={commentsEndRef} />
            </div>

            {/* Comment input */}
            <form onSubmit={submitComment} className="flex gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
              <input
                ref={inputRef}
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Skriv en kommentar..."
                enterKeyHint="send"
                className="flex-1 text-sm px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <button
                type="submit"
                disabled={!commentText.trim() || commentLoading}
                className="px-4 py-2.5 text-sm font-semibold text-white bg-primary-700 rounded-full hover:bg-primary-800 disabled:opacity-30 transition"
              >
                {commentLoading ? '...' : 'Skicka'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
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
