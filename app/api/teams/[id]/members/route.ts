import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { id: teamId } = await params
    const { user_id } = await req.json()
    const admin = createAdminClient()

    // Verify caller is a team member
    const { data: callerMembership } = await admin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'Du är inte medlem i laget' }, { status: 403 })
    }

    // Verify target is a friend
    const { data: friendship } = await admin
      .from('friendships')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${user_id}),and(requester_id.eq.${user_id},addressee_id.eq.${user.id})`
      )
      .limit(1)

    if (!friendship || friendship.length === 0) {
      return NextResponse.json({ error: 'Användaren måste vara din vän' }, { status: 400 })
    }

    // Check if already member
    const { data: existing } = await admin
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user_id)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Redan medlem' }, { status: 409 })
    }

    const { data, error } = await admin
      .from('team_members')
      .insert({ team_id: teamId, user_id, role: 'member' })
      .select()
      .single()

    if (error) {
      console.error('Add member error:', error)
      return NextResponse.json({ error: 'Kunde inte lägga till medlem' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Add team member error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const { id: teamId } = await params
    const { user_id } = await req.json()
    const admin = createAdminClient()

    // Verify caller is admin or removing themselves
    if (user_id !== user.id) {
      const { data: callerMembership } = await admin
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', user.id)
        .single()

      if (!callerMembership || callerMembership.role !== 'admin') {
        return NextResponse.json({ error: 'Bara admin kan ta bort medlemmar' }, { status: 403 })
      }
    }

    const { error } = await admin
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', user_id)

    if (error) {
      console.error('Remove member error:', error)
      return NextResponse.json({ error: 'Kunde inte ta bort medlem' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Remove team member error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
