import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })

    const admin = createAdminClient()

    // Fetch all caught_at dates for user, then extract unique years server-side
    const { data, error } = await admin
      .from('catches')
      .select('caught_at')
      .eq('user_id', user.id)
      .order('caught_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Kunde inte hämta år' }, { status: 500 })

    const years = Array.from(
      new Set((data || []).map(r => new Date(r.caught_at).getFullYear().toString()))
    ).sort((a, b) => b.localeCompare(a))

    return NextResponse.json(years)
  } catch {
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
