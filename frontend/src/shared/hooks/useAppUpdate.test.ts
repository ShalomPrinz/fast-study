// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { UpdateState } from '@/services/runtime'
import { versionTag } from '@/services/runtime'
import { useRestartToUpdate, useUpdateState } from './useAppUpdate'

type Updates = NonNullable<NonNullable<Window['faststudy']>['updates']>

// A fake launcher: `push` drives the subscription, `answer` resolves the pending snapshot.
function fakeUpdates(restart: Updates['restart'] = vi.fn()) {
  let listener: ((s: UpdateState) => void) | null = null
  let answer!: (s: UpdateState) => void
  const unsubscribe = vi.fn(() => (listener = null))
  const updates: Updates = {
    snapshot: () => new Promise((r) => (answer = r)),
    subscribe: (cb) => {
      listener = cb
      return unsubscribe
    },
    restart,
  }
  window.faststudy = { updates } as unknown as Window['faststudy']
  return {
    push: (s: UpdateState) => listener?.(s),
    answer: (s: UpdateState) => answer(s),
    unsubscribe,
  }
}

afterEach(() => {
  delete window.faststudy
})

describe('useUpdateState', () => {
  it('stays null with no bridge, or a launcher without updates', () => {
    expect(renderHook(() => useUpdateState()).result.current).toBeNull()
    window.faststudy = {} as Window['faststudy']
    expect(renderHook(() => useUpdateState()).result.current).toBeNull()
  })

  it('starts from the snapshot, follows pushes, and unsubscribes on unmount', async () => {
    const fake = fakeUpdates()
    const { result, unmount } = renderHook(() => useUpdateState())
    await act(async () => fake.answer('downloading'))
    expect(result.current).toBe('downloading')
    act(() => fake.push('downloaded'))
    expect(result.current).toBe('downloaded')
    unmount()
    expect(fake.unsubscribe).toHaveBeenCalledOnce()
  })

  it('never lets a late snapshot overwrite a newer push', async () => {
    const fake = fakeUpdates()
    const { result } = renderHook(() => useUpdateState())
    act(() => fake.push('downloaded'))
    await act(async () => fake.answer('downloading'))
    expect(result.current).toBe('downloaded')
  })
})

describe('useRestartToUpdate', () => {
  it('restarts at once when idle, and holds the overlay while the app quits', async () => {
    const restart = vi.fn(() => Promise.resolve({ ok: true }))
    fakeUpdates(restart)
    const { result } = renderHook(() => useRestartToUpdate(false))
    await act(async () => result.current.request())
    expect(restart).toHaveBeenCalledOnce()
    expect(result.current.confirming).toBe(false)
    expect(result.current.restarting).toBe(true)
  })

  it('asks first when busy; No restarts nothing, Yes restarts', async () => {
    const restart = vi.fn(() => Promise.resolve({ ok: true }))
    fakeUpdates(restart)
    const { result } = renderHook(() => useRestartToUpdate(true))
    act(() => result.current.request())
    expect(result.current.confirming).toBe(true)
    act(() => result.current.cancel())
    expect(result.current.confirming).toBe(false)
    expect(restart).not.toHaveBeenCalled()
    act(() => result.current.request())
    await act(async () => result.current.confirm())
    expect(result.current.confirming).toBe(false)
    expect(restart).toHaveBeenCalledOnce()
    expect(result.current.restarting).toBe(true)
  })

  it('drops the overlay on a refusal, and restarts only once while one is pending', async () => {
    let refuse!: () => void
    const restart = vi.fn(
      () =>
        new Promise<{ ok: boolean; error?: string }>(
          (r) => (refuse = () => r({ ok: false, error: 'x' })),
        ),
    )
    fakeUpdates(restart)
    const { result } = renderHook(() => useRestartToUpdate(false))
    act(() => result.current.request())
    act(() => result.current.request())
    expect(restart).toHaveBeenCalledOnce()
    await act(async () => refuse())
    expect(result.current.restarting).toBe(false)
  })
})

describe('versionTag', () => {
  it('shows the release only when packaged', () => {
    expect(versionTag(undefined)).toBe('dev')
    const open = {} as NonNullable<Window['faststudy']>['open']
    expect(versionTag({ open, version: '1.4.0', packaged: false })).toBe('dev')
    expect(versionTag({ open, version: '1.4.0', packaged: true })).toBe('1.4.0')
  })
})
