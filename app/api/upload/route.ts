import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'Ingen fil' }, { status: 400 })
    }

    // Validate file type
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Otillåten filtyp. Bara bilder tillåtna.' }, { status: 400 })
    }

    // Validate file size (max 10 MB)
    const MAX_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Filen är för stor. Max 10 MB.' }, { status: 413 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const fileName = `${user.id}/${Date.now()}.${ext}`

    const admin = createAdminClient()
    const { data, error } = await admin.storage
      .from('catch-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (error) {
      console.error('Upload error:', error)
      return NextResponse.json({ error: 'Uppladdning misslyckades' }, { status: 500 })
    }

    const { data: urlData } = admin.storage
      .from('catch-images')
      .getPublicUrl(data.path)

    return NextResponse.json({
      path: data.path,
      url: urlData.publicUrl,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Uppladdning misslyckades' }, { status: 500 })
  }
}
