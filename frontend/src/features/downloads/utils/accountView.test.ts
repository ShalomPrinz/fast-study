import { describe, it, expect } from 'vitest'
import { accountView } from './accountView'

const ok = { connected: true, expired: false }
const unverified = { connected: true, expired: false, unverified: true }

describe('accountView', () => {
  it('shows an unverified token as its own state with an explanation', () => {
    expect(accountView('idle', unverified, null)).toEqual({ chip: 'unverified', panel: 'unknown' })
  })

  it('words the panel by whether a challenge window opened', () => {
    expect(accountView('idle', unverified, { challengeWindow: true }).panel).toBe('window')
    expect(accountView('idle', unverified, { challengeWindow: false }).panel).toBe('own-browser')
    expect(accountView('idle', unverified, { challengeWindow: null }).panel).toBe('unknown')
  })

  it('keeps the blocked explanation when the status probe failed', () => {
    expect(accountView('idle', null, { challengeWindow: true })).toEqual({
      chip: 'unverified',
      panel: 'window',
    })
  })

  it('drops a stale blocked answer once the site is verified', () => {
    expect(accountView('idle', ok, { challengeWindow: true })).toEqual({
      chip: 'connected',
      panel: null,
    })
  })

  it('lets an in-flight login outrank everything', () => {
    expect(accountView('completing', unverified, null).chip).toBe('finishing')
    expect(accountView('loading', ok, null).chip).toBe('checking')
  })

  it('keeps the old chips for the other states', () => {
    expect(
      accountView('idle', { connected: false, expired: false, unconfigured: true }, null).chip,
    ).toBe('unconfigured')
    expect(accountView('idle', { connected: false, expired: true }, null).chip).toBe('expired')
    expect(accountView('idle', { connected: false, expired: false }, null).chip).toBe(
      'disconnected',
    )
    expect(accountView('idle', null, null).chip).toBe('disconnected')
  })
})
