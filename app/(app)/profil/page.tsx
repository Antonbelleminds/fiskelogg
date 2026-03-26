'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import CatchCard from '@/components/catches/CatchCard'
import type { Profile, CatchWithProfile, FriendWithProfile } from '@/types/database'

interface TeamWithMeta {
  id: string
  name: string
  created_by: string
  member_count: number
  my_role: string
}

export default function ProfilPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [catches, setCatches] = useState<CatchWithProfile[]>([])
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [teams, setTeams] = useState<TeamWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [friendCode, setFriendCode] = useState('')
  const [friendError, setFriendError] = useState('')
  const [friendSuccess, setFriendSuccess] = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [codeCopied, setCodyCopied] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const loadFriends = useCallback(async () => {
    const res = await fetch('/api/friends')
    if (res.ok) {
      const data = await res.json()
      setFriends(data)
    }
  }, [])

  const loadTeams = useCallback(async () => {
    const res = await fetch('/api/teams')
    if (res.ok) {
      const data = await res.json()
      setTeams(data)
    }
  }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

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

      await loadFriends()
      await loadTeams()
      setLoading(false)
    }
    load()
  }, [supabase, loadFriends, loadTeams])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/logga-in')
    router.refresh()
  }

  async function copyFriendCode() {
    if (!profile?.friend_code) return
    try {
      await navigator.clipboard.writeText(profile.friend_code)
      setCodyCopied(true)
      setTimeout(() => setCodyCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  async function shareFriendCode() {
    if (!profile?.friend_code) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'FiskeLogg - Lägg till mig som vän!',
          text: `Lägg till mig på FiskeLogg med koden: ${profile.friend_code}`,
        })
      } catch {
        // User cancelled
      }
    }
  }

  async function sendFriendRequest() {
    setFriendError('')
    setFriendSuccess('')
    if (!friendCode.trim()) return

    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friend_code: friendCode.trim() }),
    })

    const data = await res.json()
    if (!res.ok) {
      setFriendError(data.error || 'Något gick fel')
      return
    }

    setFriendSuccess('Vänförfrågan skickad!')
    setFriendCode('')
    await loadFriends()
  }

  async function acceptFriend(id: string) {
    await fetch(`/api/friends/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    })
    await loadFriends()
  }

  async function removeFriend(id: string) {
    await fetch(`/api/friends/${id}`, { method: 'DELETE' })
    await loadFriends()
  }

  async function toggleShareLocation(id: string, currentValue: boolean) {
    await fetch(`/api/friends/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_location: !currentValue }),
    })
    await loadFriends()
  }

  async function createTeam() {
    if (!newTeamName.trim()) return
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName.trim() }),
    })
    if (res.ok) {
      setNewTeamName('')
      await loadTeams()
    }
  }

  async function leaveTeam(teamId: string) {
    if (!userId) return
    await fetch(`/api/teams/${teamId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    await loadTeams()
  }

  async function deleteTeam(teamId: string) {
    await fetch(`/api/teams/${teamId}`, { method: 'DELETE' })
    await loadTeams()
  }

  async function addFriendToTeam(teamId: string, friendUserId: string) {
    await fetch(`/api/teams/${teamId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: friendUserId }),
    })
    await loadTeams()
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

  const pendingRequests = friends.filter(
    (f) => f.status === 'pending' && f.addressee_id === userId
  )
  const pendingSent = friends.filter(
    (f) => f.status === 'pending' && f.requester_id === userId
  )
  const acceptedFriends = friends.filter((f) => f.status === 'accepted')

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

      {/* Friend code */}
      {profile?.friend_code && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 mb-4">
          <div className="text-xs text-slate-500 mb-1">Din vänkod</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-lg font-mono font-semibold tracking-wider">
              {profile.friend_code}
            </code>
            <button
              onClick={copyFriendCode}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition"
            >
              {codeCopied ? 'Kopierad!' : 'Kopiera'}
            </button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button
                onClick={shareFriendCode}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50 transition"
              >
                Dela
              </button>
            )}
          </div>
        </div>
      )}

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

      {/* Pending friend requests */}
      {pendingRequests.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Vänförfrågningar</h2>
          <div className="space-y-2">
            {pendingRequests.map((f) => (
              <div
                key={f.id}
                className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-3 border border-yellow-200 dark:border-yellow-800 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-medium text-sm">
                    {f.friend_profile?.display_name || f.friend_profile?.username || 'Okänd'}
                  </div>
                  <div className="text-xs text-slate-500">Vill bli din vän</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => acceptFriend(f.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
                  >
                    Acceptera
                  </button>
                  <button
                    onClick={() => removeFriend(f.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 hover:bg-red-200 transition"
                  >
                    Avböj
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Vänner</h2>

        {/* Add friend */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={friendCode}
            onChange={(e) => setFriendCode(e.target.value)}
            placeholder="Ange vänkod..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={sendFriendRequest}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-700 text-white hover:bg-primary-800 transition"
          >
            Lägg till
          </button>
        </div>
        {friendError && <p className="text-xs text-red-500 mb-2">{friendError}</p>}
        {friendSuccess && <p className="text-xs text-green-600 mb-2">{friendSuccess}</p>}

        {/* Pending sent */}
        {pendingSent.length > 0 && (
          <div className="space-y-2 mb-3">
            {pendingSent.map((f) => (
              <div
                key={f.id}
                className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium text-sm">
                    {f.friend_profile?.display_name || f.friend_profile?.username || 'Okänd'}
                  </div>
                  <div className="text-xs text-yellow-600">Väntar på svar...</div>
                </div>
                <button
                  onClick={() => removeFriend(f.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Avbryt
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Accepted friends */}
        {acceptedFriends.length > 0 ? (
          <div className="space-y-2">
            {acceptedFriends.map((f) => (
              <div
                key={f.id}
                className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    {f.friend_profile?.display_name || f.friend_profile?.username || 'Okänd'}
                  </div>
                  <button
                    onClick={() => removeFriend(f.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Ta bort
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={f.share_location}
                      onChange={() => toggleShareLocation(f.id, f.share_location)}
                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    Dela plats
                  </label>
                </div>
              </div>
            ))}
          </div>
        ) : (
          pendingSent.length === 0 && (
            <p className="text-sm text-slate-500">Inga vänner ännu. Dela din vänkod!</p>
          )
        )}
      </div>

      {/* Teams section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Lag</h2>

        {/* Create team */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Nytt lagnamn..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={createTeam}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-700 text-white hover:bg-primary-800 transition"
          >
            Skapa
          </button>
        </div>

        {teams.length > 0 ? (
          <div className="space-y-3">
            {teams.map((t) => (
              <div
                key={t.id}
                className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm">{t.name}</div>
                    <div className="text-xs text-slate-500">
                      {t.member_count} {t.member_count === 1 ? 'medlem' : 'medlemmar'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {t.created_by === userId ? (
                      <button
                        onClick={() => deleteTeam(t.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Ta bort
                      </button>
                    ) : (
                      <button
                        onClick={() => leaveTeam(t.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Lämna
                      </button>
                    )}
                  </div>
                </div>

                {/* Add friend to team */}
                {acceptedFriends.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Lägg till vän:</div>
                    <div className="flex flex-wrap gap-1">
                      {acceptedFriends.map((f) => {
                        const friendUserId = f.requester_id === userId ? f.addressee_id : f.requester_id
                        return (
                          <button
                            key={f.id}
                            onClick={() => addFriendToTeam(t.id, friendUserId)}
                            className="px-2 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                          >
                            + {f.friend_profile?.display_name || f.friend_profile?.username}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Inga lag ännu. Skapa ett!</p>
        )}
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
        className="w-full mt-8 py-3 text-red-600 font-medium text-sm rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition"
      >
        Logga ut
      </button>
    </div>
  )
}
