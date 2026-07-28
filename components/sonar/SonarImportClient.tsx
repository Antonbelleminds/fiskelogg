'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  displayManufacturer,
  formatForExtension,
} from '@/lib/sonar/importers/registry'
import {
  hashSonarFile,
  prepareSonarSelection,
  type PreparedSonarSelection,
  type SelectedSonarFile,
} from '@/lib/sonar/client-files'
import { uploadSonarFile } from '@/lib/sonar/tus-upload'

interface ImportFileStatus {
  id: string
  original_name: string
  relative_path: string
  byte_size: number
  status: string
  detected_format: string | null
  parser_plugin: string | null
  record_count: number
  processed_records: number
  imported_points: number
  invalid_records: number
  error_code: string | null
  error_message: string | null
}

interface ImportJob {
  id: string
  status: string
  source_kind: string
  manufacturer: string | null
  files_total: number
  files_completed: number
  bytes_total: number
  bytes_uploaded: number
  points_total: number
  points_imported: number
  invalid_records: number
  error_count: number
  current_stage: string | null
  error_summary: string | null
  created_at: string
  completed_at: string | null
  sonar_import_files: ImportFileStatus[]
}

interface ManifestResponse {
  jobId: string
  bucket: string
  files: Array<{
    id: string
    sha256: string
    status: string
    storagePath: string | null
    errorMessage: string | null
  }>
}

type UiStage =
  | 'idle'
  | 'preparing'
  | 'hashing'
  | 'uploading'
  | 'queued'
  | 'error'

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('sv-SE').format(value)
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    preparing: 'Förbereder',
    uploading: 'Laddar upp',
    queued: 'Köad',
    parsing: 'Läser filer',
    deriving: 'Bygger djupkarta',
    matching: 'Matchar fångster',
    completed: 'Klar',
    completed_with_errors: 'Klar med varningar',
    failed: 'Misslyckad',
    cancelled: 'Avbruten',
    duplicate: 'Redan importerad',
    unsupported: 'Parser saknas',
  }
  return labels[status] ?? status
}

function isActiveJob(status: string) {
  return ['preparing', 'uploading', 'queued', 'parsing', 'deriving', 'matching'].includes(
    status
  )
}

