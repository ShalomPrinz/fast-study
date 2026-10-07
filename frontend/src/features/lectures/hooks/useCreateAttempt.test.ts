// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCreateAttempt } from './useCreateAttempt'

describe('useCreateAttempt', () => {
  it('is pending while it runs and ignores a second run', async () => {
    const { result } = renderHook(() => useCreateAttempt())
    let finish!: () => void
    const create = vi.fn(() => new Promise<void>((r) => (finish = r)))
    let first!: Promise<boolean>
    act(() => {
      first = result.current.run(create)
    })
    expect(result.current.pending).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.run(create)
    })
    expect(second).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
      expect(await first).toBe(true)
    })
    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('keeps the refusal until the next run clears it', async () => {
    const { result } = renderHook(() => useCreateAttempt())
    const boom = new Error('taken')
    await act(async () => {
      expect(await result.current.run(() => Promise.reject(boom))).toBe(false)
    })
    expect(result.current.error).toBe(boom)
    await act(async () => {
      await result.current.run(() => Promise.resolve())
    })
    expect(result.current.error).toBeNull()
  })

  it('drops a refusal that lands after reset', async () => {
    const { result } = renderHook(() => useCreateAttempt())
    let fail!: (e: unknown) => void
    let p!: Promise<boolean>
    act(() => {
      p = result.current.run(() => new Promise((_, rej) => (fail = rej)))
    })
    act(() => result.current.reset())
    await act(async () => {
      fail(new Error('late'))
      await p
    })
    expect(result.current.error).toBeNull()
  })
})
