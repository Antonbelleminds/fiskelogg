import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as never)
          )
        },
      },
    }
  )

  // Use getSession() instead of getUser() for faster middleware
  // getSession() reads from cookie (local, instant) vs getUser() which makes a network call to Supabase
  // API routes still verify the user via getUser() for security
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  // If no user and trying to access app routes, redirect to login
  if (!user && !request.nextUrl.pathname.startsWith('/logga-in') && !request.nextUrl.pathname.startsWith('/registrera') && !request.nextUrl.pathname.startsWith('/api')) {
    const url = request.nextUrl.clone()
    url.pathname = '/logga-in'
    return NextResponse.redirect(url)
  }

  // If user and on auth pages, redirect to app
  if (user && (request.nextUrl.pathname.startsWith('/logga-in') || request.nextUrl.pathname.startsWith('/registrera'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