export default function SonarImportClient() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<PreparedSonarSelection | null>(null)
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [stage, setStage] = useState<UiStage>('idle')
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [deviceTimezone, setDeviceTimezone] = useState('Europe/Stockholm')
  const [resumingJobId, setResumingJobId] = useState<string | null>(null)

  useEffect(() => {
    setDeviceTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Stockholm'
    )
  }, [])

  const loadJobs = useCallback(async () => {
    const response = await fetch('/api/sonar/imports', { cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json()
    if (Array.isArray(data)) setJobs(data)
  }, [])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  useEffect(() => {
    if (!jobs.some((job) => isActiveJob(job.status))) return
    const timer = window.setInterval(loadJobs, 2_500)
    return () => window.clearInterval(timer)
  }, [jobs, loadJobs])

  const totalBytes = useMemo(
    () =>
      selection?.files.reduce((sum, selected) => sum + selected.file.size, 0) ??
      0,
    [selection]
  )

  async function selectFiles(files: File[]) {
    setStage('preparing')
    setMessage('Läser filstrukturen…')
    setProgress(0)
    try {
      const prepared = await prepareSonarSelection(files)
      if (prepared.files.length === 0) {
        throw new Error(
          'Inga stödda sonarloggar hittades. På Humminbird-kort väljer du hela SD-kortet eller mappen ACDATA med .ACU-filerna.'
        )
      }
      setSelection(prepared)
      setMessage(
        prepared.ignoredFiles > 0
          ? `${prepared.ignoredFiles} irrelevanta filer ignorerades.`
          : ''
      )
      setStage('idle')
    } catch (error) {
      setStage('error')
      setMessage(error instanceof Error ? error.message : 'Kunde inte läsa filerna.')
    }
  }

  async function startImport() {
    if (!selection || selection.files.length === 0) return
    setStage('hashing')
    setMessage('Skapar säkra fingeravtryck för dubblettkontroll…')
    setProgress(0)

    try {
      const hashed: Array<SelectedSonarFile & { sha256: string }> = []
      let completedBytes = 0

      for (const selected of selection.files) {
        const sha256 = await hashSonarFile(selected.file, (processed) => {
          setProgress(
            totalBytes > 0
              ? Math.round(((completedBytes + processed) / totalBytes) * 100)
              : 100
          )
        })
        completedBytes += selected.file.size
        hashed.push({ ...selected, sha256 })
      }

      const manifestResponse = await fetch('/api/sonar/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKind: selection.sourceKind,
          deviceTimezone,
          files: hashed.map((entry) => ({
            name: entry.file.name,
            relativePath: entry.relativePath,
            size: entry.file.size,
            type: entry.file.type,
            sha256: entry.sha256,
          })),
        }),
      })
      const manifestBody = await manifestResponse.json()
      if (!manifestResponse.ok) {
        throw new Error(manifestBody.error || 'Kunde inte skapa importjobbet.')
      }
      const manifest = manifestBody as ManifestResponse
      const byHash = new Map(hashed.map((entry) => [entry.sha256, entry]))
      const uploadEntries = manifest.files.filter(
        (entry) => entry.status === 'pending_upload' && entry.storagePath
      )
      const uploadTotal = uploadEntries.reduce(
        (sum, entry) => sum + (byHash.get(entry.sha256)?.file.size ?? 0),
        0
      )
      let uploadedBeforeCurrent = 0

      setStage('uploading')
      setMessage('Laddar upp direkt till privat lagring…')
      setProgress(uploadTotal === 0 ? 100 : 0)

      for (const manifestFile of uploadEntries) {
        const selected = byHash.get(manifestFile.sha256)
        if (!selected || !manifestFile.storagePath) continue

        await uploadSonarFile({
          bucket: manifest.bucket,
          storagePath: manifestFile.storagePath,
          file: selected.file,
          onProgress(uploaded) {
            setProgress(
              uploadTotal > 0
                ? Math.round(
                    ((uploadedBeforeCurrent + uploaded) / uploadTotal) * 100
                  )
                : 100
            )
          },
        })

        const completeResponse = await fetch(
          `/api/sonar/imports/${manifest.jobId}/files/${manifestFile.id}/complete`,
          { method: 'POST' }
        )
        if (!completeResponse.ok) {
          const body = await completeResponse.json()
          throw new Error(body.error || 'Kunde inte bekräfta uppladdningen.')
        }
        uploadedBeforeCurrent += selected.file.size
      }

      const startResponse = await fetch(
        `/api/sonar/imports/${manifest.jobId}/start`,
        { method: 'POST' }
      )
      const startBody = await startResponse.json()
      if (!startResponse.ok) {
        throw new Error(startBody.error || 'Kunde inte starta bakgrundsjobbet.')
      }

      setStage('queued')
      setProgress(100)
      setMessage(
        'Importen kör nu i bakgrunden. Du kan lämna sidan och komma tillbaka.'
      )
      setSelection(null)
      await loadJobs()
    } catch (error) {
      setStage('error')
      setMessage(error instanceof Error ? error.message : 'Importen misslyckades.')
      await loadJobs()
    }
  }

  async function resumeImport(jobId: string) {
    setResumingJobId(jobId)
    setMessage('Återupptar importen från senast sparade block…')
    try {
      const response = await fetch(`/api/sonar/imports/${jobId}/start`, {
        method: 'POST',
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || 'Kunde inte återuppta importen.')
      }
      setMessage('Importen har återupptagits i bakgrunden.')
      await loadJobs()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Kunde inte återuppta importen.'
      )
    } finally {
      setResumingJobId(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4">
          <h2 className="font-semibold">Välj SD-kort eller filer</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ACU och INDEX.AIC stöds nu. Kända Garmin-, Lowrance- och
            Raymarine-format registreras och får egna parserplugins framöver.
          </p>
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            selectFiles(Array.from(event.dataTransfer.files))
          }}
          className={`rounded-2xl border-2 border-dashed px-5 py-8 text-center transition ${
            dragging
              ? 'border-primary-700 bg-primary-50 dark:bg-slate-700'
              : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40'
          }`}
        >
          <svg
            className="mx-auto h-10 w-10 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
            />
          </svg>
          <p className="mt-3 text-sm font-medium">Dra filer eller en ZIP hit</p>
          <p className="mt-1 text-xs text-slate-500">
            För stora SD-kort: välj mappen direkt för strömmande uppladdning.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"
            >
              Välj SD-kort/mapp
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium dark:border-slate-600 dark:bg-slate-800"
            >
              Välj filer eller ZIP
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            multiple
            accept=".zip,.acu,.aic,.acd,.ht,.son,.dat,.adm,.gpx,.fit,.sl2,.sl3,.usr,.sdf,.bin,.log"
            onChange={(event) =>
              selectFiles(Array.from(event.target.files ?? []))
            }
          />
          <input
            ref={folderInputRef}
            className="hidden"
            type="file"
            multiple
            {...({
              webkitdirectory: '',
              directory: '',
            } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={(event) =>
              selectFiles(Array.from(event.target.files ?? []))
            }
          />
        </div>

        {selection && (
          <div className="mt-4 space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
              <div>
                <div className="text-sm font-medium">
                  {selection.files.length} relevanta filer · {formatBytes(totalBytes)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Källa: {selection.sourceKind === 'sd_card' ? 'SD-kort' : selection.sourceKind}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="text-xs text-slate-500 underline"
              >
                Rensa
              </button>
            </div>

            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
              {selection.files.map((entry) => {
                const format = formatForExtension(entry.file.name)
                return (
                  <div
                    key={`${entry.relativePath}-${entry.file.size}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{entry.relativePath}</div>
                      <div className="text-slate-500">
                        {format
                          ? `${displayManufacturer(format.manufacturer)} · ${format.format}`
                          : 'Okänt format'}
                      </div>
                    </div>
                    <span className="shrink-0 text-slate-500">
                      {formatBytes(entry.file.size)}
                    </span>
                  </div>
                )
              })}
            </div>

            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Ekolodets tidszon
              <input
                value={deviceTimezone}
                onChange={(event) => setDeviceTimezone(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </label>

            <button
              type="button"
              onClick={startImport}
              disabled={stage !== 'idle'}
              className="w-full rounded-xl bg-primary-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Importera och bygg djupkarta
            </button>
          </div>
        )}

        {(stage !== 'idle' || message) && (
          <div
            className={`mt-4 rounded-xl p-3 text-sm ${
              stage === 'error'
                ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                : 'bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-200'
            }`}
          >
            {message}
            {['hashing', 'uploading'].includes(stage) && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-primary-700 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Importhistorik</h2>
          <button
            type="button"
            onClick={loadJobs}
            className="text-xs text-slate-500 underline"
          >
            Uppdatera
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
            Inga ekolodsimporter ännu.
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const pointProgress =
                job.points_total > 0
                  ? Math.min(100, (job.points_imported / job.points_total) * 100)
                  : job.files_total > 0
                    ? Math.min(100, (job.files_completed / job.files_total) * 100)
                    : 0
              return (
                <article
                  key={job.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {job.status === 'completed_with_errors' &&
                        job.points_imported === 0
                          ? 'Ingen djupdata importerad'
                          : statusLabel(job.status)}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {new Date(job.created_at).toLocaleString('sv-SE')} ·{' '}
                        {job.files_total} filer
                      </div>
                    </div>
                    {job.status === 'failed' &&
                    job.sonar_import_files.some((file) =>
                      ['uploaded', 'parsing'].includes(file.status)
                    ) ? (
                      <button
                        type="button"
                        onClick={() => resumeImport(job.id)}
                        disabled={resumingJobId !== null}
                        className="rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {resumingJobId === job.id
                          ? 'Återupptar…'
                          : 'Återuppta'}
                      </button>
                    ) : ['completed', 'completed_with_errors'].includes(
                        job.status
                      ) && job.points_imported > 0 ? (
                      <Link
                        href="/karta?djupkarta=1"
                        className="rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Visa karta
                      </Link>
                    ) : null}
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div
                      className={`h-full rounded-full transition-all ${
                        job.status === 'failed' ? 'bg-red-500' : 'bg-primary-700'
                      }`}
                      style={{
                        width: `${['completed', 'completed_with_errors'].includes(job.status) ? 100 : pointProgress}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-xs text-slate-500">
                    <span>{job.current_stage || statusLabel(job.status)}</span>
                    <span>{formatNumber(job.points_imported)} punkter</span>
                  </div>

                  {(job.error_summary || job.error_count > 0) && (
                    <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                      {job.error_summary ||
                        (job.points_imported === 0
                          ? 'Inga stödda sonarloggar hittades. För Humminbird: välj hela SD-kortet eller ACDATA-mappen med .ACU-filer.'
                          : `${job.error_count} fil(er) kunde inte läsas. Övrig data sparades.`)}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-slate-100 p-4 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Råfiler lagras privat. Korrupta poster hoppas över och rapporteras. Befintliga
        fångstfält ändras aldrig; matchad ekolodsdata sparas som en separat
        anrikning. Fiskepin-krypterade positioner matchas inte på servern.
      </section>
    </div>
  )
}
