'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FishingAiResult } from '@/lib/ai/fishing-analysis'

interface AnalysisMeta {
  source: 'ai' | 'calculated'
  model: string
  generatedAt: string
  cached: boolean
  dataQuality: {
    catchesAnalyzed: number
    sonarPoints: number
    matchedCatches: number
    encryptedLocationCatches: number
    canCompareCatchLocationsToSonar: boolean
    bottomSignalIsBeta: boolean
    vegetationSignalIsBeta: boolean
  }
}

interface AnalysisResponse {
  analysis: FishingAiResult
  meta: AnalysisMeta
}

const confidenceLabel = {
  high: 'Starkt stöd',
  medium: 'Visst stöd',
  low: 'Tidigt mönster',
} as const

const confidenceClass = {
  high: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
} as const

function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export default function AiFishingAnalysis() {
  const [result, setResult] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showDetails, setShowDetails] = useState(false)

  const loadAnalysis = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/stats/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!response.ok) throw new Error('analysis_failed')
      setResult(await response.json())
    } catch {
      setError('Analysen kunde inte laddas just nu. Försök igen om en stund.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnalysis()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAnalysis])

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-primary-200/70 bg-gradient-to-br from-primary-950 via-primary-900 to-slate-900 text-white shadow-lg dark:border-primary-800">
      <div className="relative px-4 pb-4 pt-5">
        <div className="pointer-events-none absolute -right-14 -top-20 h-40 w-40 rounded-full bg-sky-400/15 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10">
                <SparklesIcon />
              </span>
              AI-analys
            </div>
            <h2 className="text-lg font-bold leading-tight">
              {result?.analysis.headline ?? 'Fångster × ekolodsdata'}
            </h2>
          </div>
          {result && (
            <button
              type="button"
              onClick={() => void loadAnalysis(true)}
              disabled={refreshing}
              aria-label="Uppdatera AI-analysen"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-sky-100 transition hover:bg-white/15 disabled:opacity-50"
            >
              <span className={refreshing ? 'animate-spin' : ''}>
                <RefreshIcon />
              </span>
            </button>
          )}
        </div>

        {loading && (
          <div className="mt-5 space-y-3 animate-pulse">
            <div className="h-3 w-full rounded bg-white/15" />
            <div className="h-3 w-4/5 rounded bg-white/15" />
            <div className="grid grid-cols-3 gap-2 pt-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-14 rounded-xl bg-white/10" />
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3">
            <p className="text-sm text-rose-100">{error}</p>
            <button
              type="button"
              onClick={() => void loadAnalysis()}
              className="mt-2 text-xs font-semibold text-white underline underline-offset-2"
            >
              Försök igen
            </button>
          </div>
        )}

        {!loading && result && (
          <>
            <p className="mt-3 text-sm leading-relaxed text-slate-200">
              {result.analysis.summary}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <DataStat
                value={formatNumber(result.meta.dataQuality.catchesAnalyzed)}
                label="fångster"
              />
              <DataStat
                value={formatNumber(result.meta.dataQuality.sonarPoints)}
                label="sonarpunkter"
              />
              <DataStat
                value={formatNumber(result.meta.dataQuality.matchedCatches)}
                label="platsmatchade"
              />
            </div>

            <div className="mt-4 space-y-2.5">
              {result.analysis.findings.map((finding) => (
                <article
                  key={`${finding.title}-${finding.evidence}`}
                  className="rounded-xl border border-white/10 bg-white/[0.07] p-3 backdrop-blur-sm"
                >
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold leading-snug text-white">
                      {finding.title}
                    </h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${confidenceClass[finding.confidence]}`}>
                      {confidenceLabel[finding.confidence]}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-200">{finding.insight}</p>
                  <p className="mt-2 border-l-2 border-sky-300/50 pl-2 text-[11px] leading-relaxed text-sky-100">
                    {finding.evidence}
                  </p>
                </article>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowDetails((open) => !open)}
              aria-expanded={showDetails}
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-left text-xs font-semibold text-slate-100 transition hover:bg-white/5"
            >
              <span>Nästa test och analysens gränser</span>
              <ChevronIcon open={showDetails} />
            </button>

            {showDetails && (
              <div className="mt-2 space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                    Testa härnäst
                  </p>
                  <div className="space-y-2">
                    {result.analysis.nextActions.map((item, index) => (
                      <div key={`${item.title}-${index}`} className="flex gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-300/15 text-[10px] font-bold text-sky-100">
                          {index + 1}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-white">{item.title}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-200">{item.action}</p>
                          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{item.why}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {result.analysis.limitations.length > 0 && (
                  <div className="border-t border-white/10 pt-3">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      Bra att veta
                    </p>
                    <ul className="space-y-1 text-[10px] leading-relaxed text-slate-400">
                      {result.analysis.limitations.map((limitation) => (
                        <li key={limitation} className="flex gap-1.5">
                          <span aria-hidden="true">•</span>
                          <span>{limitation}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <p className="mt-3 text-center text-[9px] text-slate-400">
              {result.meta.source === 'ai' ? 'AI-tolkning' : 'Beräknad reservanalys'}
              {' · '}
              Privat för ditt konto
              {result.meta.cached ? ' · Sparad analys' : ''}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

function DataStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.07] px-2 py-2.5 text-center">
      <p className="text-base font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

function SparklesIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.8 3.6c.3-1 1.7-1 2 0l.8 2.6c.4 1.2 1.3 2.1 2.5 2.5l2.7.8c1 .3 1 1.7 0 2l-2.7.8a4 4 0 0 0-2.5 2.5l-.8 2.7c-.3 1-1.7 1-2 0L9 14.8a4 4 0 0 0-2.5-2.5l-2.7-.8c-1-.3-1-1.7 0-2l2.7-.8A4 4 0 0 0 9 6.2l.8-2.6Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.5 16 .3 1.1c.2.7.8 1.3 1.5 1.5l1.1.3-1.1.4c-.7.2-1.3.8-1.5 1.5l-.3 1.1-.4-1.1a2.3 2.3 0 0 0-1.5-1.5l-1.1-.4 1.1-.3c.7-.2 1.3-.8 1.5-1.5l.4-1.1Z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7v5h-5M4 17v-5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.1 8.3A7 7 0 0 1 18.7 7M17.9 15.7A7 7 0 0 1 5.3 17" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  )
}
