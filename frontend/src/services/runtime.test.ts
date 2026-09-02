import { describe, it, expect, afterEach, vi } from 'vitest'
import { secretHeaders, withSecretParam } from './runtime'

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
  })
})
