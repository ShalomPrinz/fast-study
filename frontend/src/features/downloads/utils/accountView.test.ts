import { describe, it, expect } from 'vitest'
import { accountView, loginToast } from './accountView'
import type { AuthStatus } from '../services/autoDownloader'

const ok: AuthStatus = { connected: true, expired: false, phase: 'connected' }
const pending: AuthStatus = { connected: false, expired: false, phase: 'pending' }
const idle: AuthStatus = { connected: false, expired: false, phase: 'idle' }
const blocked = (challengeWindow?: boolean): AuthStatus => ({
  connected: true,
  expired: false,
  unverified: true,
  phase: 'unverified',
  error: {
    code: 'site_blocked',
    params: { detail: 'x', challengeWindow: challengeWindow ?? null },
  },
})

describe('accountView', () => {
  it('shows an unverified token as its own state with an explanation', () => {
    expect(accountView('idle', blocked())).toEqual({ chip: 'unverified', panel: 'unknown' })
    expect(accountView('idle', { ...ok, unverified: true, phase: 'unverified' }).panel).toBe(
      'unknown',
    )
  })

  it('words the panel by whether the service opened a challenge window', () => {
    expect(accountView('idle', blocked(true)).panel).toBe('window')
    expect(accountView('idle', blocked(false)).panel).toBe('own-browser')
  })

  it('shows a login running on the host from the pushed phase, even after a reload', () => {
    expect(accountView('idle', pending)).toEqual({ chip: 'finishing', panel: null })
    expect(accountView('connecting', idle).chip).toBe('finishing')
    expect(accountView('loading', ok).chip).toBe('checking')
  })

  it('keeps the old chips for the other states', () => {
    expect(accountView('idle', { ...idle, unconfigured: true }).chip).toBe('unconfigured')
    expect(accountView('idle', { ...idle, expired: true }).chip).toBe('expired')
    expect(accountView('idle', ok).chip).toBe('connected')
    expect(accountView('idle', idle).chip).toBe('disconnected')
    expect(accountView('idle', null).chip).toBe('disconnected')
  })
})

describe('loginToast', () => {
  const failed = (code: string, params = {}): AuthStatus => ({ ...idle, error: { code, params } })

  it('toasts the error on the frame that ends a watched run', () => {
    expect(loginToast(pending, failed('moodle_login_abandoned'))).toEqual({
      kind: 'failure',
      failure: expect.objectContaining({ code: 'moodle_login_abandoned' }),
    })
    expect(loginToast(pending, blocked(true))).toEqual({ kind: 'blocked' })
    expect(loginToast(pending, failed('moodle_reconnect_required'))).toEqual({ kind: 'reconnect' })
  })

  it('never toasts a replayed state, so a reload or resubscribe stays quiet', () => {
    expect(loginToast(null, failed('moodle_login_timeout'))).toBeNull()
    expect(loginToast(idle, failed('moodle_login_timeout'))).toBeNull()
    expect(loginToast(failed('moodle_login_timeout'), failed('moodle_login_timeout'))).toBeNull()
  })

  it('stays quiet while the run goes on and when it succeeds', () => {
    expect(loginToast(pending, pending)).toBeNull()
    expect(loginToast(pending, ok)).toBeNull()
  })
})
