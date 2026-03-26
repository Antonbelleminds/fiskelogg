'use client'

import { useState, useEffect, useCallback } from 'react'
import CatchCard from '@/components/catches/CatchCard'
import CatchFilters from '@/components/catches/CatchFilters'
import type { CatchWithProfile } from '@/types/database'

export default function LoggbokPage() {
  const [catches, setCatches] = useState<CatchWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [filters, setFilters] = useState({ species: '', method: '', sort: 'caught_at' })

  const fetchCatches = useCallback(async (pageNum: number, reset = false) => {
    setLoading(true)
    const params = new URLSearchParams({
      page: pageNum.toString(),
      limit: '20',
      sort: filters.sort,
    })
    if (filters.species) params.set('species', filters.species)
    if (filters.method) params.set('method', filters.method)

    const res = await fetch(`/api/catches?${params}`)
    if (res.ok) {
      const data = await res.json()
      const arr = Array.isArray(data) ? data : []
      setCatches(prev => reset ? arr : [...prev, ...arr])
      setHasMore(arr.length === 20)
    }
    setLoading(false)
  }, [filters])

  useEffect(() => {
    setPage(0)
    fetchCatches(0, true)
  }, [fetchCatches])

  function loadMore() {
    const next = page + 1
    setPage(next)
    fetchCatches(next)
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Loggbok</h1>

      <CatchFilters onFilterChange={setFilters} />

      {loading && catches.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-slate-200 dark:bg-slate-700" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : catches.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🎣</div>
          <h2 className="text-lg font-medium mb-1">Inga fångster ännu</h2>
          <p className="text-sm text-slate-500">Tryck på + för att logga din första fångst!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {catches.map((c) => (
            <CatchCard key={c.id} catch={c} />
          ))}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full py-3 text-sm text-primary-700 font-medium hover:bg-primary-50 rounded-xl transition"
            >
              {loading ? 'Laddar...' : 'Visa fler'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
