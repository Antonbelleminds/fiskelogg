import { FatalError } from 'workflow'
import { createAdminClient } from '@/lib/supabase/server'
import { detectSonarImporter } from '@/lib/sonar/importers/registry'
import type {
  SonarFileDescriptor,
  SonarParsedHeader,
} from '@/lib/sonar/types'

const STORAGE_BUCKET = 'sonar-imports'
const RECORDS_PER_STEP = 5_000

interface ImportFileRow {
  id: string
  job_id: string
  user_id: string
  survey_id: string | null
  original_name: string
  relative_path: string
  extension: string
  byte_size: number
  storage_path: string | null
  status: string
  record_count: number
  processed_records: number
  header: Record<string, unknown>
}

interface ChunkResult {
  hasMore: boolean
  points: number
}

async function updateJobStage(
  jobId: string,
  userId: string,
  status: string,
  currentStage: string
) {
  'use step'

  const admin = createAdminClient()
  const { error } = await admin
    .from('sonar_import_jobs')
    .update({
      status,
      current_stage: currentStage,
      started_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)

  if (error) throw new Error(`JOB_STAGE_UPDATE_FAILED:${error.message}`)
}

async function refreshJobStats(jobId: string, userId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('sonar_import_files')
    .select(
      'status, byte_size, record_count, imported_points, invalid_records, manufacturer'
    )
    .eq('job_id', jobId)
    .eq('user_id', userId)

  if (error) throw new Error(`JOB_STATS_FAILED:${error.message}`)

  const files = data ?? []
  const terminalStatuses = new Set([
    'completed',
    'duplicate',
    'ignored',
    'unsupported',
    'failed',
  ])
  const uploadedStatuses = new Set([
    'uploaded',
    'parsing',
    'completed',
    'ignored',
  ])
  const manufacturers = Array.from(
    new Set(
      files
        .map((file) => file.manufacturer)
        .filter((manufacturer): manufacturer is string => Boolean(manufacturer))
    )
  )

  const { error: updateError } = await admin
    .from('sonar_import_jobs')
    .update({
      files_completed: files.filter((file) =>
        terminalStatuses.has(file.status)
      ).length,
      bytes_uploaded: files
        .filter((file) => uploadedStatuses.has(file.status))
        .reduce((sum, file) => sum + Number(file.byte_size), 0),
      points_total: files.reduce(
        (sum, file) => sum + Number(file.record_count),
        0
      ),
      points_imported: files.reduce(
        (sum, file) => sum + Number(file.imported_points),
        0
      ),
      invalid_records: files.reduce(
        (sum, file) => sum + Number(file.invalid_records),
        0
      ),
      error_count: files.filter((file) =>
        ['failed', 'unsupported'].includes(file.status)
      ).length,
      manufacturer:
        manufacturers.length === 1 ? manufacturers[0] : manufacturers.length > 1 ? 'mixed' : null,
    })
    .eq('id', jobId)
    .eq('user_id', userId)

  if (updateError) throw new Error(`JOB_STATS_UPDATE_FAILED:${updateError.message}`)
}

async function downloadRange(
  storagePath: string,
  fileSize: number,
  start: number,
  end: number
) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 300)

  if (error || !data?.signedUrl) {
    throw new Error(`STORAGE_SIGN_FAILED:${error?.message ?? 'No URL'}`)
  }

  const response = await fetch(data.signedUrl, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`STORAGE_RANGE_FAILED:${response.status}`)
  }

  const received = new Uint8Array(await response.arrayBuffer())
  const expectedLength = end - start + 1

  if (received.byteLength === expectedLength) return received
  if (response.status === 200 && received.byteLength === fileSize) {
    return received.subarray(start, end + 1)
  }

  throw new Error(
    `STORAGE_RANGE_LENGTH:${received.byteLength}:${expectedLength}`
  )
}

function boundsPolygonWkt(header: SonarParsedHeader) {
  const { west, south, east, north } = header.bounds
  return `SRID=4326;POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`
}

