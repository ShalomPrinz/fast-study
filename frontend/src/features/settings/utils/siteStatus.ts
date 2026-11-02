import type { SiteProbe } from '@/services/settings'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import { shouldProbe } from './keyStatus'

// The one status the site field shows; `null` is "nothing probed since the last edit".
export type SiteStatus =
  | { kind: 'checking' }
  | { kind: 'supported'; site: string }
  | { kind: 'unsupported'; failure: ServiceFailure }
  | { kind: 'unverified'; site: string; captcha: boolean }
  | { kind: 'invalid' }
  | null

// What a probe answer means for the field. Unverified keeps the probe's root, else the typed origin;
// text that is no address is `invalid`, so nothing to save.
export function toSiteStatus(probe: SiteProbe, url: string): SiteStatus {
  if (probe.status === 'supported' && probe.site) return { kind: 'supported', site: probe.site }
  if (probe.status === 'unsupported') {
    return {
      kind: 'unsupported',
      failure: probe.failure ?? { message: 'This Moodle site cannot be used.' },
    }
  }
  const site = probe.site ?? originOf(url)
  if (!site) return { kind: 'invalid' }
  return { kind: 'unverified', site, captcha: probe.captcha }
}

// A schemeless host gets `https://`, as the auto-downloader's candidateRoots does. A scheme typo
// (`http:/x`, `mailto:a@b.c`) is no host:port, so it is invalid rather than glued onto `https://`.
function originOf(url: string): string {
  const text = url.trim()
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(text)) return ''
  try {
    const parsed = new URL(hasScheme ? text : `https://${text}`)
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : ''
  } catch {
    return ''
  }
}

/** The value the form may save for a status, `null` when none. Unlike a key, a definitive
 *  "unsupported" can never work, so it saves nothing; neither does an answer still in flight. */
export function savableSite(status: SiteStatus): string | null {
  if (status?.kind !== 'supported' && status?.kind !== 'unverified') return null
  return status.site
}

/** Runs site probes in order: a value already probed is skipped, and a slower earlier answer never
 *  overwrites a newer one. `reset` is an edit, which invalidates both memories. */
export function siteProber(
  // `stale` turns true once a newer probe or an edit supersedes this one, so a queued call can drop out.
  probe: (url: string, stale: () => boolean) => Promise<SiteProbe>,
  onStatus: (status: SiteStatus) => void,
) {
  let seq = 0
  let probed: string | null = null
  return {
    async probe(url: string) {
      const value = url.trim()
      if (!shouldProbe(value, probed)) return
      probed = value
      const id = ++seq
      onStatus({ kind: 'checking' })
      let answer: SiteProbe
      try {
        answer = await probe(value, () => id !== seq)
      } catch (err) {
        // A superseded probe's failure (an abandoned wait included) answers nothing.
        if (id !== seq) return
        throw err
      }
      if (id === seq) onStatus(toSiteStatus(answer, value))
    },
    reset() {
      seq += 1
      probed = null
    },
  }
}
