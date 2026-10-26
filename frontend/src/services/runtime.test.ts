import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  secretHeaders,
  withSecretParam,
  isQuiet,
  RESUME_QUIET_MS,
  SUSPEND_QUIET_MS,
} from './runtime'

// The secret is resolved once at import, so the with-secret case needs a fresh module registry
// with `window` stubbed before the import — vitest's `node` environment has no `window` at all.
async function importWithSecret(secret: string) {
  vi.resetModules()
  vi.stubGlobal('window', { faststudy: { secret } })
  return import('./runtime')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('runtime secret', () => {
  it('adds nothing when there is no bridge — browser dev, where the services enforce nothing', () => {
    expect(secretHeaders()).toEqual({})
    expect(withSecretParam('http://x/events')).toBe('http://x/events')
  })

  it('carries the secret as a header and, for SSE, as an escaped query parameter', async () => {
    const runtime = await importWithSecret('a b/c')
    expect(runtime.secretHeaders()).toEqual({ 'X-FastStudy-Secret': 'a b/c' })
    expect(runtime.withSecretParam('http://x/events')).toBe('http://x/events?secret=a%20b%2Fc')
    expect(runtime.withSecretParam('http://x/events?picker=1')).toBe(
      'http://x/events?picker=1&secret=a%20b%2Fc',
    )
  })
})

describe('isQuiet', () => {
  const at = 1000
  it('is quiet just under the suspend cap', () => {
    expect(isQuiet({ state: 'suspend', at }, at + SUSPEND_QUIET_MS - 1)).toBe(true)
  })
  it('is loud once a suspend outlasts the cap with no resume', () => {
    expect(isQuiet({ state: 'suspend', at }, at + SUSPEND_QUIET_MS)).toBe(false)
  })
  it('is quiet within 5 s of resume', () => {
    expect(isQuiet({ state: 'resume', at }, at + RESUME_QUIET_MS - 1)).toBe(true)
  })
  it('is loud from 5 s after resume', () => {
    expect(isQuiet({ state: 'resume', at }, at + RESUME_QUIET_MS)).toBe(false)
  })
  it('a resume without a suspend opens the window too', () => {
    expect(isQuiet({ state: 'resume', at }, at)).toBe(true)
  })
  it('is loud when no power event ever arrived', () => {
    expect(isQuiet(null, at)).toBe(false)
  })
})
