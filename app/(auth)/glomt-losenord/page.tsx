'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function GlomtLosenordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/aterstall-losenord`,
    })

    setLoading(false)

    if (error) {
      setError('Något gick fel. Kontrollera e-postadressen och försök igen.')
      return
    }

    setSent(true)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="text-5xl mb-3">🐟</div>
          <h1 className="text-2xl font-semibold text-slate-900">Glömt lösenord?</h1>
          <p className="text-slate-500 mt-1">Vi skickar en återställningslänk till din e-post</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-4 rounded-xl text-sm text-center">
              <p className="font-medium mb-1">Kolla din e-post!</p>
              <p>Vi har skickat en länk till <strong>{email}</strong>. Klicka på länken för att skapa ett nytt lösenord.</p>
            </div>
            <p className="text-center text-sm text-slate-500">
              Inget mail?{' '}
              <button
                onClick={() => setSent(false)}
                className="text-primary-700 font-medium hover:underline"
              >
                Försök igen
              </button>
            </p>
          </div>
        ) : (
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
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                placeholder="din@email.se"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-primary-700 text-white font-medium hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 transition"
            >
              {loading ? 'Skickar...' : 'Skicka återställningslänk'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-500">
          <Link href="/logga-in" className="text-primary-700 font-medium hover:underline">
            ← Tillbaka till inloggning
          </Link>
        </p>
      </div>
    </div>
  )
}
