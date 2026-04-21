import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

async function assertCatchAccess(
  admin: ReturnType<typeof createAdminClient>,
  catchId: string,
  userId: string
): Promise<boolean> {
  const { data } = await admin
    .from('catches')
    .select('user_id, is_public')
    .eq('id', catchId)
    .maybeSingle()
  if (!data) return false
  if (data.user_id === userId) return true
  if (data.is_public) return true
  const { data: friendships } = await admin
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
  return (friendships || []).some(
    f =>
      (f.requester_id === userId && f.addressee_id === data.user_id) ||
      (f.addressee_id === userId && f.requester_id === data.user_id)
  )
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: catchId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const admin = createAdminClient()

    if (!(await assertCatchAccess(admin, catchId, user.id))) {
      return NextResponse.json({ error: 'Ingen behörighet' }, { status: 403 })
    }

    // Simple query without joins to avoid ambiguous FK issues
    const { data: likes, error } = await admin
      .from('likes')
      .select('id, user_id, created_at')
      .eq('catch_id', catchId)

    if (error) {
      console.error('Fetch likes error:', error)
      return NextResponse.json({ error: 'Kunde inte hämta likes' }, { status: 500 })
    }

    const userLiked = (likes || []).some(l => l.user_id === user.id)

    return NextResponse.json({
      count: (likes || []).length,
      userLiked,
    })
  } catch (error) {
    console.error('Likes error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: catchId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const admin = createAdminClient()

    if (!(await assertCatchAccess(admin, catchId, user.id))) {
      return NextResponse.json({ error: 'Ingen behörighet' }, { status: 403 })
    }

    // Toggle like: check if already liked
    const { data: existing } = await admin
      .from('likes')
      .select('id')
      .eq('catch_id', catchId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      // Unlike
      await admin.from('likes').delete().eq('id', existing.id)
      // Get new count
      const { count } = await admin.from('likes').select('*', { count: 'exact', head: true }).eq('catch_id', catchId)
      return NextResponse.json({ liked: false, count: count || 0 })
    } else {
      // Like
      const { error } = await admin.from('likes').insert({ catch_id: catchId, user_id: user.id })
      if (error) {
        console.error('Insert like error:', error)
        return NextResponse.json({ error: 'Kunde inte gilla' }, { status: 500 })
      }
      const { count } = await admin.from('likes').select('*', { count: 'exact', head: true }).eq('catch_id', catchId)
      return NextResponse.json({ liked: true, count: count || 0 })
    }
  } catch (error) {
    console.error('Toggle like error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
