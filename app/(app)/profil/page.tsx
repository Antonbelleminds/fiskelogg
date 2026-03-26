'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import CatchCard from '@/components/catches/CatchCard'
import type { Profile, CatchWithProfile } from '@/types/database'

export default function ProfilPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [catches, setCatches] = useState<CatchWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileData) setProfile(profileData)

      const res = await fetch('/api/catches?limit=50')
      if (res.ok) {
        const data = await res.json()
        setCatches(data)
      }

      setLoading(false)
    }
    load()
  }, [supabase])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/logga-in')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700" />
      </div>
    )
  }

  const speciesCount = new Set(catches.filter((c) => c.species).map((c) => c.species)).size
  const heaviest = catches.reduce((max, c) => (c.weight_kg && c.weight_kg > (max?.weight_kg || 0) ? c : max), catches[0])

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      {/* Profile header */}
      <div className="text-center mb-6">
        <div className="w-20 h-20 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-3xl mx-auto mb-3">
          🎣
        </div>
        <h1 className="text-xl font-semibold">{profile?.display_name || profile?.username}</h1>
        {profile?.bio && <p className="text-sm text-slate-500 mt-1">{profile.bio}</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-semibold">{catches.length}</div>
          <div className="text-xs text-slate-500">Fångster</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-semibold">{speciesCount}</div>
          <div className="text-xs text-slate-500">Arter</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-semibold">{heaviest?.weight_kg ? `${heaviest.weight_kg}` : '—'}</div>
          <div className="text-xs text-slate-500">{heaviest?.weight_kg ? 'kg PB' : 'PB'}</div>
        </div>
      </div>

      {/* Recent catches */}
      <h2 className="text-lg font-semibold mb-3">Mina fångster</h2>
      {catches.length > 0 ? (
        <div className="space-y-4">
          {catches.slice(0, 10).map((c) => (
            <CatchCard key={c.id} catch={c} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-slate-500 text-sm">
          Inga fångster ännu
        </div>
      )}

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full mt-8 py-3 text-red-600 font-medium text-sm rounded-xl hover:bg-red-50 transition"
      >
        Logga ut
      </button>
    </div>
  )
}
