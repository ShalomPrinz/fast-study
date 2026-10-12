// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MoodleLockProvider } from '@/features/downloads/contexts/MoodleLockContext'
import { RequestError } from '@/services/http'
import { useCourseUrlCheck } from './useCourseUrlCheck'

const { checkCourseUrl } = vi.hoisted(() => ({ checkCourseUrl: vi.fn() }))
vi.mock('@/features/downloads/services/autoDownloader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkCourseUrl,
}))

const URL_ = 'https://moodle.example.ac.il/mod/resource/view.php?id=5'

function render() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MoodleLockProvider, { frame: { moodleBusy: false }, children })
  return renderHook(() => useCourseUrlCheck(), { wrapper })
}

beforeEach(() => vi.clearAllMocks())

describe('useCourseUrlCheck', () => {
  it('answers save for a URL the service accepts, keeping no failure', async () => {
    checkCourseUrl.mockResolvedValue(undefined)
    const { result } = render()
    let ok!: boolean
    await act(async () => {
      ok = await result.current.check(URL_)
    })
    expect(ok).toBe(true)
    expect(checkCourseUrl).toHaveBeenCalledWith(URL_)
    expect(result.current.failure).toBeNull()
  })

  it('keeps a refusal for "Save anyway" and drops it on edit', async () => {
    checkCourseUrl.mockRejectedValue(
      new RequestError('no', 'course_url_not_course_page', { url: URL_ }),
    )
    const { result } = render()
    let ok!: boolean
    await act(async () => {
      ok = await result.current.check(URL_)
    })
    expect(ok).toBe(false)
    expect(result.current.failure).toMatchObject({ code: 'course_url_not_course_page' })
    expect(result.current.checking).toBe(false)
    act(() => result.current.clear())
    expect(result.current.failure).toBeNull()
  })
})
