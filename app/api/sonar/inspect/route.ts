import { NextRequest, NextResponse } from 'next/server'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const lon = Number(request.nextUrl.searchParams.get('lon'))
  const lat = Number(request.nextUrl.searchParams.get('lat'))
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    return NextResponse.json({ error: 'Ogiltig position' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('sonar_inspect_point', {
    p_user_id: user.id,
    p_lon: lon,
    p_lat: lat,
  })

  if (error) {
    console.error('Sonar inspect failed:', error)
    return NextResponse.json(
      { error: 'Kunde inte analysera kartpunkten' },
      { status: 500 }
    )
  }

  return NextResponse.json(data ?? { found: false }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
