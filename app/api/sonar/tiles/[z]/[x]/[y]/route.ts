import { NextResponse } from 'next/server'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function tileCoordinate(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : null
}

export async function GET(
  request: Request,
  props: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const params = await props.params;
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new NextResponse(null, { status: 401 })
  }

  const z = tileCoordinate(params.z)
  const x = tileCoordinate(params.x)
  const y = tileCoordinate(params.y)
  if (z === null || x === null || y === null || z < 0 || z > 22) {
    return new NextResponse(null, { status: 400 })
  }

  const maxCoordinate = 2 ** z
  if (x < 0 || y < 0 || x >= maxCoordinate || y >= maxCoordinate) {
    return new NextResponse(null, { status: 400 })
  }

  const admin = createAdminClient()
  const surface = new URL(request.url).searchParams.get('surface')
  const tileFunction =
    surface === 'signals'
      ? 'sonar_signal_vector_tile'
      : surface === 'autochart-contours'
        ? 'sonar_autochart_contour_vector_tile'
      : surface === 'coverage-contours'
        ? 'sonar_coverage_contour_vector_tile'
        : 'sonar_vector_tile'
  const { data, error } = await admin.rpc(tileFunction, {
    p_user_id: user.id,
    p_z: z,
    p_x: x,
    p_y: y,
  })

  if (error) {
    console.error(`${tileFunction} failed:`, error)
    return new NextResponse(null, { status: 500 })
  }

  const tile = Buffer.from(data || '', 'base64')
  return new NextResponse(tile, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Content-Length': String(tile.byteLength),
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
