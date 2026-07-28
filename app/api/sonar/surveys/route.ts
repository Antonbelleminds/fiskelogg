import { NextResponse } from 'next/server'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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
    .from('sonar_surveys')
    .select(
      'id, job_id, name, manufacturer, device_model, source_format, started_at, ended_at, point_count, min_depth_m, max_depth_m, bounds'
    )
    .eq('user_id', user.id)
    .gt('point_count', 0)
    .order('started_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Sonar survey list failed:', error)
    return NextResponse.json(
      { error: 'Kunde inte läsa djupkartorna' },
      { status: 500 }
    )
  }

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'private, max-age=30' },
  })
}
