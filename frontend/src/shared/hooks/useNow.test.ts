// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNow } from './useNow'

// The store's last tick outlives a test, so each test starts later than the one before, as a real clock would.
let START = 1_700_000_000_000

beforeEach(() => {
  START += 60_000
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('runs the timer only while something is subscribed', () => {
    expect(vi.getTimerCount()).toBe(0)
    const a = renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(1)
    const b = renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(1)
    a.unmount()
    expect(vi.getTimerCount()).toBe(1)
    b.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts the timer for a subscriber that arrives after it stopped', () => {
    renderHook(() => useNow()).unmount()
    const a = renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(1)
    act(() => void vi.advanceTimersByTime(1000))
    expect(a.result.current).toBe(START + 1000)
    a.unmount()
  })

  it('reads a fresh clock on mount, between ticks', () => {
    const a = renderHook(() => useNow())
    expect(a.result.current).toBe(START)
    act(() => void vi.advanceTimersByTime(1300))
    const b = renderHook(() => useNow())
    expect(a.result.current).toBe(START + 1000)
    expect(b.result.current).toBe(START + 1300)
    a.unmount()
    b.unmount()
  })

  it('gives every subscriber the same value in one tick', () => {
    const a = renderHook(() => useNow())
    act(() => void vi.advanceTimersByTime(300))
    const b = renderHook(() => useNow())
    act(() => void vi.advanceTimersByTime(700))
    expect(a.result.current).toBe(START + 1000)
    expect(b.result.current).toBe(START + 1000)
    a.unmount()
    b.unmount()
  })
})
