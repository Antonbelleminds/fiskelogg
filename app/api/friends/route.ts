import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Get friendships where user is requester or addressee
    const { data: friendships, error } = await admin
      .from('friendships')
      .select('*')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

    if (error) {
      console.error('Fetch friendships error:', error)
      return NextResponse.json({ error: 'Kunde inte hämta vänner' }, { status: 500 })
    }

    // Get friend profile data
    const friendIds = (friendships || []).map((f) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    )

    if (friendIds.length === 0) {
      return NextResponse.json([])
    }

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, username, display_name, avatar_url, friend_code')
      .in('id', friendIds)

    const profileMap = new Map((profiles || []).map((p) => [p.id, p]))

    const result = (friendships || []).map((f) => {
      const friendId = f.requester_id === user.id ? f.addressee_id : f.requester_id
      return {
        ...f,
        friend_profile: profileMap.get(friendId) || null,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Friends error:', error)
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

    const { friend_code } = await req.json()

    if (!friend_code) {
      return NextResponse.json({ error: 'Vänkod saknas' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Look up user by friend_code
    const { data: friendProfile, error: lookupError } = await admin
      .from('profiles')
      .select('id, username, display_name, avatar_url, friend_code')
      .eq('friend_code', friend_code)
      .single()

    if (lookupError || !friendProfile) {
      return NextResponse.json({ error: 'Ingen användare hittades med den koden' }, { status: 404 })
    }

    if (friendProfile.id === user.id) {
      return NextResponse.json({ error: 'Du kan inte lägga till dig själv' }, { status: 400 })
    }

    // Check if friendship already exists
    const { data: existing } = await admin
      .from('friendships')
      .select('id')
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${friendProfile.id}),and(requester_id.eq.${friendProfile.id},addressee_id.eq.${user.id})`
      )
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Vänförfrågan finns redan' }, { status: 409 })
    }

    // Create friendship
    const { data, error } = await admin
      .from('friendships')
      .insert({
        requester_id: user.id,
        addressee_id: friendProfile.id,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('Create friendship error:', error)
      return NextResponse.json({ error: 'Kunde inte skicka vänförfrågan' }, { status: 500 })
    }

    return NextResponse.json({ ...data, friend_profile: friendProfile }, { status: 201 })
  } catch (error) {
    console.error('Friend request error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
