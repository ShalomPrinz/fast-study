// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup, screen, waitFor } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { MoodleLockProvider } from '@/features/downloads/contexts/MoodleLockContext'
import LanguageSwitcher from '@/shared/sidebar/LanguageSwitcher'
import AddCoursePanel from './AddCoursePanel'

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

function mount(onDone = vi.fn()) {
  return render(
    createElement(I18nProvider, {
      i18n,
      children: [
        createElement(LanguageSwitcher, { key: 'lang' }),
        createElement(MoodleLockProvider, {
          key: 'row',
          frame: { moodleBusy: false },
          children: createElement(AddCoursePanel, { onDone }),
        }),
      ],
    }),
  )
}

// The site's list is closed, so the picker opens on the paste input; a pasted URL leads to the form.
async function pasteUrl() {
  fetchEnrolledCourses.mockResolvedValue({ available: false })
  const view = mount()
  const paste = (await waitFor(() => {
    const el = view.container.querySelector('.course-url-paste-input')
    if (!el) throw new Error('no paste input')
    return el
  })) as HTMLInputElement
  fireEvent.change(paste, { target: { value: PASTED } })
  return { view, paste }
}

function fillName(view: ReturnType<typeof mount>) {
  const name = view.container.querySelector('.source-add-name') as HTMLInputElement
  fireEvent.change(name, { target: { value: 'Algebra' } })
  return name
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('AddCoursePanel', () => {
  it('checks a pasted URL once however often Enter is pressed, then creates once', async () => {
    let answer!: () => void
    checkCourseUrl.mockReturnValue(new Promise<void>((r) => (answer = r)))
    createCourse.mockResolvedValue(undefined)
    const { view, paste } = await pasteUrl()
    fireEvent.keyDown(paste, { key: 'Enter' })
    fireEvent.keyDown(paste, { key: 'Enter' })
    expect(checkCourseUrl).toHaveBeenCalledTimes(1)
    await act(async () => answer())
    const url = view.container.querySelector('.source-add-url') as HTMLInputElement
    expect(url.value).toBe(PASTED)
    expect(url.readOnly).toBe(true)
    const name = fillName(view)
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(createCourse).toHaveBeenCalledTimes(1)
    expect(createCourse).toHaveBeenCalledWith('Algebra', PASTED)
    expect(checkCourseUrl).toHaveBeenCalledTimes(1)
  })

  it('saves a refused paste anyway and creates unchecked', async () => {
    checkCourseUrl.mockRejectedValue(new Error('refused'))
    createCourse.mockResolvedValue(undefined)
    const { view, paste } = await pasteUrl()
    await act(async () => fireEvent.keyDown(paste, { key: 'Enter' }))
    const saveAnyway = view.container.querySelector('.course-check-save-anyway') as HTMLElement
    fireEvent.click(saveAnyway)
    fireEvent.keyDown(fillName(view), { key: 'Enter' })
    expect(checkCourseUrl).toHaveBeenCalledTimes(1)
    expect(createCourse).toHaveBeenCalledTimes(1)
    expect(createCourse).toHaveBeenCalledWith('Algebra', PASTED)
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
    const item = (await waitFor(() => {
      const el = view.container.querySelector('.course-picker-item')
      if (!el) throw new Error('no item')
      return el
    })) as HTMLElement
    expect(fetchEnrolledCourses).toHaveBeenCalledWith('en')
    expect(item.querySelector('.course-picker-code')?.textContent).toBe('868922001')
    fireEvent.click(item)
    const name = view.container.querySelector('.source-add-name') as HTMLInputElement
    expect(name.value).toBe('Algorithms 1')
  })

  it('disables the language switcher with its hint while the picker is open, and Cancel closes the panel', async () => {
    fetchEnrolledCourses.mockResolvedValue({ available: false })
    const onDone = vi.fn()
    const view = mount(onDone)
    const switcher = view.container.querySelector('.language-switcher') as HTMLElement
    const langs = () => [...switcher.querySelectorAll('button')].map((b) => b.disabled)
    await act(async () => {})
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
    expect(onDone).toHaveBeenCalled()
  })
})
