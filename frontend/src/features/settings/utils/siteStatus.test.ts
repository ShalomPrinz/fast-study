import { describe, it, expect } from 'vitest'
import type { SiteProbe } from '@/services/settings'
import { savableSite, siteProber, toSiteStatus, type SiteStatus } from './siteStatus'

const SUPPORTED: SiteProbe = {
  status: 'supported',
  site: 'https://lemida.biu.ac.il',
  failure: null,
}
const NOT_MOODLE: SiteProbe = {
  status: 'unsupported',
  site: 'https://example.com',
  failure: {
    message: 'not moodle',
    code: 'moodle_site_unsupported',
    params: { site: 'https://example.com', reason: 'not_moodle' },
  },
}

// A probe whose answers the test releases by hand, in any order.
function manualProbe() {
  const calls: { url: string; answer: (p: SiteProbe) => void }[] = []
  const probe = (url: string) =>
    new Promise<SiteProbe>((resolve) => calls.push({ url, answer: resolve }))
  return { probe, calls }
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('toSiteStatus', () => {
  it('stores the canonical root a supported probe answers, not the typed text', () => {
    expect(toSiteStatus(SUPPORTED, 'https://lemida.biu.ac.il/course/view.php?id=1')).toEqual({
      kind: 'supported',
      site: 'https://lemida.biu.ac.il',
    })
  })

  it('keeps the coded reason of an unsupported site', () => {
    expect(toSiteStatus(NOT_MOODLE, 'https://example.com')).toEqual({
      kind: 'unsupported',
      failure: NOT_MOODLE.failure,
    })
  })

  it('falls back to the typed origin when an unverified answer names no site', () => {
    const unverified: SiteProbe = { status: 'unverified', site: null, failure: null }
    expect(toSiteStatus(unverified, 'https://x.ac.il/moodle/course/view.php?id=3')).toEqual({
      kind: 'unverified',
      site: 'https://x.ac.il',
    })
    expect(toSiteStatus(unverified, 'not an address')).toEqual({ kind: 'unverified', site: '' })
  })
})

describe('savableSite', () => {
  it('blocks the save on an unsupported site, unlike a rejected key', () => {
    expect(savableSite({ kind: 'unsupported', failure: NOT_MOODLE.failure! })).toBe('')
  })

  it('blocks the save while a probe is in flight or nothing was probed', () => {
    expect(savableSite({ kind: 'checking' })).toBe('')
    expect(savableSite(null)).toBe('')
  })

  it('lets a supported or unverified site be saved', () => {
    expect(savableSite({ kind: 'supported', site: 'https://a' })).toBe('https://a')
    expect(savableSite({ kind: 'unverified', site: 'https://b' })).toBe('https://b')
  })
})

describe('siteProber', () => {
  it('reports checking, then the answer', async () => {
    const { probe, calls } = manualProbe()
    const seen: SiteStatus[] = []
    const prober = siteProber(probe, (s) => seen.push(s))
    const done = prober.probe(' https://lemida.biu.ac.il ')
    expect(calls.map((c) => c.url)).toEqual(['https://lemida.biu.ac.il'])
    calls[0].answer(SUPPORTED)
    await done
    expect(seen).toEqual([{ kind: 'checking' }, { kind: 'supported', site: SUPPORTED.site }])
  })

  it('never re-probes the value it just probed', async () => {
    const { probe, calls } = manualProbe()
    const prober = siteProber(probe, () => {})
    void prober.probe('https://a.ac.il')
    void prober.probe('https://a.ac.il')
    expect(calls).toHaveLength(1)
  })

  it('drops a slower earlier answer once a newer probe started', async () => {
    const { probe, calls } = manualProbe()
    const seen: SiteStatus[] = []
    const prober = siteProber(probe, (s) => seen.push(s))
    void prober.probe('https://example.com')
    void prober.probe('https://lemida.biu.ac.il')
    calls[1].answer(SUPPORTED)
    calls[0].answer(NOT_MOODLE)
    await flush()
    expect(seen.at(-1)).toEqual({ kind: 'supported', site: SUPPORTED.site })
  })

  it('drops an answer that lands after an edit, and probes the same value again', async () => {
    const { probe, calls } = manualProbe()
    const seen: SiteStatus[] = []
    const prober = siteProber(probe, (s) => seen.push(s))
    void prober.probe('https://example.com')
    prober.reset()
    calls[0].answer(NOT_MOODLE)
    await flush()
    expect(seen).toEqual([{ kind: 'checking' }])
    void prober.probe('https://example.com')
    expect(calls).toHaveLength(2)
  })

  it('never probes a blank value', async () => {
    const { probe, calls } = manualProbe()
    void siteProber(probe, () => {}).probe('   ')
    expect(calls).toHaveLength(0)
  })
})
