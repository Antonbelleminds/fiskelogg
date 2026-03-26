import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(
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

    // Verify user is member
    const { data: membership } = await admin
      .from('team_members')
      .select('role')
      .eq('team_id', id)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Inte medlem i laget' }, { status: 403 })
    }

    // Get team
    const { data: team, error: teamError } = await admin
      .from('teams')
      .select('*')
      .eq('id', id)
      .single()

    if (teamError || !team) {
      return NextResponse.json({ error: 'Lag hittades inte' }, { status: 404 })
    }

    // Get members with profiles
    const { data: members } = await admin
      .from('team_members')
      .select('*')
      .eq('team_id', id)

    const memberUserIds = (members || []).map((m) => m.user_id)
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', memberUserIds)

    const profileMap = new Map((profiles || []).map((p) => [p.id, p]))

    const membersWithProfiles = (members || []).map((m) => ({
      ...m,
      profile: profileMap.get(m.user_id) || null,
    }))

    return NextResponse.json({ ...team, members: membersWithProfiles })
  } catch (error) {
    console.error('Team detail error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

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
    const { name } = await req.json()
    const admin = createAdminClient()

    // Check creator
    const { data: team } = await admin
      .from('teams')
      .select('created_by')
      .eq('id', id)
      .single()

    if (!team || team.created_by !== user.id) {
      return NextResponse.json({ error: 'Bara skaparen kan ändra laget' }, { status: 403 })
    }

    const { data, error } = await admin
      .from('teams')
      .update({ name: name.trim() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update team error:', error)
      return NextResponse.json({ error: 'Kunde inte uppdatera' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Team patch error:', error)
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

    // Check creator
    const { data: team } = await admin
      .from('teams')
      .select('created_by')
      .eq('id', id)
      .single()

    if (!team || team.created_by !== user.id) {
      return NextResponse.json({ error: 'Bara skaparen kan ta bort laget' }, { status: 403 })
    }

    // Delete members first, then team
    await admin.from('team_members').delete().eq('team_id', id)
    const { error } = await admin.from('teams').delete().eq('id', id)

    if (error) {
      console.error('Delete team error:', error)
      return NextResponse.json({ error: 'Kunde inte ta bort' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Team delete error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
