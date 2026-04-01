import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Ingen fil' }, { status: 400 })

    // Validate file type
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Otillåten filtyp. Bara bilder tillåtna.' }, { status: 400 })
    }

    // Validate file size (max 5 MB for avatars)
    const MAX_SIZE = 5 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Filen är för stor. Max 5 MB.' }, { status: 413 })
    }

    const admin = createAdminClient()
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const fileName = `${user.id}/avatar.${ext}`

    const { data, error } = await admin.storage
      .from('avatars')
      .upload(fileName, file, { cacheControl: '3600', upsert: true })

    if (error) {
      // If bucket doesn't exist, try catch-images as fallback
      const { data: fallback, error: fallbackErr } = await admin.storage
        .from('catch-images')
        .upload(`avatars/${fileName}`, file, { cacheControl: '3600', upsert: true })
      if (fallbackErr) return NextResponse.json({ error: 'Uppladdning misslyckades' }, { status: 500 })
      const { data: urlData } = admin.storage.from('catch-images').getPublicUrl(`avatars/${fileName}`)
      const url = urlData.publicUrl
      await admin.from('profiles').update({ avatar_url: url }).eq('id', user.id)
      return NextResponse.json({ url })
    }

    const { data: urlData } = admin.storage.from('avatars').getPublicUrl(data.path)
    const url = urlData.publicUrl
    await admin.from('profiles').update({ avatar_url: url }).eq('id', user.id)
    return NextResponse.json({ url })
  } catch (err) {
    console.error('Avatar upload error:', err)
    return NextResponse.json({ error: 'Uppladdning misslyckades' }, { status: 500 })
  }
}
