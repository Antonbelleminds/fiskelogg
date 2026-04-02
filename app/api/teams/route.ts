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

    // Get teams where user is a member (accepted or pending)
    const { data: memberships, error: memberError } = await admin
      .from('team_members')
      .select('team_id, role, status')
      .eq('user_id', user.id)

    if (memberError) {
      console.error('Fetch memberships error:', memberError)
      return NextResponse.json({ error: 'Kunde inte hämta lag' }, { status: 500 })
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json([])
    }

    const teamIds = memberships.map((m) => m.team_id)
    const roleMap = new Map(memberships.map((m) => [m.team_id, m.role]))
    const statusMap = new Map(memberships.map((m) => [m.team_id, (m as { status?: string }).status || 'accepted']))

    const { data: teams, error: teamError } = await admin
      .from('teams')
      .select('*')
      .in('id', teamIds)

    if (teamError) {
      console.error('Fetch teams error:', teamError)
      return NextResponse.json({ error: 'Kunde inte hämta lag' }, { status: 500 })
    }

    // Get all members for each team (include status)
    const { data: allMembers } = await admin
      .from('team_members')
      .select('team_id, user_id, role, status')
      .in('team_id', teamIds)

    // Get profiles for all member user_ids
    const memberUserIds = Array.from(new Set((allMembers || []).map(m => m.user_id)))
    let memberProfiles: { id: string; display_name: string | null; username: string | null }[] = []
    if (memberUserIds.length > 0) {
      const { data } = await admin.from('profiles').select('id, display_name, username').in('id', memberUserIds)
      memberProfiles = (data || []) as typeof memberProfiles
    }

    const profileMap = new Map(memberProfiles.map(p => [p.id, p]))

    const memberMap: Record<string, { user_id: string; role: string; name: string; status: string }[]> = {}
    ;(allMembers || []).forEach((m) => {
      if (!memberMap[m.team_id]) memberMap[m.team_id] = []
      const profile = profileMap.get(m.user_id)
      const status = (m as { status?: string }).status || 'accepted'
      memberMap[m.team_id].push({
        user_id: m.user_id,
        role: m.role,
        name: profile?.display_name || profile?.username || 'Okänd',
        status,
      })
    })

    const result = (teams || []).map((t) => {
      const members = memberMap[t.id] || []
      const acceptedMembers = members.filter(m => m.status === 'accepted')
      return {
        ...t,
        member_count: acceptedMembers.length,
        members,
        my_role: roleMap.get(t.id) || 'member',
        my_status: statusMap.get(t.id) || 'accepted',
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Teams error:', error)
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

    const { name } = await req.json()

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Lagnamn saknas' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Create team
    const { data: team, error: teamError } = await admin
      .from('teams')
      .insert({ name: name.trim(), created_by: user.id })
      .select()
      .single()

    if (teamError) {
      console.error('Create team error:', teamError)
      return NextResponse.json({ error: 'Kunde inte skapa lag' }, { status: 500 })
    }

    // Add creator as admin member
    const { error: memberError } = await admin
      .from('team_members')
      .insert({ team_id: team.id, user_id: user.id, role: 'admin' })

    if (memberError) {
      console.error('Add team member error:', memberError)
    }

    return NextResponse.json({ ...team, member_count: 1, my_role: 'admin' }, { status: 201 })
  } catch (error) {
    console.error('Create team error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
