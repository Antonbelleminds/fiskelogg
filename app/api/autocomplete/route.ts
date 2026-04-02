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
    const field = searchParams.get('field')

    if (!field || !['catcher_name', 'water_body', 'lure_name'].includes(field)) {
      return NextResponse.json({ error: 'Ogiltigt fält' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Get distinct non-null values for this field from user's catches
    const { data, error } = await admin
      .from('catches')
      .select(field)
      .eq('user_id', user.id)
      .not(field, 'is', null)
      .not(field, 'eq', '')

    if (error) {
      console.error('Autocomplete error:', error)
      return NextResponse.json({ error: 'Kunde inte hämta förslag' }, { status: 500 })
    }

    // Extract unique values, sorted alphabetically
    const values = Array.from(
      new Set(
        (data || []).map((row: unknown) => (row as Record<string, string>)[field]).filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'sv'))

    return NextResponse.json(values, {
      headers: { 'Cache-Control': 'private, max-age=120' }, // 2 min
    })
  } catch (error) {
    console.error('Autocomplete error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
