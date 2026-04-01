/**
 * Fiskepin encryption — Web Crypto API
 *
 * Derives a 512-bit key from PIN + salt using PBKDF2:
 *   First 256 bits  = AES-256-GCM encryption key
 *   Last 256 bits   = verification hash (stored in DB)
 *
 * Each catch gets a unique 12-byte IV for AES-GCM.
 * No external dependencies needed.
 */

const PBKDF2_ITERATIONS = 200_000
const KEY_LENGTH_BITS = 512 // 256 for encryption + 256 for verification

// --- Helpers ---

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return bufToBase64(salt.buffer)
}

function generateIV(): ArrayBuffer {
  const arr = new Uint8Array(12)
  crypto.getRandomValues(arr)
  return arr.buffer as ArrayBuffer
}

// --- Key Derivation ---

async function deriveRawBits(pin: string, saltB64: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(base64ToBuf(saltB64)),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH_BITS
  )
}

/** Derive the AES-256-GCM encryption key (first 256 bits) */
export async function deriveEncryptionKey(pin: string, saltB64: string): Promise<CryptoKey> {
  const bits = await deriveRawBits(pin, saltB64)
  const keyBytes = new Uint8Array(bits).slice(0, 32) // first 256 bits

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Derive the verification hash (last 256 bits, base64-encoded) */
export async function deriveVerificationHash(pin: string, saltB64: string): Promise<string> {
  const bits = await deriveRawBits(pin, saltB64)
  const hashBytes = new Uint8Array(bits).slice(32, 64) // last 256 bits
  return bufToBase64(hashBytes.buffer)
}

// --- Encrypt / Decrypt ---

export interface EncryptedLocation {
  exif_lat: number | null
  exif_lng: number | null
  location_name: string | null
  water_body: string | null
}

/** Encrypt location data → { ciphertext, iv } as base64 strings */
export async function encryptLocation(
  data: EncryptedLocation,
  key: CryptoKey
): Promise<{ encrypted_location: string; encryption_iv: string }> {
  const iv = generateIV()
  const plaintext = new TextEncoder().encode(JSON.stringify(data))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return {
    encrypted_location: bufToBase64(ciphertext),
    encryption_iv: bufToBase64(iv),
  }
}

/** Decrypt location data from base64 ciphertext + iv */
export async function decryptLocation(
  encryptedB64: string,
  ivB64: string,
  key: CryptoKey
): Promise<EncryptedLocation> {
  const ciphertext = base64ToBuf(encryptedB64)
  const ivBuf = base64ToBuf(ivB64)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf },
    key,
    ciphertext
  )

  return JSON.parse(new TextDecoder().decode(plaintext))
}
