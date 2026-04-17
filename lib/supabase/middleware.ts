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

  const authPaths = ['/logga-in', '/registrera', '/glomt-losenord', '/aterstall-losenord']
  const isAuthPath = authPaths.some(p => request.nextUrl.pathname.startsWith(p))

  // If no user and trying to access app routes, redirect to login
  if (!user && !isAuthPath && !request.nextUrl.pathname.startsWith('/api')) {
    const url = request.nextUrl.clone()
    url.pathname = '/logga-in'
    return NextResponse.redirect(url)
  }

  // If user is logged in and on login/register, redirect to app.
  // Do NOT redirect from /aterstall-losenord — the user has a recovery session there.
  if (user && (request.nextUrl.pathname.startsWith('/logga-in') || request.nextUrl.pathname.startsWith('/registrera'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
