// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { MoodleLockProvider } from '@/features/downloads/contexts/MoodleLockContext'
import AddCourseRow from './AddCourseRow'

const { checkCourseUrl, createCourse } = vi.hoisted(() => ({
  checkCourseUrl: vi.fn(),
  createCourse: vi.fn(),
}))
vi.mock('@/features/downloads/services/autoDownloader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkCourseUrl,
}))
vi.mock('@/services/database', () => ({ createCourse }))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ refreshCourses: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock('@/services/toaster', () => ({ toast: vi.fn(), toastConnectionError: vi.fn() }))

const PASTED = 'https://m/mod/resource/view.php?id=5'

function openForm() {
  const view = render(
    createElement(I18nProvider, {
      i18n,
      children: createElement(MoodleLockProvider, {
        frame: { moodleBusy: false },
        children: createElement(AddCourseRow),
      }),
    }),
  )
  const [, manual] = view.container.querySelectorAll('.source-add-btn')
  fireEvent.click(manual)
  const name = view.container.querySelector('.source-add-name') as HTMLInputElement
  const url = view.container.querySelector('.source-add-url') as HTMLInputElement
  fireEvent.change(name, { target: { value: 'Algebra' } })
  fireEvent.change(url, { target: { value: PASTED } })
  return { view, url }
}

beforeEach(() => vi.clearAllMocks())

describe('AddCourseRow', () => {
  it('sends one check however often Enter is pressed while it is in flight', async () => {
    let answer!: () => void
    checkCourseUrl.mockReturnValue(new Promise<void>((r) => (answer = r)))
    createCourse.mockResolvedValue(undefined)
    const { url } = openForm()
    fireEvent.keyDown(url, { key: 'Enter' })
    fireEvent.keyDown(url, { key: 'Enter' })
    expect(checkCourseUrl).toHaveBeenCalledTimes(1)
    await act(async () => answer())
    expect(createCourse).toHaveBeenCalledTimes(1)
  })

  it('creates once on a double "Save anyway", unchecked', async () => {
    checkCourseUrl.mockRejectedValue(new Error('refused'))
    let created!: () => void
    createCourse.mockReturnValue(new Promise<void>((r) => (created = r)))
    const { view, url } = openForm()
    await act(async () => fireEvent.keyDown(url, { key: 'Enter' }))
    const saveAnyway = view.container.querySelector('.course-check-save-anyway') as HTMLElement
    fireEvent.click(saveAnyway)
    fireEvent.click(saveAnyway)
    expect(checkCourseUrl).toHaveBeenCalledTimes(1)
    expect(createCourse).toHaveBeenCalledTimes(1)
    expect(createCourse).toHaveBeenCalledWith('Algebra', PASTED)
    await act(async () => created())
  })
})
