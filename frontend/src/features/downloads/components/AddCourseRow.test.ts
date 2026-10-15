// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup, screen, waitFor } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { MoodleLockProvider } from '@/features/downloads/contexts/MoodleLockContext'
import LanguageSwitcher from '@/shared/sidebar/LanguageSwitcher'
import AddCourseRow from './AddCourseRow'

const { checkCourseUrl, createCourse, fetchEnrolledCourses } = vi.hoisted(() => ({
  checkCourseUrl: vi.fn(),
  createCourse: vi.fn(),
  fetchEnrolledCourses: vi.fn(),
}))
vi.mock('@/features/downloads/services/autoDownloader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkCourseUrl,
  fetchEnrolledCourses,
}))
vi.mock('@/features/downloads/contexts/AuthStatusContext', () => ({
  useAuthStatus: () => ({ status: { connected: true, expired: false } }),
}))
vi.mock('@/features/downloads/contexts/DownloadsSessionContext', () => ({
  useDownloadsActions: () => ({ reconnectHint: vi.fn() }),
}))
vi.mock('@/services/database', () => ({ createCourse }))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ refreshCourses: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock('@/services/toaster', () => ({ toast: vi.fn(), toastConnectionError: vi.fn() }))

const PASTED = 'https://m/mod/resource/view.php?id=5'

function mount() {
  return render(
    createElement(I18nProvider, {
      i18n,
      children: [
        createElement(LanguageSwitcher, { key: 'lang' }),
        createElement(MoodleLockProvider, {
          key: 'row',
          frame: { moodleBusy: false },
          children: createElement(AddCourseRow),
        }),
      ],
    }),
  )
}

function openForm() {
  const view = mount()
  const [, manual] = view.container.querySelectorAll('.source-add-btn')
  fireEvent.click(manual)
  const name = view.container.querySelector('.source-add-name') as HTMLInputElement
  const url = view.container.querySelector('.source-add-url') as HTMLInputElement
  fireEvent.change(name, { target: { value: 'Algebra' } })
  fireEvent.change(url, { target: { value: PASTED } })
  return { view, url }
}

afterEach(cleanup)
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

  it('shows the course code as its own chip and prefills only the name', async () => {
    fetchEnrolledCourses.mockResolvedValue({
      available: true,
      courses: [
        {
          id: 7,
          name: 'Algorithms 1',
          code: '868922001',
          url: 'https://m/course/view.php?id=7',
          past: false,
        },
      ],
    })
    const view = mount()
    const [fromMoodle] = view.container.querySelectorAll('.source-add-btn')
    await act(async () => fireEvent.click(fromMoodle))
    expect(fetchEnrolledCourses).toHaveBeenCalledWith('en')
    const item = view.container.querySelector('.course-picker-item') as HTMLElement
    expect(item.querySelector('.course-picker-code')?.textContent).toBe('868922001')
    fireEvent.click(item)
    const name = view.container.querySelector('.source-add-name') as HTMLInputElement
    expect(name.value).toBe('Algorithms 1')
  })

  it('disables the language switcher with its hint while the picker is open, and frees it on close', async () => {
    fetchEnrolledCourses.mockResolvedValue({ available: false })
    const view = mount()
    const switcher = view.container.querySelector('.language-switcher') as HTMLElement
    const langs = () => [...switcher.querySelectorAll('button')].map((b) => b.disabled)
    expect(langs()).toEqual([false, false])
    const [fromMoodle] = view.container.querySelectorAll('.source-add-btn')
    await act(async () => fireEvent.click(fromMoodle))
    expect(langs()).toEqual([true, true])
    fireEvent.mouseEnter(switcher)
    await waitFor(() =>
      expect(screen.getByRole('tooltip').textContent).toBe(
        'Close the course list to change the language',
      ),
    )
    fireEvent.mouseLeave(switcher)
    const cancel = [...view.container.querySelectorAll('.course-picker button')].find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLElement
    fireEvent.click(cancel)
    expect(langs()).toEqual([false, false])
  })
})
