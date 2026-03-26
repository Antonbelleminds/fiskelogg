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

    // Get teams where user is a member
    const { data: memberships, error: memberError } = await admin
      .from('team_members')
      .select('team_id, role')
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

    const { data: teams, error: teamError } = await admin
      .from('teams')
      .select('*')
      .in('id', teamIds)

    if (teamError) {
      console.error('Fetch teams error:', teamError)
      return NextResponse.json({ error: 'Kunde inte hämta lag' }, { status: 500 })
    }

    // Get member counts
    const { data: counts } = await admin
      .from('team_members')
      .select('team_id')
      .in('team_id', teamIds)

    const countMap: Record<string, number> = {}
    ;(counts || []).forEach((c) => {
      countMap[c.team_id] = (countMap[c.team_id] || 0) + 1
    })

    const result = (teams || []).map((t) => ({
      ...t,
      member_count: countMap[t.id] || 0,
      my_role: roleMap.get(t.id) || 'member',
    }))

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
