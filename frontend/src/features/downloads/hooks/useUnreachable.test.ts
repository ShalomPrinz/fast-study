// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUnreachable } from './useUnreachable'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useUnreachable', () => {
  it('flips at 10 s of checking', () => {
    const { result } = renderHook(() => useUnreachable(true))
    act(() => vi.advanceTimersByTime(9_999))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('a real status replaces it at once, and a later loss restarts the wait', () => {
    const { result, rerender } = renderHook(({ c }) => useUnreachable(c), {
      initialProps: { c: true },
    })
    act(() => vi.advanceTimersByTime(10_000))
    expect(result.current).toBe(true)
    rerender({ c: false })
    expect(result.current).toBe(false)
    rerender({ c: true })
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(9_999))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })
})
