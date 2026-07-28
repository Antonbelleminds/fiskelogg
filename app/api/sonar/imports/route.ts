import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'
import {
  formatForExtension,
  sonarImporterPlugins,
} from '@/lib/sonar/importers/registry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const importRequestSchema = z.object({
  sourceKind: z.enum(['files', 'folder', 'zip', 'sd_card']).default('files'),
  deviceTimezone: z.string().min(1).max(100),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        relativePath: z.string().min(1).max(1_024),
        size: z.number().int().nonnegative().max(53_687_091_200),
        type: z.string().max(255).optional().default('application/octet-stream'),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
    )
    .min(1)
    .max(2_000),
})

function safeFileName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'sonar-file'
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone }).format()
    return true
  } catch {
    return false
  }
}

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('sonar_import_jobs')
    .select(
      `id, status, source_kind, device_timezone, manufacturer, detected_model,
       files_total, files_completed, bytes_total, bytes_uploaded, points_total,
       points_imported, invalid_records, error_count, current_stage, error_summary,
       created_at, started_at, completed_at,
       sonar_import_files (
         id, original_name, relative_path, byte_size, status, detected_format,
         parser_plugin, record_count, processed_records, imported_points,
         invalid_records, error_code, error_message
       )`
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Sonar imports list failed:', error)
    return NextResponse.json(
      { error: 'Kunde inte läsa importer' },
      { status: 500 }
    )
  }

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  let parsed: z.infer<typeof importRequestSchema>
  try {
    parsed = importRequestSchema.parse(await request.json())
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Ogiltigt importunderlag',
        details: error instanceof z.ZodError ? error.flatten() : undefined,
      },
      { status: 400 }
    )
  }

  if (!isValidTimeZone(parsed.deviceTimezone)) {
    return NextResponse.json({ error: 'Ogiltig tidszon' }, { status: 400 })
  }

  const deduplicatedManifest = Array.from(
    new Map(parsed.files.map((file) => [file.sha256, file])).values()
  )
  const recognized = deduplicatedManifest.map((file) => ({
    file,
    format: formatForExtension(file.name),
  }))
  if (recognized.some((entry) => !entry.format)) {
    return NextResponse.json(
      { error: 'En eller flera filer har ett okänt ekolodsformat.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const hashes = recognized.map((entry) => entry.file.sha256)
  const existingByHash = new Map<string, string>()
  const activeByHash = new Map<
    string,
    {
      id: string
      job_id: string
      status: string
      storage_path: string | null
    }
  >()

  for (let offset = 0; offset < hashes.length; offset += 100) {
    const hashBatch = hashes.slice(offset, offset + 100)
    const [completedResult, activeResult] = await Promise.all([
      admin
        .from('sonar_import_files')
        .select('id, sha256')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .in('sha256', hashBatch),
      admin
        .from('sonar_import_files')
        .select('id, job_id, sha256, status, storage_path')
        .eq('user_id', user.id)
        .in('status', ['pending_upload', 'uploading', 'uploaded', 'parsing'])
        .in('sha256', hashBatch),
    ])

    if (completedResult.error || activeResult.error) {
      console.error(
        'Sonar duplicate lookup failed:',
        completedResult.error ?? activeResult.error
      )
      return NextResponse.json(
        { error: 'Kunde inte kontrollera dubbletter' },
        { status: 500 }
      )
    }
    for (const file of completedResult.data ?? []) {
      existingByHash.set(file.sha256, file.id)
    }
    for (const file of activeResult.data ?? []) {
      if (!activeByHash.has(file.sha256)) {
        activeByHash.set(file.sha256, file)
      }
    }
  }

  const activeJobIds = new Set(
    recognized
      .map((entry) => activeByHash.get(entry.file.sha256)?.job_id)
      .filter((jobId): jobId is string => Boolean(jobId))
  )
  if (
    activeJobIds.size === 1 &&
    recognized.every(
      (entry) =>
        existingByHash.has(entry.file.sha256) ||
        activeByHash.get(entry.file.sha256)?.job_id ===
          Array.from(activeJobIds)[0]
    )
  ) {
    const activeJobId = Array.from(activeJobIds)[0]
    const { data: activeJob } = await admin
      .from('sonar_import_jobs')
      .select('status')
      .eq('id', activeJobId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (
      activeJob &&
      !['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(
        activeJob.status
      )
    ) {
      return NextResponse.json({
        jobId: activeJobId,
        bucket: 'sonar-imports',
        resumed: true,
        files: recognized.map((entry) => {
          const active = activeByHash.get(entry.file.sha256)
          return active?.job_id === activeJobId
            ? {
                id: active.id,
                sha256: entry.file.sha256,
                status: active.status,
                storagePath: active.storage_path,
                errorMessage: null,
              }
            : {
                id: existingByHash.get(entry.file.sha256)!,
                sha256: entry.file.sha256,
                status: 'duplicate',
                storagePath: null,
                errorMessage: null,
              }
        }),
      })
    }
  }

  const jobId = crypto.randomUUID()
  const fileRows = recognized.map(({ file, format }) => {
    const fileId = crypto.randomUUID()
    const plugin = sonarImporterPlugins.find(
      (candidate) => candidate.id === format!.pluginId
    )
    const duplicateId = existingByHash.get(file.sha256)
    const status = duplicateId
      ? 'duplicate'
      : format!.implemented
        ? 'pending_upload'
        : 'unsupported'

    return {
      id: fileId,
      job_id: jobId,
      user_id: user.id,
      deduplicates_file_id: duplicateId ?? null,
      original_name: file.name,
      relative_path: file.relativePath,
      extension: format!.extension,
      media_type: file.type || 'application/octet-stream',
      byte_size: file.size,
      sha256: file.sha256,
      storage_path:
        status === 'pending_upload'
          ? `${user.id}/${jobId}/${fileId}/${safeFileName(file.name)}`
          : null,
      status,
      manufacturer: format!.manufacturer,
      detected_format: format!.format,
      parser_plugin: plugin?.id ?? null,
      parser_version: plugin?.version ?? null,
      error_code: status === 'unsupported' ? 'PARSER_NOT_INSTALLED' : null,
      error_message:
        status === 'unsupported'
          ? `Formatet ${format!.format} är registrerat men parsern är ännu inte aktiverad.`
          : null,
      completed_at:
        status === 'duplicate' || status === 'unsupported'
          ? new Date().toISOString()
          : null,
    }
  })

  const bytesToUpload = fileRows
    .filter((file) => file.status === 'pending_upload')
    .reduce((sum, file) => sum + file.byte_size, 0)

  const { error: jobError } = await admin.from('sonar_import_jobs').insert({
    id: jobId,
    user_id: user.id,
    status: bytesToUpload > 0 ? 'uploading' : 'queued',
    source_kind: parsed.sourceKind,
    device_timezone: parsed.deviceTimezone,
    files_total: fileRows.length,
    files_completed: fileRows.filter((file) =>
      ['duplicate', 'unsupported'].includes(file.status)
    ).length,
    bytes_total: bytesToUpload,
    current_stage: bytesToUpload > 0 ? 'Laddar upp filer' : 'Redo att bearbeta',
  })

  if (jobError) {
    console.error('Sonar job create failed:', jobError)
    return NextResponse.json(
      { error: 'Kunde inte skapa importjobbet' },
      { status: 500 }
    )
  }

  const { error: filesError } = await admin
    .from('sonar_import_files')
    .insert(fileRows)

  if (filesError) {
    await admin
      .from('sonar_import_jobs')
      .delete()
      .eq('id', jobId)
      .eq('user_id', user.id)
    console.error('Sonar file manifest failed:', filesError)
    return NextResponse.json(
      { error: 'Kunde inte registrera filerna' },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      jobId,
      bucket: 'sonar-imports',
      files: fileRows.map((file) => ({
        id: file.id,
        sha256: file.sha256,
        status: file.status,
        storagePath: file.storage_path,
        errorMessage: file.error_message,
      })),
    },
    { status: 201 }
  )
}
