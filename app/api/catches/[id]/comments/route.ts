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

    // Fetch comments without profile join first
    const { data: comments, error } = await admin
      .from('comments')
      .select('id, user_id, text, created_at')
      .eq('catch_id', catchId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Fetch comments error:', error)
      return NextResponse.json({ error: 'Kunde inte hämta kommentarer' }, { status: 500 })
    }

    if (!comments || comments.length === 0) {
      return NextResponse.json([])
    }

    // Fetch profiles separately to avoid FK ambiguity
    const userIds = Array.from(new Set(comments.map(c => c.user_id)))
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .in('id', userIds)

    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    const result = comments.map(c => ({
      ...c,
      profiles: profileMap.get(c.user_id) || { display_name: null, username: null, avatar_url: null },
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Comments error:', error)
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

    const { text } = await req.json()

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Kommentar saknas' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (!(await assertCatchAccess(admin, catchId, user.id))) {
      return NextResponse.json({ error: 'Ingen behörighet' }, { status: 403 })
    }

    // Insert comment
    const { data: comment, error } = await admin
      .from('comments')
      .insert({ catch_id: catchId, user_id: user.id, text: text.trim() })
      .select('id, user_id, text, created_at')
      .single()

    if (error) {
      console.error('Create comment error:', error)
      return NextResponse.json({ error: 'Kunde inte spara kommentar' }, { status: 500 })
    }

    // Fetch profile separately
    const { data: profile } = await admin
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .eq('id', user.id)
      .single()

    return NextResponse.json({
      ...comment,
      profiles: profile || { display_name: null, username: null, avatar_url: null },
    }, { status: 201 })
  } catch (error) {
    console.error('Comment error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}
