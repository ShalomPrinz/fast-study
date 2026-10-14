import { describe, it, expect, vi } from 'vitest'
import type { RunTarget } from '../services/downloadServer'
import { startAndLock } from './rowLocks'

const TARGETS: RunTarget[] = [
  { ref: 'a', name: 'Lecture 1', kind: 'lecture', media: 'video', disposition: 'pending' },
  { ref: 'b', name: 'Lecture 2', kind: 'lecture', media: 'video', disposition: 'skipped' },
]

describe('startAndLock', () => {
  it('locks each queued row once the run is accepted', async () => {
    const lock = vi.fn()
    await expect(startAndLock(async () => 'ok', TARGETS, 'Algebra', lock)).resolves.toBe('ok')
    expect(lock).toHaveBeenCalledOnce()
    expect(lock).toHaveBeenCalledWith('a', {
      course: 'Algebra',
      name: 'Lecture 1',
      kind: 'lecture',
    })
  })

  it('locks nothing when the run throws', async () => {
    const lock = vi.fn()
    const start = () => Promise.reject(new Error('HTTP 500'))
    await expect(startAndLock(start, TARGETS, 'Algebra', lock)).rejects.toThrow('HTTP 500')
    expect(lock).not.toHaveBeenCalled()
  })
})
