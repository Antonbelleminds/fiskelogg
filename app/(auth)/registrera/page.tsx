'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    })

    setLoading(false)

    if (error) {
      const msg = error.message
      if (msg === 'User already registered') {
        setError('Den här e-postadressen är redan registrerad.')
      } else if (msg.includes('weak') || msg.includes('pwned') || msg.includes('known')) {
        setError('Lösenordet är för vanligt och lätt att gissa. Välj ett starkare lösenord.')
      } else if (msg.includes('Password should be')) {
        setError('Lösenordet måste vara minst 6 tecken.')
      } else if (msg.includes('valid email') || msg.includes('is invalid') || msg.includes('email_address_invalid')) {
        setError('Ogiltig e-postadress. Kontrollera att du skrivit rätt.')
      } else {
        setError(`Kunde inte skapa konto: ${msg}`)
      }
      return
    }

    setRegistered(true)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="text-5xl mb-3">🐟</div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {registered ? 'Bekräfta din e-post' : 'Skapa konto'}
          </h1>
          <p className="text-slate-500 mt-1">
            {registered ? 'Ett sista steg innan du kan logga in' : 'Börja logga dina fångster'}
          </p>
        </div>

        {registered ? (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 text-slate-800 px-5 py-5 rounded-xl text-sm space-y-3">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-primary-700 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold">Vi har skickat ett bekräftelsemail till:</p>
                  <p className="font-mono text-xs mt-1 break-all">{email}</p>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-3 space-y-2 text-slate-700">
                <p className="font-medium text-slate-900">Så här gör du:</p>
                <ol className="list-decimal list-inside space-y-1 text-slate-600">
                  <li>Öppna mailet från FiskeLogg</li>
                  <li>Klicka på bekräftelselänken</li>
                  <li>Logga in med din e-post och lösenord</li>
                </ol>
                <p className="text-xs text-slate-500 pt-2">
                  Hittar du inte mailet? Kolla <strong>skräpposten</strong>. Det kan ta några minuter innan det kommer fram.
                </p>
              </div>
            </div>
            <Link
              href="/logga-in"
              className="block w-full py-3 px-4 rounded-xl bg-primary-700 text-white font-medium text-center hover:bg-primary-800 transition"
            >
              Gå till inloggning
            </Link>
            <button
              onClick={() => {
                setRegistered(false)
                setPassword('')
              }}
              className="block w-full text-center text-sm text-slate-500 hover:underline"
            >
              Fel e-post? Registrera igen
            </button>
          </div>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl text-sm flex gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <p>Efter registrering får du ett mail med en bekräftelselänk. Du måste klicka på den för att aktivera kontot.</p>
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
          </>
        )}
      </div>
    </div>
  )
}
