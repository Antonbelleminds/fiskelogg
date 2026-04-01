import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const scope = searchParams.get('scope') || 'mine'

    const admin = createAdminClient()

    let query = admin
      .from('catches')
      .select('id, species, weight_kg, exif_lat, exif_lng, caught_at, user_id, water_body, fishing_method, lure_type, weather_condition, moon_phase, length_cm, location_encrypted, encrypted_location, encryption_iv')

    if (scope === 'friends') {
      // Fetch accepted friends who have share_location=true
      const { data: friendships } = await admin
        .from('friendships')
        .select('requester_id, addressee_id, share_location')
        .eq('status', 'accepted')
        .eq('share_location', true)
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

      const friendIds = (friendships || []).map(f =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      )

      if (friendIds.length === 0) {
        return NextResponse.json([])
      }

      query = query
        .in('user_id', friendIds)
        .eq('is_public', true)
        .not('exif_lat', 'is', null)
        .not('exif_lng', 'is', null)
    } else {
      // Default: only the user's own catches with coordinates OR encrypted location
      query = query
        .eq('user_id', user.id)
        .or('exif_lat.not.is.null,location_encrypted.eq.true')
    }

    query = query.order('caught_at', { ascending: false })

    const { data, error } = await query

    if (error) {
      console.error('Map catches error:', error)
      return NextResponse.json({ error: 'Kunde inte hämta kartdata' }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Map catches error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
