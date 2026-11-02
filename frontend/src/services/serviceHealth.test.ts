import { beforeEach, describe, expect, it } from 'vitest'
import {
  canRestartServices,
  dismissServiceDown,
  reportConnectionError,
  reportServiceStopped,
  restartNeedsConfirm,
  serviceDownShown,
} from './serviceHealth'

beforeEach(dismissServiceDown)

describe('banner visibility', () => {
  it('shows on a connection error', () => {
    reportConnectionError(false)
    expect(serviceDownShown()).toBe(true)
  })
  it('stays hidden for a connection error during the quiet window', () => {
    reportConnectionError(true)
    expect(serviceDownShown()).toBe(false)
  })
  it('shows on a stopped push even when connections are quiet', () => {
    reportServiceStopped()
    expect(serviceDownShown()).toBe(true)
  })
  it('comes back after a dismissal on the next report', () => {
    reportServiceStopped()
    dismissServiceDown()
    expect(serviceDownShown()).toBe(false)
    reportConnectionError(false)
    expect(serviceDownShown()).toBe(true)
  })
})

describe('canRestartServices', () => {
  const open = { file: async () => {}, external: async () => {} }
  it('is false without a bridge or without services', () => {
    expect(canRestartServices(undefined)).toBe(false)
    expect(canRestartServices({ open })).toBe(false)
  })
  it('is true when the bridge carries services.restart', () => {
    expect(
      canRestartServices({ open, services: { onStopped: () => () => {}, restart: () => {} } }),
    ).toBe(true)
  })
})

describe('restartNeedsConfirm', () => {
  const idle = { pipeline: false, downloadJobs: false, sectionRuns: false }
  it('does not ask when nothing runs', () => expect(restartNeedsConfirm(idle)).toBe(false))
  it.each(['pipeline', 'downloadJobs', 'sectionRuns'] as const)('asks when %s is live', (k) =>
    expect(restartNeedsConfirm({ ...idle, [k]: true })).toBe(true),
  )
})
