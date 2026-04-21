'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PinProvider, usePin } from '@/contexts/PinContext'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/', label: 'Hem', icon: HomeIcon },
  { href: '/stats', label: 'Statistik', icon: StatsIcon },
  { href: '/lagg-till', label: 'Lägg till', icon: PlusIcon, isMain: true },
  { href: '/karta', label: 'Karta', icon: MapIcon },
  { href: '/profil', label: 'Profil', icon: UserIcon },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PinProvider>
      <PinGate>{children}</PinGate>
    </PinProvider>
  )
}

function PinGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { hasPinSet, isUnlocked, unlock, setProfilePin } = usePin()
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [loaded, setLoaded] = useState(false)

  // Load pin_hash/pin_salt from profile on mount (cached to avoid blocking)
  useEffect(() => {
    // Check sessionStorage first (instant)
    const cached = sessionStorage.getItem('fiskepin-profile')
    if (cached) {
      try {
        const { pin_hash, pin_salt } = JSON.parse(cached)
        if (pin_hash && pin_salt) setProfilePin(pin_hash, pin_salt)
        setLoaded(true)
        return
      } catch {}
    }

    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoaded(true); return }
      const { data } = await supabase
        .from('user_secrets')
        .select('pin_hash, pin_salt')
        .eq('id', user.id)
        .maybeSingle()
      if (data?.pin_hash && data?.pin_salt) {
        setProfilePin(data.pin_hash, data.pin_salt)
        sessionStorage.setItem('fiskepin-profile', JSON.stringify({ pin_hash: data.pin_hash, pin_salt: data.pin_salt }))
      }
      setLoaded(true)
    })
  }, [setProfilePin])

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (attempts >= 5) return
    setPinError('')
    const ok = await unlock(pinInput)
    if (!ok) {
      setAttempts(a => a + 1)
      setPinError(attempts >= 4 ? 'För många försök. Ladda om sidan.' : 'Fel pin. Försök igen.')
      setPinInput('')
    }
  }

  // Show PIN overlay if pin is set but not unlocked
  const showOverlay = loaded && hasPinSet && !isUnlocked

  return (
    <div className="min-h-dvh flex flex-col pb-20">
      {/* PIN Overlay */}
      {showOverlay && (
        <div className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 flex items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-6 text-center">
            <div>
              <LockIcon />
              <h2 className="text-xl font-semibold mt-4">Ange din fiskepin</h2>
              <p className="text-sm text-slate-500 mt-1">
                Din platsdata är krypterad. Ange pinkoden för att låsa upp.
              </p>
            </div>
            <form onSubmit={handlePinSubmit} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pinInput}
                onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="PIN"
                autoFocus
                disabled={attempts >= 5}
                className="w-full text-center text-2xl tracking-[0.5em] px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-700"
              />
              {pinError && <p className="text-sm text-red-500">{pinError}</p>}
              <button
                type="submit"
                disabled={pinInput.length < 4 || attempts >= 5}
                className="w-full py-3 rounded-xl bg-primary-700 text-white font-medium disabled:opacity-40 transition"
              >
                Lås upp
              </button>
            </form>
            <p className="text-xs text-slate-400">
              Du kan använda appen utan pin — platsdata visas då inte.
            </p>
            <button
              onClick={() => setProfilePin(null, null)}
              className="text-xs text-slate-400 underline"
            >
              Fortsätt utan att låsa upp
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between max-w-lg mx-auto h-11 px-4">
          <Link href="/" aria-label="Fiskeloggboken">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fiskeloggboken-logo.png"
              alt="Fiskeloggboken"
              width={162}
              height={32}
              className="h-7 w-auto"
            />
          </Link>
          <Link
            href="/vader"
            className={`p-1.5 rounded-lg transition-colors ${
              pathname.startsWith('/vader')
                ? 'text-primary-700'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <WeatherIcon className="w-5 h-5" />
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <nav className="fixed bottom-2 left-2 right-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl safe-area-bottom z-50 shadow-lg">
        <div className="flex items-center justify-around max-w-lg mx-auto h-16">
          {navItems.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
            const Icon = item.icon

            if (item.isMain) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-center -mt-6 w-14 h-14 rounded-full bg-primary-700 text-white shadow-lg hover:bg-primary-800 active:scale-95 transition-transform"
                >
                  <Icon className="w-7 h-7" />
                </Link>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                  isActive
                    ? 'text-primary-700'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )
}

function StatsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
    </svg>
  )
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="w-12 h-12 mx-auto text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  )
}

function WeatherIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
    </svg>
  )
}
