'use client'

import { useCallback, useState } from 'react'
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
  high: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
} as const

function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export default function AiFishingAnalysis() {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
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

  function toggleAnalysis() {
    const next = !open
    setOpen(next)
    if (next && !result && !loading) {
      void loadAnalysis()
    }
  }

  return (
    <section className="mb-4 rounded-xl bg-sky-50 p-4 dark:bg-sky-950/30">
      <button
        type="button"
        onClick={toggleAnalysis}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left group"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200">
          <SparklesIcon />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">
            AI-analys
          </span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400">
            Fångster och ekolodsdata
          </span>
        </span>
        <span className="text-[10px] text-slate-400 transition group-hover:text-slate-600 dark:group-hover:text-slate-200">
          {open ? 'Dölj' : 'Analysera'}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="mt-4 border-t border-sky-100 pt-4 dark:border-sky-900/70">
          {loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-4/5 rounded bg-sky-100 dark:bg-sky-900" />
              <div className="h-3 w-full rounded bg-sky-100 dark:bg-sky-900" />
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-14 rounded-xl bg-white dark:bg-slate-800"
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-xs text-rose-700 dark:text-rose-200">{error}</p>
              <button
                type="button"
                onClick={() => void loadAnalysis()}
                className="mt-2 text-xs font-semibold text-rose-800 underline underline-offset-2 dark:text-rose-100"
              >
                Försök igen
              </button>
            </div>
          )}

          {!loading && result && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold leading-tight text-slate-900 dark:text-white">
                    {result.analysis.headline}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {result.analysis.summary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadAnalysis(true)}
                  disabled={refreshing}
                  aria-label="Uppdatera AI-analysen"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-700 transition hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-slate-800 dark:text-sky-200"
                >
                  <span className={refreshing ? 'animate-spin' : ''}>
                    <RefreshIcon />
                  </span>
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
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

              <div className="mt-3 space-y-2">
                {result.analysis.findings.map((finding) => (
                  <article
                    key={`${finding.title}-${finding.evidence}`}
                    className="rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/70 dark:bg-slate-800"
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <h3 className="text-xs font-semibold leading-snug text-slate-900 dark:text-white">
                        {finding.title}
                      </h3>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${confidenceClass[finding.confidence]}`}
                      >
                        {confidenceLabel[finding.confidence]}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {finding.insight}
                    </p>
                    <p className="mt-2 border-l-2 border-sky-300 pl-2 text-[10px] leading-relaxed text-sky-800 dark:text-sky-200">
                      {finding.evidence}
                    </p>
                  </article>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowDetails((visible) => !visible)}
                aria-expanded={showDetails}
                className="mt-3 flex w-full items-center justify-between rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-sky-100 dark:border-sky-900/70 dark:bg-slate-800 dark:text-slate-200"
              >
                <span>Nästa test och analysens gränser</span>
                <ChevronIcon open={showDetails} />
              </button>

              {showDetails && (
                <div className="mt-2 space-y-3 rounded-xl border border-sky-100 bg-white p-3 dark:border-sky-900/70 dark:bg-slate-800">
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-200">
                      Testa härnäst
                    </p>
                    <div className="space-y-2">
                      {result.analysis.nextActions.map((item, index) => (
                        <div key={`${item.title}-${index}`} className="flex gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-900 dark:text-sky-200">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-slate-900 dark:text-white">
                              {item.title}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                              {item.action}
                            </p>
                            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                              {item.why}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {result.analysis.limitations.length > 0 && (
                    <div className="border-t border-sky-100 pt-3 dark:border-sky-900/70">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                        Bra att veta
                      </p>
                      <ul className="space-y-1 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
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
                {result.meta.source === 'ai'
                  ? 'AI-tolkning'
                  : 'Beräknad reservanalys'}
                {' · Privat för ditt konto'}
                {result.meta.cached ? ' · Sparad analys' : ''}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function DataStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-sky-100 bg-white px-2 py-2.5 text-center dark:border-sky-900/70 dark:bg-slate-800">
      <p className="text-base font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
    </div>
  )
}

function SparklesIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
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
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7v5h-5M4 17v-5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.1 8.3A7 7 0 0 1 18.7 7M17.9 15.7A7 7 0 0 1 5.3 17" />
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
