'use client'

import { useState } from 'react'

interface FiltersProps {
  onFilterChange: (filters: {
    species: string
    method: string
    lure_type: string
    sort: string
  }) => void
}

const SPECIES = ['Abborre', 'Gädda', 'Gös', 'Öring', 'Lax', 'Regnbåge', 'Röding', 'Harr', 'Lake', 'Havsöring', 'Sik', 'Braxen', 'Mört', 'Torsk', 'Makrill', 'Annat']
const METHODS = ['Kastfiske', 'Trolling', 'Mete', 'Flugfiske', 'Isfiske', 'Jiggning']
const LURE_TYPES = ['Wobbler', 'Jig', 'Skeddrag', 'Spinner', 'Fluga', 'Mask', 'Räka', 'Annat']

export default function CatchFilters({ onFilterChange }: FiltersProps) {
  const [species, setSpecies] = useState('')
  const [method, setMethod] = useState('')
  const [lureType, setLureType] = useState('')
  const [sort, setSort] = useState('caught_at')
  const [open, setOpen] = useState(false)

  function update(updates: Partial<{ species: string; method: string; lure_type: string; sort: string }>) {
    const next = { species, method, lure_type: lureType, sort, ...updates }
    if (updates.species !== undefined) setSpecies(updates.species)
    if (updates.method !== undefined) setMethod(updates.method)
    if (updates.lure_type !== undefined) setLureType(updates.lure_type)
    if (updates.sort !== undefined) setSort(updates.sort)
    onFilterChange(next)
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        {/* Sort chips */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1">
          {[
            { value: 'caught_at', label: 'Senaste' },
            { value: 'weight', label: 'Tyngsta' },
            { value: 'species', label: 'Art A-Ö' },
          ].map((s) => (
            <button
              key={s.value}
              onClick={() => update({ sort: s.value })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                sort === s.value
                  ? 'bg-primary-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setOpen(!open)}
          className={`p-2 rounded-lg transition ${
            (species || method || lureType) ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Art</label>
            <select
              value={species}
              onChange={(e) => update({ species: e.target.value })}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">Alla arter</option>
              {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Metod</label>
            <select
              value={method}
              onChange={(e) => update({ method: e.target.value })}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">Alla metoder</option>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Betetyp</label>
            <select
              value={lureType}
              onChange={(e) => update({ lure_type: e.target.value })}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">Alla beten</option>
              {LURE_TYPES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {(species || method || lureType) && (
            <button
              onClick={() => update({ species: '', method: '', lure_type: '' })}
              className="text-xs text-primary-700 font-medium"
            >
              Rensa filter
            </button>
          )}
        </div>
      )}
    </div>
  )
}
