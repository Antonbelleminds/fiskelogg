/**
 * Module-level in-memory cache. Survives between React renders and
 * tab switches within the same browser session, eliminating redundant
 * API calls when the user navigates back to a tab they already visited.
 */

type Entry<T> = { data: T; at: number }
const store = new Map<string, Entry<unknown>>()

const TTL = 2 * 60 * 1000 // 2 minutes

export function getCache<T>(key: string): T | null {
  const e = store.get(key) as Entry<T> | undefined
  if (!e || Date.now() - e.at > TTL) return null
  return e.data
}

export function setCache<T>(key: string, data: T): void {
  store.set(key, { data, at: Date.now() })
}

export function invalidateCache(...keys: string[]): void {
  keys.forEach((k) => store.delete(k))
}