async function initializePointFile(file: ImportFileRow) {
  if (!file.storage_path) throw new FatalError('Filens lagringssökväg saknas')

  const admin = createAdminClient()
  const prefixEnd = Math.min(file.byte_size - 1, 95)
  const prefix = await downloadRange(
    file.storage_path,
    Number(file.byte_size),
    0,
    prefixEnd
  )
  const descriptor: SonarFileDescriptor = {
    name: file.original_name,
    relativePath: file.relative_path,
    size: Number(file.byte_size),
  }
  const detected = detectSonarImporter(descriptor, prefix)

  if (!detected || detected.probe.capability === 'unsupported') {
    throw new FatalError('Filformatet känns inte igen av någon aktiv parser')
  }

  if (
    detected.probe.capability !== 'points' ||
    !detected.plugin.parseHeader ||
    !detected.plugin.parsePointChunk
  ) {
    const { error } = await admin
      .from('sonar_import_files')
      .update({
        status: 'completed',
        manufacturer: detected.probe.manufacturer,
        detected_model: detected.probe.model,
        detected_format: detected.probe.format,
        parser_plugin: detected.plugin.id,
        parser_version: detected.plugin.version,
        completed_at: new Date().toISOString(),
      })
      .eq('id', file.id)
      .eq('user_id', file.user_id)

    if (error) throw new Error(`METADATA_FILE_UPDATE_FAILED:${error.message}`)
    return null
  }

  let header: SonarParsedHeader
  try {
    header = detected.plugin.parseHeader(descriptor, prefix)
  } catch (error) {
    throw new FatalError(
      `Filen är korrupt eller ofullständig: ${
        error instanceof Error ? error.message : 'okänt parserfel'
      }`
    )
  }
  if (prefix.byteLength < header.headerSize + header.recordSize) {
    throw new FatalError('ACU-filen innehåller ingen komplett första mätpost')
  }

  const firstElapsedMs = new DataView(
    prefix.buffer,
    prefix.byteOffset + header.headerSize,
    header.recordSize
  ).getUint32(20, true)

  const { data: survey, error: surveyError } = await admin
    .from('sonar_surveys')
    .insert({
      job_id: file.job_id,
      user_id: file.user_id,
      name: file.original_name.replace(/\.[^.]+$/, ''),
      manufacturer: header.manufacturer,
      device_model: header.model,
      source_format: header.format,
      parser_plugin: detected.plugin.id,
      parser_version: detected.plugin.version,
      bounds: boundsPolygonWkt(header),
      metadata: {
        header: header.raw,
        timeInterpretation: 'device-local-wall-clock',
      },
    })
    .select('id')
    .single()

  if (surveyError || !survey) {
    throw new Error(`SURVEY_CREATE_FAILED:${surveyError?.message ?? 'No row'}`)
  }

  const persistedHeader = {
    ...header,
    firstElapsedMs,
  }

  const { error: fileError } = await admin
    .from('sonar_import_files')
    .update({
      survey_id: survey.id,
      status: 'parsing',
      manufacturer: detected.probe.manufacturer,
      detected_model: detected.probe.model,
      detected_format: detected.probe.format,
      parser_plugin: detected.plugin.id,
      parser_version: detected.plugin.version,
      record_size: header.recordSize,
      record_count: header.recordCount,
      header: persistedHeader,
      started_at: new Date().toISOString(),
    })
    .eq('id', file.id)
    .eq('user_id', file.user_id)

  if (fileError) throw new Error(`FILE_INIT_FAILED:${fileError.message}`)

  return {
    surveyId: survey.id as string,
    header,
    firstElapsedMs,
    plugin: detected.plugin,
  }
}

