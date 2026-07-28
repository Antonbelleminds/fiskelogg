import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'
import { sonarImportWorkflow } from '@/workflows/sonar-import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_request: Request, props: { params: Promise<{ jobId: string }> }) {
  const params = await props.params;
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin
    .from('sonar_import_jobs')
    .select('id, status, workflow_run_id')
    .eq('id', params.jobId)
    .eq('user_id', user.id)
    .single()

  if (error || !job) {
    return NextResponse.json(
      { error: 'Importjobbet hittades inte' },
      { status: 404 }
    )
  }
  if (job.workflow_run_id) {
    if (job.workflow_run_id.startsWith('starting:')) {
      return NextResponse.json(
        { error: 'Importjobbet håller redan på att startas' },
        { status: 409 }
      )
    }
    return NextResponse.json({
      ok: true,
      runId: job.workflow_run_id,
      status: job.status,
    })
  }
  if (
    ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(
      job.status
    )
  ) {
    return NextResponse.json(
      { error: 'Importjobbet kan inte startas i nuvarande status' },
      { status: 409 }
    )
  }

  const { count: pendingCount, error: pendingError } = await admin
    .from('sonar_import_files')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', params.jobId)
    .eq('user_id', user.id)
    .in('status', ['pending_upload', 'uploading'])

  if (pendingError) {
    return NextResponse.json(
      { error: 'Kunde inte kontrollera uppladdningarna' },
      { status: 500 }
    )
  }
  if ((pendingCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Alla filer är inte färdiguppladdade' },
      { status: 409 }
    )
  }

  const reservation = `starting:${crypto.randomUUID()}`
  const { data: reservedJob, error: queueError } = await admin
    .from('sonar_import_jobs')
    .update({
      status: 'queued',
      current_stage: 'Väntar på bakgrundsjobb',
      workflow_run_id: reservation,
    })
    .eq('id', params.jobId)
    .eq('user_id', user.id)
    .is('workflow_run_id', null)
    .select('id')
    .maybeSingle()

  if (queueError || !reservedJob) {
    return NextResponse.json(
      {
        error: queueError
          ? 'Kunde inte köa importen'
          : 'Importjobbet startas redan',
      },
      { status: queueError ? 500 : 409 }
    )
  }

  try {
    const run = await start(sonarImportWorkflow, [params.jobId, user.id])
    const { error: runUpdateError } = await admin
      .from('sonar_import_jobs')
      .update({ workflow_run_id: run.runId })
      .eq('id', params.jobId)
      .eq('user_id', user.id)
      .eq('workflow_run_id', reservation)

    if (runUpdateError) {
      console.error('Sonar workflow run id update failed:', runUpdateError)
    }

    return NextResponse.json({ ok: true, runId: run.runId, status: 'queued' })
  } catch (workflowError) {
    await admin
      .from('sonar_import_jobs')
      .update({
        status: 'failed',
        current_stage: 'Kunde inte starta bakgrundsjobbet',
        workflow_run_id: null,
        error_summary:
          workflowError instanceof Error
            ? workflowError.message.slice(0, 500)
            : 'Okänt workflow-fel',
      })
      .eq('id', params.jobId)
      .eq('user_id', user.id)
      .eq('workflow_run_id', reservation)

    console.error('Sonar workflow start failed:', workflowError)
    return NextResponse.json(
      { error: 'Kunde inte starta bakgrundsjobbet' },
      { status: 500 }
    )
  }
}
