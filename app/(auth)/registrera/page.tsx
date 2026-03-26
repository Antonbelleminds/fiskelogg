'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    })

    if (error) {
      setError(error.message === 'User already registered'
        ? 'Den här e-postadressen är redan registrerad.'
        : `Fel: ${error.message}`)
      setLoading(false)
      return
    }

    // If email confirmation is required, user won't have a session yet
    if (data.user && !data.session) {
      setError('')
      setLoading(false)
      // Auto-login after signup (works when email confirmation is disabled)
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        // Email confirmation is probably required
        setError('Konto skapat! Kontrollera din e-post för att bekräfta kontot.')
        return
      }
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="text-5xl mb-3">🐟</div>
          <h1 className="text-2xl font-semibold text-slate-900">Skapa konto</h1>
          <p className="text-slate-500 mt-1">Börja logga dina fångster</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              E-post
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              placeholder="din@email.se"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Lösenord
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              placeholder="Minst 6 tecken"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Skapar konto...' : 'Registrera'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500">
          Har du redan ett konto?{' '}
          <Link href="/logga-in" className="text-primary-700 font-medium hover:underline">
            Logga in
          </Link>
        </p>
      </div>
    </div>
  )
}
