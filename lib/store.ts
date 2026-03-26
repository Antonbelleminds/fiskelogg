import { create } from 'zustand'
import type { Catch, Profile } from '@/types/database'

interface AppState {
  user: { id: string; email: string } | null
  profile: Profile | null
  catches: Catch[]
  setUser: (user: { id: string; email: string } | null) => void
  setProfile: (profile: Profile | null) => void
  setCatches: (catches: Catch[]) => void
  addCatch: (c: Catch) => void
  removeCatch: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  profile: null,
  catches: [],
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setCatches: (catches) => set({ catches }),
  addCatch: (c) => set((state) => ({ catches: [c, ...state.catches] })),
  removeCatch: (id) => set((state) => ({ catches: state.catches.filter((c) => c.id !== id) })),
}))
