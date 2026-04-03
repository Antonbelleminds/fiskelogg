import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

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

    // Update location if coordinates changed
    if (body.lat && body.lng) {
      body.location = `POINT(${body.lng} ${body.lat})`
    }
    delete body.lat
    delete body.lng

    const { data, error } = await admin
      .from('catches')
      .update({ ...body, updated_at: new Date().toISOString() })
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
