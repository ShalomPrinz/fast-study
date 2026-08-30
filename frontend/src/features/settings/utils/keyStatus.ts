import type { ProbeResult } from '@/services/settings'

// The one status a key field ever shows. `prefix` is the instant offline hint; the other four come
// from the probe, and any of them replaces it — so a key the provider accepts shows no stale warning.
export type KeyStatus = { kind: 'prefix' | 'checking' | ProbeResult } | null

/** The offline check: a prefix is provider convention rather than contract, so a mismatch is only
 *  ever a provisional warning — it never blocks a save and never fails a field on its own. */
export function prefixStatus(value: string, keyPrefix: string): KeyStatus {
  const trimmed = value.trim()
  if (!trimmed || !keyPrefix || trimmed.startsWith(keyPrefix)) return null
  return { kind: 'prefix' }
}

/** Whether a value is worth a probe: non-empty, and actually different from the last one probed —
 *  so cycling focus through an unchanged field costs the provider nothing. */
export function shouldProbe(value: string, lastProbed: string | null): boolean {
  const trimmed = value.trim()
  return trimmed !== '' && trimmed !== lastProbed
}
