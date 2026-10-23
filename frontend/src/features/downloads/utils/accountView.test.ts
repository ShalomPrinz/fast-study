import { describe, it, expect } from 'vitest'
import {
  accountView,
  captchaSeen,
  connectConfirmOpen,
  loginToast,
  siteSolveToasts,
} from './accountView'
import type { AuthStatus } from '../services/autoDownloader'

const ok: AuthStatus = { connected: true, expired: false, phase: 'connected' }
const pending: AuthStatus = { connected: false, expired: false, phase: 'pending' }
const idle: AuthStatus = { connected: false, expired: false, phase: 'idle' }
const blocked = (
  challengeWindow?: 'captcha' | 'ready' | false,
  challenge?: AuthStatus['challenge'],
): AuthStatus => ({
  connected: true,
  expired: false,
  unverified: true,
  phase: 'unverified',
  error: {
    code: 'site_blocked',
    params: { detail: 'x', challengeWindow: challengeWindow ?? null },
  },
  ...(challenge ? { challenge } : {}),
})

describe('accountView', () => {
  it('shows an unverified token as its own state with an explanation', () => {
    expect(accountView('idle', blocked())).toEqual({ chip: 'unverified', panel: 'unknown' })
    expect(accountView('idle', { ...ok, unverified: true, phase: 'unverified' }).panel).toBe(
      'unknown',
    )
  })

  it('words the panel by what the challenge window did', () => {
    expect(accountView('idle', blocked('captcha')).panel).toBe('window')
    expect(accountView('idle', blocked(false)).panel).toBe('own-browser')
    // A check walled inside the window that reloaded onto the site: no captcha to solve, just retry.
    expect(accountView('idle', blocked('ready')).panel).toBe('ready')
    expect(accountView('idle', blocked('ready', { open: true, captcha: false })).panel).toBe(
      'ready',
    )
    expect(accountView('idle', blocked('ready', { open: false, captcha: false })).panel).toBe(
      'ready',
    )
    expect(accountView('idle', blocked('ready', { open: true, captcha: true })).panel).toBe(
      'window',
    )
  })

  it('follows the live challenge frame over the recorded block', () => {
    // A captcha on screen, whatever was recorded.
    expect(accountView('idle', blocked('captcha', { open: true, captcha: true })).panel).toBe(
      'window',
    )
    expect(accountView('idle', blocked(undefined, { open: true, captcha: true })).panel).toBe(
      'window',
    )
    // Solved: the window showed a captcha and is still up while auto verifies, so nothing asks for a press.
    const solved = blocked('captcha', { open: true, captcha: false })
    expect(accountView('idle', solved, true).panel).toBe('solved')
    // A window reopening shows no captcha yet either; it is not solved until one was on screen.
    expect(accountView('idle', solved, false).panel).toBe('window')
    // Closed before it was solved: never reported as passed.
    expect(accountView('idle', blocked('captcha', { open: false, captcha: false })).panel).toBe(
      'closed',
    )
    expect(accountView('idle', blocked(false, { open: false, captcha: false })).panel).toBe(
      'own-browser',
    )
    expect(accountView('idle', blocked(undefined, { open: false, captcha: false })).panel).toBe(
      'unknown',
    )
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

describe('captchaSeen', () => {
  it('remembers a captcha while its window stays open, and forgets it when the window closes', () => {
    const frame = (open: boolean, captcha: boolean): AuthStatus => ({
      ...blocked('captcha'),
      challenge: { open, captcha },
    })
    expect(captchaSeen(false, frame(true, false))).toBe(false)
    expect(captchaSeen(false, frame(true, true))).toBe(true)
    expect(captchaSeen(true, frame(true, false))).toBe(true)
    expect(captchaSeen(true, frame(false, false))).toBe(false)
    expect(captchaSeen(true, null)).toBe(false)
  })
})

describe('loginToast', () => {
  const failed = (code: string, params = {}): AuthStatus => ({ ...idle, error: { code, params } })

  it('toasts the error on the frame that ends a watched run', () => {
    expect(loginToast(pending, failed('moodle_login_abandoned'))).toEqual({
      kind: 'failure',
      failure: expect.objectContaining({ code: 'moodle_login_abandoned' }),
    })
    expect(loginToast(pending, blocked('captcha'))).toEqual({
      kind: 'blocked',
      challengeWindow: 'captcha',
    })
    expect(loginToast(pending, blocked())).toEqual({ kind: 'blocked', challengeWindow: null })
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

describe('connectConfirmOpen', () => {
  it('stays up while Connect shows and a foreign token remains', () => {
    expect(connectConfirmOpen(true, 'disconnected', true)).toBe(true)
    expect(connectConfirmOpen(true, 'expired', true)).toBe(true)
  })

  it('closes once the foreign token is gone or Connect leaves the screen', () => {
    expect(connectConfirmOpen(true, 'disconnected', false)).toBe(false)
    expect(connectConfirmOpen(true, 'connected', true)).toBe(false)
    expect(connectConfirmOpen(true, 'finishing', true)).toBe(false)
    expect(connectConfirmOpen(false, 'disconnected', true)).toBe(false)
  })
})

describe('siteSolveToasts', () => {
  const solvedFrame = { open: true, captcha: false, solved: 1 }

  it("stays quiet for the unverified login's solve while an account panel is on screen to say it", () => {
    expect(siteSolveToasts(blocked('captcha', solvedFrame), true)).toBe(false)
  })

  it('toasts that same solve when no account panel is mounted', () => {
    expect(siteSolveToasts(blocked('captcha', solvedFrame), false)).toBe(true)
  })

  it('toasts a solve the panel does not announce: connected, mid-login, closed window, ready', () => {
    expect(siteSolveToasts({ ...ok, challenge: solvedFrame }, true)).toBe(true)
    expect(siteSolveToasts({ ...pending, challenge: solvedFrame }, true)).toBe(true)
    expect(siteSolveToasts(blocked('captcha', { ...solvedFrame, open: false }), true)).toBe(true)
    expect(siteSolveToasts(blocked('ready', solvedFrame), true)).toBe(true)
  })
})
