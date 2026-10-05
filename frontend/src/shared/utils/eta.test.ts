import { describe, expect, it } from 'vitest'
import { etaProgress } from './eta'

const MOUNT = 1_800_000_000_000

describe('etaProgress', () => {
  // A queued download's bar mounts at MOUNT with no start (0); its start and estimate then land
  // before the next tick, so the clock still reads the mount time.
  it('measures a start that arrives after mount from the clock, not from the queued 0', () => {
    expect(etaProgress(3, 0, MOUNT).overflowing).toBe(true) // what an elapsed frozen at mount read
    const started = etaProgress(3, MOUNT - 1000, MOUNT)
    expect(started.overflowing).toBe(false)
    expect(started.remaining).toBe(2)
  })

  it('reads a start a moment after the last tick as nothing elapsed, not negative', () => {
    expect(etaProgress(3, MOUNT + 400, MOUNT)).toEqual({
      elapsed: 0,
      fillPct: 0,
      remaining: 3,
      overflowing: false,
    })
  })

  it('overflows once elapsed plus the done fraction reaches the estimate', () => {
    expect(etaProgress(10, MOUNT, MOUNT + 4000, 0.5).overflowing).toBe(false)
    expect(etaProgress(10, MOUNT, MOUNT + 5000, 0.5).overflowing).toBe(true)
  })
})
