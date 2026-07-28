import { NextResponse } from 'next/server'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _request: Request,
  props: { params: Promise<{ jobId: string; fileId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: file, error } = await admin
    .from('sonar_import_files')
    .select('id, storage_path, byte_size, status')
    .eq('id', params.fileId)
    .eq('job_id', params.jobId)
    .eq('user_id', user.id)
    .single()

  if (error || !file) {
    return NextResponse.json({ error: 'Filen hittades inte' }, { status: 404 })
  }
  if (['uploaded', 'parsing', 'completed'].includes(file.status)) {
    return NextResponse.json({ ok: true, status: file.status })
  }
  if (!file.storage_path) {
    return NextResponse.json({ error: 'Lagringssökväg saknas' }, { status: 409 })
  }

  const slash = file.storage_path.lastIndexOf('/')
  const folder = file.storage_path.slice(0, slash)
  const objectName = file.storage_path.slice(slash + 1)
  const { data: objects, error: listError } = await admin.storage
    .from('sonar-imports')
    .list(folder, { search: objectName, limit: 10 })
  const object = objects?.find((candidate) => candidate.name === objectName)

  if (listError || !object) {
    return NextResponse.json(
      { error: 'Uppladdningen är inte färdig i lagringen' },
      { status: 409 }
    )
  }
  const storedSize = Number(
    (object as { metadata?: { size?: number | string } }).metadata?.size
  )
  if (!Number.isFinite(storedSize) || storedSize !== Number(file.byte_size)) {
    return NextResponse.json(
      { error: 'Den uppladdade filstorleken stämmer inte med manifestet' },
      { status: 409 }
    )
  }

  const { error: updateError } = await admin
    .from('sonar_import_files')
    .update({
      status: 'uploaded',
      uploaded_at: new Date().toISOString(),
    })
    .eq('id', file.id)
    .eq('user_id', user.id)
    .in('status', ['pending_upload', 'uploading'])

  if (updateError) {
    console.error('Sonar upload completion failed:', updateError)
    return NextResponse.json(
      { error: 'Kunde inte slutföra uppladdningen' },
      { status: 500 }
    )
  }

  const { data: uploadedFiles } = await admin
    .from('sonar_import_files')
    .select('byte_size')
    .eq('job_id', params.jobId)
    .eq('user_id', user.id)
    .in('status', ['uploaded', 'parsing', 'completed'])

  await admin
    .from('sonar_import_jobs')
    .update({
      bytes_uploaded: (uploadedFiles ?? []).reduce(
        (sum, uploaded) => sum + Number(uploaded.byte_size),
        0
      ),
    })
    .eq('id', params.jobId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, status: 'uploaded' })
}
