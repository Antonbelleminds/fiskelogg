import { createBrowserClient } from '@supabase/ssr'

// Singleton: reuse the same Supabase client across the entire app session.
// Avoids re-creating auth listeners and connections on every component mount.
let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