async function processNextSonarChunk(
  jobId: string,
  userId: string
): Promise<ChunkResult> {
  'use step'

  const admin = createAdminClient()
  const { data: job, error: jobError } = await admin
    .from('sonar_import_jobs')
    .select('status, device_timezone')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single()

  if (jobError || !job) {
    throw new FatalError('Importjobbet finns inte längre')
  }
  if (job.status === 'cancelled') return { hasMore: false, points: 0 }

  const { data, error } = await admin
    .from('sonar_import_files')
    .select(
      'id, job_id, user_id, survey_id, original_name, relative_path, extension, byte_size, storage_path, status, record_count, processed_records, header'
    )
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .in('status', ['uploaded', 'parsing'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`NEXT_FILE_FAILED:${error.message}`)
  if (!data) {
    await refreshJobStats(jobId, userId)
    return { hasMore: false, points: 0 }
  }

  const file = data as ImportFileRow

  try {
    let initialized: Awaited<ReturnType<typeof initializePointFile>> | null = null

    if (file.status === 'uploaded') {
      initialized = await initializePointFile(file)
      if (!initialized) {
        await refreshJobStats(jobId, userId)
        return { hasMore: true, points: 0 }
      }
      file.survey_id = initialized.surveyId
      file.record_count = initialized.header.recordCount
      file.processed_records = 0
      file.header = {
        ...initialized.header,
        firstElapsedMs: initialized.firstElapsedMs,
      }
    }

    if (!file.storage_path || !file.survey_id) {
      throw new FatalError('Filen saknar lagring eller surveykoppling')
    }

    const descriptor: SonarFileDescriptor = {
      name: file.original_name,
      relativePath: file.relative_path,
      size: Number(file.byte_size),
    }
    const header = file.header as unknown as SonarParsedHeader & {
      firstElapsedMs: number
    }
    const plugin =
      initialized?.plugin ??
      detectSonarImporter(
        descriptor,
        await downloadRange(
          file.storage_path,
          Number(file.byte_size),
          0,
          Math.min(Number(file.byte_size) - 1, 63)
        )
      )?.plugin

    if (!plugin?.parsePointChunk) {
      throw new FatalError('Den registrerade parsern kan inte läsa mätpunkter')
    }

    const firstRecord = Number(file.processed_records)
    const remainingRecords = Number(file.record_count) - firstRecord

    if (remainingRecords <= 0) {
      const { error: completeError } = await admin
        .from('sonar_import_files')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', file.id)
        .eq('user_id', userId)
      if (completeError) {
        throw new Error(`FILE_COMPLETE_FAILED:${completeError.message}`)
      }
      await refreshJobStats(jobId, userId)
      return { hasMore: true, points: 0 }
    }

    const recordsThisStep = Math.min(RECORDS_PER_STEP, remainingRecords)
    const rangeStart = header.headerSize + firstRecord * header.recordSize
    const rangeEnd =
      rangeStart + recordsThisStep * header.recordSize - 1
    const bytes = await downloadRange(
      file.storage_path,
      Number(file.byte_size),
      rangeStart,
      rangeEnd
    )
    const parsed = plugin.parsePointChunk(bytes, {
      firstElapsedMs: Number(header.firstElapsedMs),
      firstRecordIndex: firstRecord,
      deviceTimezone: job.device_timezone,
      header,
    })

    const { error: ingestError } = await admin.rpc('sonar_ingest_point_chunk', {
      p_job_id: jobId,
      p_file_id: file.id,
      p_survey_id: file.survey_id,
      p_user_id: userId,
      p_points: parsed.points,
      p_processed_records: firstRecord + recordsThisStep,
      p_invalid_records: parsed.invalidRecords,
    })

    if (ingestError) throw new Error(`POINT_INGEST_FAILED:${ingestError.message}`)

    if (firstRecord + recordsThisStep >= Number(file.record_count)) {
      const { error: completeError } = await admin
        .from('sonar_import_files')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', file.id)
        .eq('user_id', userId)
      if (completeError) {
        throw new Error(`FILE_COMPLETE_FAILED:${completeError.message}`)
      }
    }

    await refreshJobStats(jobId, userId)
    return { hasMore: true, points: parsed.points.length }
  } catch (error) {
    if (!(error instanceof FatalError)) throw error

    const { error: fileError } = await admin
      .from('sonar_import_files')
      .update({
        status: 'failed',
        error_code: 'PARSER_REJECTED_FILE',
        error_message: error.message.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', file.id)
      .eq('user_id', userId)

    if (fileError) throw new Error(`FILE_FAILURE_UPDATE_FAILED:${fileError.message}`)
    await refreshJobStats(jobId, userId)
    return { hasMore: true, points: 0 }
  }
}

async function runDerivedRpc(
  jobId: string,
  userId: string,
  functionName:
    | 'sonar_enrich_motion'
    | 'sonar_build_depth_cells'
    | 'sonar_build_tracks'
    | 'sonar_build_contours'
    | 'sonar_match_catches',
  extra: Record<string, number> = {}
) {
  'use step'

  const admin = createAdminClient()
  const { data, error } = await admin.rpc(functionName, {
    p_job_id: jobId,
    p_user_id: userId,
    ...extra,
  })
  if (error) throw new Error(`${functionName.toUpperCase()}_FAILED:${error.message}`)
  return Number(data ?? 0)
}

async function completeJob(jobId: string, userId: string) {
  'use step'

  const admin = createAdminClient()
  await refreshJobStats(jobId, userId)
  const { data: files, error: filesError } = await admin
    .from('sonar_import_files')
    .select('status')
    .eq('job_id', jobId)
    .eq('user_id', userId)

  if (filesError) throw new Error(`FINAL_FILE_STATUS_FAILED:${filesError.message}`)
  const hasErrors = (files ?? []).some((file) =>
    ['failed', 'unsupported'].includes(file.status)
  )

  const { error } = await admin
    .from('sonar_import_jobs')
    .update({
      status: hasErrors ? 'completed_with_errors' : 'completed',
      current_stage: hasErrors ? 'Klar med varningar' : 'Klar',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)

  if (error) throw new Error(`JOB_COMPLETE_FAILED:${error.message}`)
  return { hasErrors }
}

async function failJob(jobId: string, userId: string, message: string) {
  'use step'

  const admin = createAdminClient()
  await admin
    .from('sonar_import_jobs')
    .update({
      status: 'failed',
      current_stage: 'Importen avbröts',
      error_summary: message.slice(0, 1_000),
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)
}

export async function sonarImportWorkflow(jobId: string, userId: string) {
  'use workflow'

  try {
    await updateJobStage(jobId, userId, 'parsing', 'Läser ekolodsfiler')

    let hasMore = true
    let steps = 0
    let importedPoints = 0

    while (hasMore) {
      const result = await processNextSonarChunk(jobId, userId)
      hasMore = result.hasMore
      importedPoints += result.points
      steps += 1
      if (steps > 100_000) {
        throw new FatalError('Importen överskred säkerhetsgränsen för antal block')
      }
    }

    await updateJobStage(jobId, userId, 'deriving', 'Beräknar fart och kurs')
    await runDerivedRpc(jobId, userId, 'sonar_enrich_motion')

    for (const resolution of [100, 50, 25, 10]) {
      await updateJobStage(
        jobId,
        userId,
        'deriving',
        `Bygger djupkarta ${resolution} m`
      )
      await runDerivedRpc(jobId, userId, 'sonar_build_depth_cells', {
        p_resolution_m: resolution,
      })
    }

    await updateJobStage(jobId, userId, 'deriving', 'Bygger spår')
    await runDerivedRpc(jobId, userId, 'sonar_build_tracks')
    await updateJobStage(jobId, userId, 'deriving', 'Skapar djupkonturer')
    await runDerivedRpc(jobId, userId, 'sonar_build_contours', {
      p_interval_m: 1,
    })
    await updateJobStage(jobId, userId, 'matching', 'Matchar fångster')
    const matchedCatches = await runDerivedRpc(
      jobId,
      userId,
      'sonar_match_catches'
    )
    const result = await completeJob(jobId, userId)

    return {
      jobId,
      importedPoints,
      matchedCatches,
      completedWithErrors: result.hasErrors,
    }
  } catch (error) {
    await failJob(
      jobId,
      userId,
      error instanceof Error ? error.message : 'Okänt workflow-fel'
    )
    throw error
  }
}
