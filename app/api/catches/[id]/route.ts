import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

const ALLOWED_PATCH_FIELDS = [
  'caught_at',
  'is_public',
  'notes',
  'species',
  'species_confidence',
  'weight_kg',
  'length_cm',
  'location_name',
  'water_body',
  'fishing_method',
  'lure_type',
  'lure_color',
  'lure_name',
  'depth_m',
  'bottom_structure',
  'water_temp_c',
  'weather_temp_c',
  'weather_condition',
  'wind_speed_ms',
  'wind_direction',
  'cloud_cover_pct',
  'precipitation_mm',
  'pressure_hpa',
  'humidity_pct',
  'visibility_km',
  'moon_phase',
  'moon_illumination_pct',
  'sunrise_time',
  'sunset_time',
  'is_golden_hour',
  'ai_weather_description',
  'ai_fish_description',
  'ai_environment_notes',
  'catcher_name',
  'image_url',
  'image_path',
  'image_position',
  'exif_captured_at',
  'solunar_period',
  'solunar_strength',
] as const

function sanitizeImagePosition(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/)
  if (!m) return null
  const x = parseFloat(m[1])
  const y = parseFloat(m[2])
  if (x < 0 || x > 100 || y < 0 || y > 100) return null
  return `${Math.round(x)}% ${Math.round(y)}%`
}

function sanitizeSolunarPeriod(value: unknown): string | null {
  return value === 'major' || value === 'minor' || value === 'none' ? value : null
}

function sanitizeSolunarStrength(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const n = Math.round(value)
  return n >= 1 && n <= 5 ? n : null
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('catches')
      .select('*, profiles!catches_user_id_profiles_fkey(username, display_name, avatar_url)')
      .eq('id', params.id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Fångst hittades inte' }, { status: 404 })
    }

    // Check access
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    const isOwner = user && data.user_id === user.id

    // Check friendship if not owner and not public
    let friendship: { share_location: boolean } | null = null
    if (!isOwner && user) {
      const { data: f } = await admin
        .from('friendships')
        .select('share_location')
        .eq('status', 'accepted')
        .or(
          `and(requester_id.eq.${user.id},addressee_id.eq.${data.user_id}),` +
          `and(requester_id.eq.${data.user_id},addressee_id.eq.${user.id})`
        )
        .maybeSingle()
      friendship = f
    }

    const isFriend = !!friendship

    // Access: own, public, or friend
    if (!isOwner && !data.is_public && !isFriend) {
      return NextResponse.json({ error: 'Åtkomst nekad' }, { status: 403 })
    }

    // Strip location data if viewer is not owner and not friend with share_location
    if (!isOwner) {
      const canSeeLocation = friendship?.share_location === true
      if (!canSeeLocation) {
        data.exif_lat = null
        data.exif_lng = null
        data.lat = null
        data.lng = null
        data.location = null
        data.location_name = null
        data.water_body = null
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Get catch error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const body = await req.json()
    const admin = createAdminClient()

    const update: Record<string, unknown> = {}
    for (const key of ALLOWED_PATCH_FIELDS) {
      if (key in body) update[key] = body[key]
    }

    if ('image_position' in update) {
      update.image_position = sanitizeImagePosition(update.image_position)
    }
    if ('solunar_period' in update) {
      update.solunar_period = sanitizeSolunarPeriod(update.solunar_period)
    }
    if ('solunar_strength' in update) {
      update.solunar_strength = sanitizeSolunarStrength(update.solunar_strength)
    }

    if (body.lat && body.lng) {
      update.location = `POINT(${body.lng} ${body.lat})`
    }

    update.updated_at = new Date().toISOString()

    const { data, error } = await admin
      .from('catches')
      .update(update)
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('Update catch error:', error)
      return NextResponse.json({ error: 'Kunde inte uppdatera' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Update catch error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('catches')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Delete catch error:', error)
      return NextResponse.json({ error: 'Kunde inte ta bort' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Delete catch error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
