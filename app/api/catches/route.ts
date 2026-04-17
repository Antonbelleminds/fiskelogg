import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

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

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(0, parseInt(searchParams.get('page') || '0') || 0)
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20') || 20))
    const species = searchParams.get('species')
    const method = searchParams.get('method')
    const lureType = searchParams.get('lure_type')
    const year = searchParams.get('year')
    const sort = searchParams.get('sort') || 'caught_at'
    const publicOnly = searchParams.get('public') === 'true'
    const scope = searchParams.get('scope') || 'mine'
    const teamId = searchParams.get('team_id')

    const admin = createAdminClient()

    // Determine which user IDs to fetch catches for
    let targetUserIds: string[] = [user.id]
    // Map of friendId -> share_location boolean (only relevant for scope=friends)
    let friendShareLocationMap: Map<string, boolean> = new Map()

    if (scope === 'friends') {
      const { data: friendships } = await admin
        .from('friendships')
        .select('*')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

      const friendIds = (friendships || []).map((f) => {
        const friendId = f.requester_id === user.id ? f.addressee_id : f.requester_id
        friendShareLocationMap.set(friendId, f.share_location)
        return friendId
      })

      if (friendIds.length === 0) {
        return NextResponse.json([])
      }
      targetUserIds = friendIds
    } else if (scope === 'team' && teamId) {
      // Verify user is member of the team
      const { data: membership } = await admin
        .from('team_members')
        .select('user_id')
        .eq('team_id', teamId)

      if (!membership || membership.length === 0) {
        return NextResponse.json([])
      }

      const isMember = membership.some((m) => m.user_id === user.id)
      if (!isMember) {
        return NextResponse.json({ error: 'Inte medlem i laget' }, { status: 403 })
      }

      targetUserIds = membership.map((m) => m.user_id)
    }

    let query = admin
      .from('catches')
      .select('*, profiles!catches_user_id_profiles_fkey(username, display_name, avatar_url)')

    if (publicOnly) {
      query = query.eq('is_public', true)
    } else if (scope === 'mine') {
      query = query.eq('user_id', user.id)
    } else {
      // friends or team scope
      query = query.in('user_id', targetUserIds)
    }

    if (species) query = query.eq('species', species)
    if (method) query = query.eq('fishing_method', method)
    if (lureType) query = query.eq('lure_type', lureType)
    if (year) {
      query = query
        .gte('caught_at', `${year}-01-01T00:00:00`)
        .lte('caught_at', `${year}-12-31T23:59:59`)
    }

    if (sort === 'weight') {
      query = query.order('weight_kg', { ascending: false, nullsFirst: false })
    } else if (sort === 'species') {
      query = query.order('species', { ascending: true })
    } else {
      query = query.order('caught_at', { ascending: false })
    }

    query = query.range(page * limit, (page + 1) * limit - 1)

    const { data, error } = await query

    if (error) {
      console.error('Fetch catches error:', error)
      return NextResponse.json({ error: 'Kunde inte hämta fångster' }, { status: 500 })
    }

    // Strip location data for catches that are not the user's own,
    // unless the owner is a friend with share_location=true
    let result = data || []
    if (scope !== 'mine') {
      result = result.map((c) => {
        if (c.user_id === user.id) return c // own catch, keep everything

        const shareLocation = friendShareLocationMap.get(c.user_id)
        if (shareLocation === true) return c // friend with location sharing on

        // Otherwise strip all location data
        return {
          ...c,
          exif_lat: null,
          exif_lng: null,
          location: null,
          location_name: null,
          water_body: null,
        }
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Catches error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const body = await req.json()
    const admin = createAdminClient()

    // Build location point if coordinates exist (and not encrypted)
    const isEncrypted = body.location_encrypted === true
    let location = null
    if (!isEncrypted && body.lat && body.lng) {
      location = `POINT(${body.lng} ${body.lat})`
    }

    const imageHash = typeof body.image_hash === 'string' && /^[a-f0-9]{64}$/.test(body.image_hash)
      ? body.image_hash
      : null

    if (imageHash) {
      const { data: existing } = await admin
        .from('catches')
        .select('id')
        .eq('user_id', user.id)
        .eq('image_hash', imageHash)
        .limit(1)
        .maybeSingle()
      if (existing) {
        return NextResponse.json(
          { error: 'Den här bilden är redan uppladdad.', duplicate: true, catchId: existing.id },
          { status: 409 }
        )
      }
    }

    const { data, error } = await admin
      .from('catches')
      .insert({
        user_id: user.id,
        caught_at: body.caught_at || new Date().toISOString(),
        is_public: body.is_public || false,
        notes: body.notes || null,
        species: body.species || null,
        species_confidence: body.species_confidence || null,
        weight_kg: body.weight_kg || null,
        length_cm: body.length_cm || null,
        location: location,
        location_name: isEncrypted ? null : (body.location_name || null),
        water_body: isEncrypted ? null : (body.water_body || null),
        fishing_method: body.fishing_method || null,
        lure_type: body.lure_type || null,
        lure_color: body.lure_color || null,
        lure_name: body.lure_name || null,
        depth_m: body.depth_m || null,
        bottom_structure: body.bottom_structure || null,
        water_temp_c: body.water_temp_c || null,
        weather_temp_c: body.weather_temp_c || null,
        weather_condition: body.weather_condition || null,
        wind_speed_ms: body.wind_speed_ms || null,
        wind_direction: body.wind_direction || null,
        cloud_cover_pct: body.cloud_cover_pct || null,
        precipitation_mm: body.precipitation_mm || null,
        pressure_hpa: body.pressure_hpa || null,
        humidity_pct: body.humidity_pct || null,
        visibility_km: body.visibility_km || null,
        moon_phase: body.moon_phase || null,
        moon_illumination_pct: body.moon_illumination_pct || null,
        sunrise_time: body.sunrise_time || null,
        sunset_time: body.sunset_time || null,
        is_golden_hour: body.is_golden_hour || null,
        ai_weather_description: body.ai_weather_description || null,
        ai_fish_description: body.ai_fish_description || null,
        ai_environment_notes: body.ai_environment_notes || null,
        catcher_name: body.catcher_name || null,
        image_url: body.image_url || null,
        image_path: body.image_path || null,
        image_position: sanitizeImagePosition(body.image_position),
        image_hash: imageHash,
        solunar_period: sanitizeSolunarPeriod(body.solunar_period),
        solunar_strength: sanitizeSolunarStrength(body.solunar_strength),
        exif_captured_at: body.exif_captured_at || null,
        exif_lat: isEncrypted ? null : (body.lat || null),
        exif_lng: isEncrypted ? null : (body.lng || null),
        // Fiskepin encryption fields
        location_encrypted: isEncrypted,
        encrypted_location: isEncrypted ? body.encrypted_location : null,
        encryption_iv: isEncrypted ? body.encryption_iv : null,
      })
      .select()
      .single()

    if (error) {
      // Unique violation on (user_id, image_hash) — race-protected duplicate guard
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'Den här bilden är redan uppladdad.', duplicate: true },
          { status: 409 }
        )
      }
      console.error('Create catch error:', JSON.stringify(error, null, 2))
      return NextResponse.json(
        { error: 'Kunde inte spara fångsten. Försök igen.' },
        { status: 500 }
      )
    }

    // Update total_catches count
    const { count } = await admin
      .from('catches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (count !== null) {
      await admin
        .from('profiles')
        .update({ total_catches: count })
        .eq('id', user.id)
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Create catch error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
