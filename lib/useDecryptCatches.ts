'use client'

import { useEffect, useRef, useState } from 'react'
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

interface DecryptCatchStatus {
  isDecrypting: boolean
  decryptedCount: number
  failedCount: number
}

/**
 * Hook that decrypts encrypted location fields on catches when the PIN is unlocked.
 * Calls setCatches with decrypted values and reports failures instead of silently
 * treating a verified PIN as a successful location unlock.
 */
export function useDecryptCatches<T extends WithEncryption>(
  catches: T[],
  setCatches: React.Dispatch<React.SetStateAction<T[]>>
): DecryptCatchStatus {
  const { isUnlocked, decrypt } = usePin()
  const attemptedRef = useRef(new Set<string>())
  const [status, setStatus] = useState<DecryptCatchStatus>({
    isDecrypting: false,
    decryptedCount: 0,
    failedCount: 0,
  })

  useEffect(() => {
    if (!isUnlocked) return
    const encrypted = catches.filter(c =>
      c.location_encrypted && c.encrypted_location && c.encryption_iv
      && !attemptedRef.current.has(c.id)
    )
    if (encrypted.length === 0) return

    encrypted.forEach(c => attemptedRef.current.add(c.id))
    setStatus(previous => ({ ...previous, isDecrypting: true }))

    Promise.all(encrypted.map(async (c) => {
      const loc = await decrypt(c.encrypted_location!, c.encryption_iv!)
      const validCoordinates =
        loc &&
        typeof loc.exif_lat === 'number' &&
        Number.isFinite(loc.exif_lat) &&
        typeof loc.exif_lng === 'number' &&
        Number.isFinite(loc.exif_lng)

      return {
        caught: validCoordinates
          ? {
              ...c,
              exif_lat: loc.exif_lat,
              exif_lng: loc.exif_lng,
              water_body: loc.water_body,
              location_name: loc.location_name,
            }
          : c,
        decrypted: Boolean(validCoordinates),
      }
    })).then(results => {
      setCatches(prev => {
        const decMap = new Map(results.map(result => [result.caught.id, result.caught]))
        return prev.map(c => decMap.get(c.id) || c)
      })
      const decryptedCount = results.filter(result => result.decrypted).length
      setStatus(previous => ({
        isDecrypting: false,
        decryptedCount: previous.decryptedCount + decryptedCount,
        failedCount: previous.failedCount + results.length - decryptedCount,
      }))
    })
  }, [isUnlocked, catches, decrypt, setCatches])

  return status
}
