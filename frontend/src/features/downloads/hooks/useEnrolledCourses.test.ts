// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { MoodleLockProvider } from '@/features/downloads/contexts/MoodleLockContext'
import { useEnrolledCourses } from './useEnrolledCourses'

const { fetchEnrolledCourses } = vi.hoisted(() => ({ fetchEnrolledCourses: vi.fn() }))
vi.mock('@/features/downloads/services/autoDownloader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEnrolledCourses,
}))
vi.mock('@/features/downloads/contexts/DownloadsSessionContext', () => ({
  useDownloadsActions: () => ({ reconnectHint: vi.fn() }),
}))
vi.mock('@/services/toaster', () => ({ toast: vi.fn(), toastConnectionError: vi.fn() }))

const COURSES = [{ id: 101, name: 'Algebra', url: 'https://m/course/view.php?id=101', past: false }]

// The wrapper reads `frame` on every render, so a rerender pushes a new lock frame.
function render(initial: { enabled: boolean; busy: boolean }) {
  let frame = { moodleBusy: initial.busy }
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MoodleLockProvider, { frame, children })
  const hook = renderHook(({ enabled }) => useEnrolledCourses(enabled), {
    wrapper,
    initialProps: { enabled: initial.enabled },
  })
  return {
    ...hook,
    set(enabled: boolean, busy: boolean) {
      frame = { moodleBusy: busy }
      hook.rerender({ enabled })
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('useEnrolledCourses', () => {
  it('sends one request and shows its courses', async () => {
    fetchEnrolledCourses.mockResolvedValue({ available: true, courses: COURSES })
    const { result } = render({ enabled: true, busy: false })
    await waitFor(() => expect(result.current).toEqual(COURSES))
    expect(fetchEnrolledCourses).toHaveBeenCalledTimes(1)
  })

  it('reads a closed list as unavailable', async () => {
    fetchEnrolledCourses.mockResolvedValue({ available: false })
    const { result } = render({ enabled: true, busy: false })
    await waitFor(() => expect(result.current).toBe('unavailable'))
  })

  it('sends a fresh request after one abandoned while disabled, never sticking on loading', async () => {
    fetchEnrolledCourses.mockResolvedValue({ available: true, courses: COURSES })
    // The lock's frame lands in the provider's effect, after the child's, so it is busy before enabling.
    const hook = render({ enabled: false, busy: true })
    hook.set(true, true)
    expect(hook.result.current).toBe('loading')
    // Waiting on the lock, then disabled (auth flipped) before the lock frees: abandoned unsent.
    hook.set(false, true)
    await act(async () => hook.set(false, false))
    expect(fetchEnrolledCourses).not.toHaveBeenCalled()
    await act(async () => hook.set(true, false))
    await waitFor(() => expect(hook.result.current).toEqual(COURSES))
    expect(fetchEnrolledCourses).toHaveBeenCalledTimes(1)
  })
})
