import type { SiteProbe } from '@/services/settings'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import { shouldProbe } from './keyStatus'

// The one status the site field shows; `null` is "nothing probed since the last edit".
export type SiteStatus =
  | { kind: 'checking' }
  | { kind: 'supported'; site: string }
  | { kind: 'unsupported'; failure: ServiceFailure }
  | { kind: 'unverified'; site: string }
  | null

// What a probe answer means for the field. An unverified answer keeps the probe's root, or failing
// that the typed address's origin, so the post-login check still has a site to judge; text that is
// no address at all keeps nothing, and so cannot be saved.
export function toSiteStatus(probe: SiteProbe, url: string): SiteStatus {
  if (probe.status === 'supported' && probe.site) return { kind: 'supported', site: probe.site }
  if (probe.status === 'unsupported') {
    return {
      kind: 'unsupported',
      failure: probe.failure ?? { message: 'This Moodle site cannot be used.' },
    }
  }
  return { kind: 'unverified', site: probe.site ?? originOf(url) }
}

function originOf(url: string): string {
  try {
    const parsed = new URL(url.trim())
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : ''
  } catch {
    return ''
  }
}

/** The value the form may save for a status, `''` when none. Unlike a key, a definitive
 *  "unsupported" can never work, so it saves nothing; neither does an answer still in flight. */
export function savableSite(status: SiteStatus): string {
  return status?.kind === 'supported' || status?.kind === 'unverified' ? status.site : ''
}

/** Runs site probes in order: a value already probed is skipped, and a slower earlier answer never
 *  overwrites a newer one. `reset` is an edit, which invalidates both memories. */
export function siteProber(
  probe: (url: string) => Promise<SiteProbe>,
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
      const answer = await probe(value)
      if (id === seq) onStatus(toSiteStatus(answer, value))
    },
    reset() {
      seq += 1
      probed = null
    },
  }
}
