import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const hash = typeof body.hash === 'string' ? body.hash : ''
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      return NextResponse.json({ error: 'Ogiltig hash' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data } = await admin
      .from('catches')
      .select('id, species, caught_at')
      .eq('user_id', user.id)
      .eq('image_hash', hash)
      .limit(1)
      .maybeSingle()

    if (data) {
      return NextResponse.json({ duplicate: true, catch: data })
    }
    return NextResponse.json({ duplicate: false })
  } catch (error) {
    console.error('Duplicate check error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
