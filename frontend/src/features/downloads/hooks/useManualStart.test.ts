// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  MoodleLockProvider,
  useMoodleLockState,
} from '@/features/downloads/contexts/MoodleLockContext'
import { toastDownloadError } from '@/features/downloads/utils/downloadErrors'
import { MoodleBusyError } from '@/services/http'
import { useManualStart } from './useManualStart'

const { downloadUrl, toast, settings } = vi.hoisted(() => ({
  downloadUrl: vi.fn(),
  toast: vi.fn(),
  settings: { moodleSite: 'https://moodle.example.ac.il' as string | null },
}))
vi.mock('@/features/downloads/services/downloadServer', () => ({ downloadUrl }))
vi.mock('@/services/toaster', () => ({ toast, toastConnectionError: vi.fn() }))
vi.mock('@/shared/contexts/SettingsContext', () => ({
  useSettingsContext: () => ({ settings }),
}))

const MOODLE = 'https://moodle.example.ac.il/pluginfile.php/7/lecture.mp4'
const YOUTUBE = 'https://www.youtube.com/watch?v=abc'
const request = (url: string) => ({
  url,
  course: 'Algebra',
  lecture: 'Lecture 3',
  kind: 'lecture' as const,
})

function render(moodleBusy: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MoodleLockProvider, { frame: { moodleBusy }, children })
  return renderHook(() => ({ manual: useManualStart(), lock: useMoodleLockState() }), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  settings.moodleSite = 'https://moodle.example.ac.il'
})

describe('useManualStart', () => {
  it('locks only a link on the configured Moodle site while the lock is busy', () => {
    const { result } = render(true)
    expect(result.current.manual.locked(MOODLE)).toBe(true)
    expect(result.current.manual.locked(YOUTUBE)).toBe(false)
    expect(result.current.manual.locked('not a url')).toBe(false)
  })

  it('locks nothing while the lock is free, nor with no configured site', () => {
    expect(render(false).result.current.manual.locked(MOODLE)).toBe(false)
    settings.moodleSite = null
    expect(render(true).result.current.manual.locked(MOODLE)).toBe(false)
  })

  it('claims the lock for a Moodle link in flight, so a second click is disabled at once', async () => {
    let answer!: (v: unknown) => void
    downloadUrl.mockReturnValue(new Promise((r) => (answer = r)))
    const { result } = render(false)

    let started!: Promise<unknown>
    act(() => {
      started = result.current.manual.start(request(MOODLE))
    })
    expect(result.current.lock.claimed).toBe(true)
    expect(result.current.manual.locked(MOODLE)).toBe(true)
    expect(result.current.manual.locked(YOUTUBE)).toBe(false)

    await act(async () => {
      answer({ status: 'ok', target: 'Algebra/Lecture 3', jobId: 'j1' })
      await expect(started).resolves.toEqual({
        jobId: 'j1',
        target: { course: 'Algebra', lecture: 'Lecture 3' },
      })
    })
    expect(result.current.lock.claimed).toBe(false)
  })

  it('sends any other link directly, without claiming the lock', async () => {
    downloadUrl.mockResolvedValue({ status: 'ok', target: 'Algebra/Lecture 3', jobId: 'j2' })
    const { result } = render(true)
    await act(async () => {
      await result.current.manual.start(request(YOUTUBE))
    })
    expect(downloadUrl).toHaveBeenCalledWith(request(YOUTUBE))
    expect(result.current.lock.claimed).toBe(false)
  })

  it('rethrows a raced 429 once, without retrying, and the caller toasts nothing for it', async () => {
    downloadUrl.mockRejectedValue(new MoodleBusyError('lock taken'))
    const { result } = render(false)
    let err: unknown
    await act(async () => {
      err = await result.current.manual.start(request(MOODLE)).catch((e: unknown) => e)
    })
    expect(err).toBeInstanceOf(MoodleBusyError)
    expect(downloadUrl).toHaveBeenCalledTimes(1)
    expect(result.current.lock.claimed).toBe(false)

    toastDownloadError('Lecture 3', err)
    expect(toast).not.toHaveBeenCalled()
  })
})
