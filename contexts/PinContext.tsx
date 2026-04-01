'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { deriveEncryptionKey, deriveVerificationHash, encryptLocation, decryptLocation, type EncryptedLocation } from '@/lib/crypto'

interface PinContextValue {
  /** Whether the user has a pin set (pin_hash exists in profile) */
  hasPinSet: boolean
  /** Whether the pin has been entered and key is available this session */
  isUnlocked: boolean
  /** The encryption key (only available after unlock) */
  encryptionKey: CryptoKey | null
  /** Unlock by entering the correct pin */
  unlock: (pin: string) => Promise<boolean>
  /** Lock (clear key from memory) */
  lock: () => void
  /** Set context from profile data (call on mount) */
  setProfilePin: (pinHash: string | null, pinSalt: string | null) => void
  /** Pin salt (needed for key derivation) */
  pinSalt: string | null
  /** Pin hash (for verification) */
  pinHash: string | null
  /** Encrypt location data (returns null if no pin set) */
  encrypt: (data: EncryptedLocation) => Promise<{ encrypted_location: string; encryption_iv: string } | null>
  /** Decrypt location data */
  decrypt: (encryptedB64: string, ivB64: string) => Promise<EncryptedLocation | null>
}

const PinContext = createContext<PinContextValue | null>(null)

export function PinProvider({ children }: { children: ReactNode }) {
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [pinSalt, setPinSalt] = useState<string | null>(null)
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null)

  const hasPinSet = !!pinHash && !!pinSalt
  const isUnlocked = !!encryptionKey

  const setProfilePin = useCallback((hash: string | null, salt: string | null) => {
    setPinHash(hash)
    setPinSalt(salt)
    // If pin was removed, clear key
    if (!hash || !salt) setEncryptionKey(null)
  }, [])

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    if (!pinHash || !pinSalt) return false

    try {
      const hash = await deriveVerificationHash(pin, pinSalt)
      if (hash !== pinHash) return false

      const key = await deriveEncryptionKey(pin, pinSalt)
      setEncryptionKey(key)
      return true
    } catch {
      return false
    }
  }, [pinHash, pinSalt])

  const lock = useCallback(() => {
    setEncryptionKey(null)
  }, [])

  const encrypt = useCallback(async (data: EncryptedLocation) => {
    if (!encryptionKey) return null
    return encryptLocation(data, encryptionKey)
  }, [encryptionKey])

  const decrypt = useCallback(async (encryptedB64: string, ivB64: string) => {
    if (!encryptionKey) return null
    try {
      return await decryptLocation(encryptedB64, ivB64, encryptionKey)
    } catch {
      return null
    }
  }, [encryptionKey])

  return (
    <PinContext.Provider value={{
      hasPinSet, isUnlocked, encryptionKey,
      unlock, lock, setProfilePin,
      pinSalt, pinHash,
      encrypt, decrypt,
    }}>
      {children}
    </PinContext.Provider>
  )
}

export function usePin() {
  const ctx = useContext(PinContext)
  if (!ctx) throw new Error('usePin must be used inside PinProvider')
  return ctx
}
