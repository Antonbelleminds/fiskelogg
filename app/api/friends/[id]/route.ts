import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const admin = createAdminClient()

    // Verify user is part of this friendship
    const { data: friendship } = await admin
      .from('friendships')
      .select('*')
      .eq('id', id)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .single()

    if (!friendship) {
      return NextResponse.json({ error: 'Vänskapsrelation hittades inte' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}

    // Only addressee can accept
    if (body.status === 'accepted' && friendship.addressee_id === user.id) {
      updates.status = 'accepted'
    }

    if (typeof body.share_location === 'boolean') {
      updates.share_location = body.share_location
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Inga ändringar' }, { status: 400 })
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await admin
      .from('friendships')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update friendship error:', error)
      return NextResponse.json({ error: 'Kunde inte uppdatera' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Friendship patch error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { id } = await params
    const admin = createAdminClient()

    const { error } = await admin
      .from('friendships')
      .delete()
      .eq('id', id)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

    if (error) {
      console.error('Delete friendship error:', error)
      return NextResponse.json({ error: 'Kunde inte ta bort' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Friendship delete error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
