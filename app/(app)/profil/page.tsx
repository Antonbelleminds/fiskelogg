'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getCache, setCache } from '@/lib/cache'
import { usePin } from '@/contexts/PinContext'
import { generateSalt, deriveVerificationHash, deriveEncryptionKey, encryptLocation, type EncryptedLocation } from '@/lib/crypto'
import type { Profile, FriendWithProfile } from '@/types/database'

interface TeamMember {
  user_id: string
  role: string
  name: string
  status: string
}

interface TeamWithMeta {
  id: string
  name: string
  created_by: string
  member_count: number
  members: TeamMember[]
  my_role: string
  my_status: string
}

export default function ProfilPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [teams, setTeams] = useState<TeamWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [friendCode, setFriendCode] = useState('')
  const [friendError, setFriendError] = useState('')
  const [friendSuccess, setFriendSuccess] = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [codeCopied, setCodyCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
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
      // Try cache first for instant display
      const cachedProfile = getCache<{ profile: Profile; friends: FriendWithProfile[]; teams: TeamWithMeta[]; userId: string }>('profile-data')
      if (cachedProfile) {
        setProfile(cachedProfile.profile)
        setFriends(cachedProfile.friends)
        setTeams(cachedProfile.teams)
        setUserId(cachedProfile.userId)
        setLoading(false)
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const [profileRes, friendsRes, teamsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        fetch('/api/friends').then(r => r.ok ? r.json() : []),
        fetch('/api/teams').then(r => r.ok ? r.json() : []),
      ])

      if (profileRes.data) setProfile(profileRes.data)
      setFriends(friendsRes)
      setTeams(teamsRes)
      setLoading(false)

      // Cache for next visit
      setCache('profile-data', {
        profile: profileRes.data,
        friends: friendsRes,
        teams: teamsRes,
        userId: user.id,
      })
    }
    load()
  }, [supabase])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/logga-in')
    router.refresh()
  }

  async function saveDisplayName() {
    if (!userId || !newDisplayName.trim()) return
    setSavingName(true)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: newDisplayName.trim() })
      .eq('id', userId)
    if (!error) {
      setProfile((prev) => prev ? { ...prev, display_name: newDisplayName.trim() } : null)
      setEditingName(false)
    }
    setSavingName(false)
  }

  async function handleAvatarUpload(file: File) {
    setUploadingAvatar(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload-avatar', { method: 'POST', body: fd })
      if (res.ok) {
        const { url } = await res.json()
        setProfile((prev) => prev ? { ...prev, avatar_url: url } : null)
      }
    } catch {}
    setUploadingAvatar(false)
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

  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [teamError, setTeamError] = useState('')

  async function removeMember(teamId: string, memberUserId: string) {
    await fetch(`/api/teams/${teamId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: memberUserId }),
    })
    await loadTeams()
  }

  async function respondToInvite(teamId: string, action: 'accept' | 'decline') {
    await fetch(`/api/teams/${teamId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    await loadTeams()
  }

  async function addFriendToTeam(teamId: string, friendUserId: string) {
    setAddingMember(`${teamId}-${friendUserId}`)
    setTeamError('')
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: friendUserId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setTeamError(data.error || 'Kunde inte lägga till medlem')
        setTimeout(() => setTeamError(''), 3000)
      }
      await loadTeams()
    } catch {
      setTeamError('Något gick fel')
      setTimeout(() => setTeamError(''), 3000)
    } finally {
      setAddingMember(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6 animate-pulse">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div>
            <div className="h-5 w-28 bg-slate-200 dark:bg-slate-700 rounded mb-2" />
            <div className="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded" />
          </div>
        </div>
        <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl mb-4" />
        <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded-xl" />
      </div>
    )
  }

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
        {/* Avatar with upload */}
        <div className="relative inline-block mb-3">
          <button
            onClick={() => avatarInputRef.current?.click()}
            className="w-20 h-20 rounded-full overflow-hidden bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-3xl relative group"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Profilbild" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
            )}
            <div className="absolute inset-0 bg-black/30 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              </svg>
            </div>
            {uploadingAvatar && (
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f) }}
          />
        </div>
        {editingName ? (
          <div className="flex items-center justify-center gap-2 mt-1">
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="Ditt visningsnamn..."
              autoFocus
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500 w-44"
            />
            <button
              onClick={saveDisplayName}
              disabled={savingName || !newDisplayName.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-700 text-white disabled:opacity-50"
            >
              {savingName ? '...' : 'Spara'}
            </button>
            <button
              onClick={() => setEditingName(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            >
              Avbryt
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-xl font-semibold">{profile?.display_name || profile?.username}</h1>
            <button
              onClick={() => {
                setNewDisplayName(profile?.display_name || profile?.username || '')
                setEditingName(true)
              }}
              className="text-slate-400 hover:text-slate-600 transition"
              title="Ändra namn"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
          </div>
        )}
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
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition"
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

        {/* Pending invites */}
        {teams.filter(t => t.my_status === 'pending').length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Inbjudningar</div>
            {teams.filter(t => t.my_status === 'pending').map(t => (
              <div key={t.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                <div className="text-sm font-medium mb-1">{t.name}</div>
                <div className="text-xs text-slate-500 mb-2">
                  {t.member_count} {t.member_count === 1 ? 'medlem' : 'medlemmar'}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => respondToInvite(t.id, 'accept')}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-700 text-white hover:bg-primary-800 transition"
                  >
                    Acceptera
                  </button>
                  <button
                    onClick={() => respondToInvite(t.id, 'decline')}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                  >
                    Avvisa
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Accepted teams */}
        {teams.filter(t => t.my_status === 'accepted').length > 0 ? (
          <div className="space-y-3">
            {teams.filter(t => t.my_status === 'accepted').map((t) => {
              const isAdmin = t.created_by === userId
              const acceptedMembers = t.members.filter(m => m.status === 'accepted')
              const pendingMembers = t.members.filter(m => m.status === 'pending')

              return (
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
                      {isAdmin ? (
                        <button
                          onClick={() => deleteTeam(t.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Ta bort lag
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

                  {/* Accepted members */}
                  {acceptedMembers.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <div className="text-xs text-slate-500 mb-1.5">Medlemmar:</div>
                      <div className="space-y-1">
                        {acceptedMembers.map((m) => (
                          <div
                            key={m.user_id}
                            className="flex items-center justify-between px-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700"
                          >
                            <span className="inline-flex items-center gap-1">
                              <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                              </svg>
                              <span className="dark:text-slate-300">{m.name}</span>
                              {m.role === 'admin' && <span className="text-[9px] text-amber-500 font-medium">Admin</span>}
                            </span>
                            {isAdmin && m.user_id !== userId && (
                              <button
                                onClick={() => removeMember(t.id, m.user_id)}
                                className="text-[10px] text-red-400 hover:text-red-600 ml-2"
                              >
                                Ta bort
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pending invites (visible to admin) */}
                  {isAdmin && pendingMembers.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <div className="text-xs text-slate-500 mb-1.5">Väntande inbjudningar:</div>
                      <div className="space-y-1">
                        {pendingMembers.map((m) => (
                          <div
                            key={m.user_id}
                            className="flex items-center justify-between px-2 py-1.5 text-xs rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                          >
                            <span className="text-amber-700 dark:text-amber-300">{m.name} (inbjuden)</span>
                            <button
                              onClick={() => removeMember(t.id, m.user_id)}
                              className="text-[10px] text-red-400 hover:text-red-600"
                            >
                              Avbryt
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add friend to team - only show friends NOT already in the team */}
                  {isAdmin && (() => {
                    const memberIds = new Set((t.members || []).map(m => m.user_id))
                    const friendsNotInTeam = acceptedFriends.filter(f => {
                      const friendUserId = f.requester_id === userId ? f.addressee_id : f.requester_id
                      return !memberIds.has(friendUserId)
                    })
                    if (friendsNotInTeam.length === 0) return null
                    return (
                      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                        <div className="text-xs text-slate-500 mb-1">Bjud in vän till laget:</div>
                        {teamError && <p className="text-xs text-red-500 mb-1">{teamError}</p>}
                        <div className="flex flex-wrap gap-1">
                          {friendsNotInTeam.map((f) => {
                            const friendUserId = f.requester_id === userId ? f.addressee_id : f.requester_id
                            const isAdding = addingMember === `${t.id}-${friendUserId}`
                            return (
                              <button
                                key={f.id}
                                onClick={() => addFriendToTeam(t.id, friendUserId)}
                                disabled={isAdding}
                                className="px-2 py-1 text-xs rounded-md bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition disabled:opacity-50"
                              >
                                {isAdding ? (
                                  <span className="flex items-center gap-1">
                                    <span className="w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                                    Bjuder in...
                                  </span>
                                ) : (
                                  `+ ${f.friend_profile?.display_name || f.friend_profile?.username}`
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        ) : teams.filter(t => t.my_status === 'pending').length === 0 ? (
          <p className="text-sm text-slate-500">Inga lag ännu. Skapa ett!</p>
        ) : null}
      </div>

      {/* Logout */}
      {/* Fiskepin */}
      <FiskepinSection userId={userId} />

      <button
        onClick={handleLogout}
        className="w-full mt-8 py-3 text-red-600 font-medium text-sm rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition"
      >
        Logga ut
      </button>
    </div>
  )
}

function FiskepinSection({ userId }: { userId: string | null }) {
  const { hasPinSet, isUnlocked, setProfilePin, encryptionKey } = usePin()
  const [pinInput, setPinInput] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [encrypting, setEncrypting] = useState(false)
  const [encryptProgress, setEncryptProgress] = useState({ current: 0, total: 0 })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSetPin() {
    if (!userId) return
    if (pinInput.length < 4 || pinInput.length > 6) {
      setError('Pinkoden måste vara 4-6 siffror.')
      return
    }
    if (pinInput !== confirmInput) {
      setError('Pinkoderna matchar inte.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const salt = generateSalt()
      const hash = await deriveVerificationHash(pinInput, salt)

      const { error: dbError } = await supabase
        .from('profiles')
        .update({ pin_hash: hash, pin_salt: salt })
        .eq('id', userId)

      if (dbError) throw dbError

      setProfilePin(hash, salt)
      setPinInput('')
      setConfirmInput('')
      setMessage('Fiskepin sparad! Ladda om sidan och ange din pin för att aktivera kryptering.')
    } catch {
      setError('Kunde inte spara pinkoden.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemovePin() {
    if (!userId) return
    setRemoving(true)
    setError('')
    try {
      const { error: dbError } = await supabase
        .from('profiles')
        .update({ pin_hash: null, pin_salt: null })
        .eq('id', userId)

      if (dbError) throw dbError

      setProfilePin(null, null)
      setMessage('Fiskepin borttagen. Befintligt krypterade platser förblir krypterade.')
    } catch {
      setError('Kunde inte ta bort pinkoden.')
    } finally {
      setRemoving(false)
    }
  }

  async function handleEncryptExisting() {
    if (!userId || !encryptionKey) return
    setEncrypting(true)
    setError('')
    setMessage('')

    try {
      // Fetch all unencrypted catches with location data
      const res = await fetch('/api/catches?limit=100&scope=mine')
      if (!res.ok) throw new Error('Fetch failed')
      const catches = await res.json()
      const unencrypted = (catches as Array<{
        id: string; exif_lat: number | null; exif_lng: number | null;
        location_name: string | null; water_body: string | null;
        location_encrypted: boolean
      }>).filter(c =>
        !c.location_encrypted && (c.exif_lat || c.exif_lng || c.location_name || c.water_body)
      )

      if (unencrypted.length === 0) {
        setMessage('Alla fångster med platsdata är redan krypterade.')
        setEncrypting(false)
        return
      }

      setEncryptProgress({ current: 0, total: unencrypted.length })

      for (let i = 0; i < unencrypted.length; i++) {
        setEncryptProgress({ current: i + 1, total: unencrypted.length })
        const c = unencrypted[i]
        const locationData: EncryptedLocation = {
          exif_lat: c.exif_lat, exif_lng: c.exif_lng,
          location_name: c.location_name, water_body: c.water_body,
        }

        const { encrypted_location, encryption_iv } = await encryptLocation(locationData, encryptionKey)

        // Update the catch via PATCH
        await fetch(`/api/catches/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exif_lat: null, exif_lng: null, location: null,
            location_name: null, water_body: null,
            location_encrypted: true, encrypted_location, encryption_iv,
          }),
        })
      }

      setMessage(`${unencrypted.length} fångster krypterade!`)
    } catch {
      setError('Kunde inte kryptera befintliga fångster.')
    } finally {
      setEncrypting(false)
    }
  }

  return (
    <div className="mt-8 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <h3 className="font-semibold text-sm">Fiskepin (valfritt)</h3>
      </div>

      <p className="text-xs text-slate-500 mb-2">
        Dina fiskeplaster skyddas redan — ingen annan användare kan se dem. Med en fiskepin krypteras platserna
        så att inte ens den som administrerar databasen kan läsa dem.
      </p>

      <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-2">
        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
          AES-256-GCM &middot; PBKDF2-SHA256 (200k iter) &middot; Unik IV per fångst &middot; Web Crypto API
        </p>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 mb-3">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Glömmer du pinkoden går platsdata inte att återställa.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-xs mb-3">{error}</div>
      )}
      {message && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-xl text-xs mb-3">{message}</div>
      )}

      {hasPinSet ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">Fiskepin aktiv</span>
            {isUnlocked && (
              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Upplåst</span>
            )}
          </div>

          {isUnlocked && (
            <button
              onClick={handleEncryptExisting}
              disabled={encrypting}
              className="w-full py-2.5 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition"
            >
              {encrypting
                ? `Krypterar ${encryptProgress.current} av ${encryptProgress.total}...`
                : 'Kryptera befintliga fångster'
              }
            </button>
          )}

          <button
            onClick={handleRemovePin}
            disabled={removing}
            className="w-full py-2 text-xs text-red-500 font-medium rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition"
          >
            {removing ? 'Tar bort...' : 'Ta bort fiskepin'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pinInput}
            onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
            placeholder="Ny PIN (4-6 siffror)"
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-700"
          />
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={confirmInput}
            onChange={e => setConfirmInput(e.target.value.replace(/\D/g, ''))}
            placeholder="Bekräfta PIN"
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-700"
          />
          <button
            onClick={handleSetPin}
            disabled={saving || pinInput.length < 4}
            className="w-full py-2.5 text-sm font-medium rounded-xl bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-40 transition"
          >
            {saving ? 'Sparar...' : 'Spara fiskepin'}
          </button>
        </div>
      )}
    </div>
  )
}
