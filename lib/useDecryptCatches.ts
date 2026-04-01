'use client'

import { useEffect, useRef, useCallback } from 'react'
import { usePin } from '@/contexts/PinContext'

interface WithEncryption {
  id: string
  exif_lat?: number | null
  exif_lng?: number | null
  water_body?: string | null
  location_name?: string | null
  location_encrypted?: boolean
  encrypted_location?: string | null
  encryption_iv?: string | null
}

/**
 * Hook that decrypts encrypted location fields on catches when the PIN is unlocked.
 * Calls setCatches with decrypted values. Tracks already-decrypted IDs to avoid loops.
 */
export function useDecryptCatches<T extends WithEncryption>(
  catches: T[],
  setCatches: React.Dispatch<React.SetStateAction<T[]>>
) {
  const { isUnlocked, decrypt } = usePin()
  const decryptedRef = useRef(new Set<string>())

  useEffect(() => {
    if (!isUnlocked) return
    const encrypted = catches.filter(c =>
      c.location_encrypted && c.encrypted_location && c.encryption_iv
      && !decryptedRef.current.has(c.id)
    )
    if (encrypted.length === 0) return

    encrypted.forEach(c => decryptedRef.current.add(c.id))

    Promise.all(encrypted.map(async (c) => {
      const loc = await decrypt(c.encrypted_location!, c.encryption_iv!)
      if (!loc) return c
      return {
        ...c,
        exif_lat: loc.exif_lat,
        exif_lng: loc.exif_lng,
        water_body: loc.water_body,
        location_name: loc.location_name,
      }
    })).then(decrypted => {
      setCatches(prev => {
        const decMap = new Map(decrypted.map(d => [d.id, d]))
        return prev.map(c => decMap.get(c.id) || c)
      })
    })
  }, [isUnlocked, catches, decrypt, setCatches])
}
