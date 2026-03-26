import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '0')
    const limit = parseInt(searchParams.get('limit') || '20')
    const species = searchParams.get('species')
    const method = searchParams.get('method')
    const sort = searchParams.get('sort') || 'caught_at'
    const publicOnly = searchParams.get('public') === 'true'

    const admin = createAdminClient()
    let query = admin
      .from('catches')
      .select('*, profiles!catches_user_id_profiles_fkey(username, display_name, avatar_url)')

    if (publicOnly) {
      query = query.eq('is_public', true)
    } else {
      query = query.eq('user_id', user.id)
    }

    if (species) query = query.eq('species', species)
    if (method) query = query.eq('fishing_method', method)

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

    return NextResponse.json(data || [])
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

    // Build location point if coordinates exist
    let location = null
    if (body.lat && body.lng) {
      location = `POINT(${body.lng} ${body.lat})`
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
        location_name: body.location_name || null,
        water_body: body.water_body || null,
        fishing_method: body.fishing_method || null,
        lure_type: body.lure_type || null,
        lure_color: body.lure_color || null,
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
        image_url: body.image_url || null,
        image_path: body.image_path || null,
        exif_captured_at: body.exif_captured_at || null,
        exif_lat: body.lat || null,
        exif_lng: body.lng || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Create catch error:', error)
      return NextResponse.json({ error: 'Kunde inte spara fångst' }, { status: 500 })
    }

    // Update total_catches count
    await admin.rpc('', {}).catch(() => {})
    await admin
      .from('profiles')
      .update({ total_catches: admin.rpc ? undefined : 0 })
      .eq('id', user.id)
      .catch(() => {})

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Create catch error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
