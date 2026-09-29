import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  setTags: vi.fn(),
  isInitialized: vi.fn(() => false),
  captureException: vi.fn((..._args: unknown[]): string => 'evt-1'),
}))
vi.mock('@sentry/electron/renderer', () => sdk)

import { captureRenderError, initSentry } from './sentry'

beforeEach(() => {
  vi.clearAllMocks()
  sdk.isInitialized.mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('initSentry', () => {
  it('stays off in browser dev, where there is no main to send through', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1')
    initSentry()
    expect(sdk.init).not.toHaveBeenCalled()
  })

  it('stays off in a build with no DSN baked in', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    vi.stubGlobal('window', { faststudy: { version: '1.2.3' } })
    initSentry()
    expect(sdk.init).not.toHaveBeenCalled()
  })

  it('inits from the policy with the installed version and tags the scope frontend', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1')
    vi.stubGlobal('window', { faststudy: { version: '1.2.3' } })
    initSentry()
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@o1.ingest.de.sentry.io/1',
        release: 'faststudy@1.2.3',
      }),
    )
    expect(sdk.setTags).toHaveBeenCalledWith(expect.objectContaining({ service: 'frontend' }))
  })
})

describe('captureRenderError', () => {
  const error = new Error('boom')
  const context = { componentStack: '\n    at Broken', route: '/course/אלגברה' }

  it('sends the route and the component stack, and answers the event id', () => {
    sdk.isInitialized.mockReturnValue(true)
    expect(captureRenderError(error, context)).toBe('evt-1')
    expect(sdk.captureException).toHaveBeenCalledWith(error, {
      contexts: { react: { componentStack: '\n    at Broken' } },
      extra: { route: '/course/אלגברה' },
    })
  })

  it('answers null when Sentry is off — the SDK would still mint an id for nothing', () => {
    expect(captureRenderError(error, context)).toBeNull()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('answers null when the capture throws', () => {
    sdk.isInitialized.mockReturnValue(true)
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error('ipc gone')
    })
    expect(captureRenderError(error, context)).toBeNull()
  })
})
