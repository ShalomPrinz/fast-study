// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import type { Item } from '@/features/downloads/services/autoDownloader'
import type { PasscodePromptProps } from './PasscodePrompt'
import { MoodleLockProvider } from '@/features/downloads/contexts/MoodleLockContext'
import RecordingRow from './RecordingRow'

const { hook } = vi.hoisted(() => ({
  hook: { download: vi.fn(), passcode: null as PasscodePromptProps | null },
}))
vi.mock('@/features/downloads/hooks/useRecordingDownload', () => ({
  useRecordingDownload: () => ({
    download: hook.download,
    retryClip: vi.fn(),
    pending: false,
    retryingId: null,
    failed: false,
    passcode: hook.passcode,
  }),
}))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ courses: [] }),
}))
vi.mock('@/shared/contexts/RunnerStatusContext', () => ({
  useRunnerStatus: () => ({ status: null }),
}))
vi.mock('@/features/lectures/utils/renameLock', () => ({ isLectureRenameLocked: () => false }))
vi.mock('@/features/downloads/contexts/DownloadJobsContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRowJobs: () => [],
}))
vi.mock('@/features/downloads/contexts/RowEditsContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRowEdit: () => ({
    kind: 'lecture',
    suggestion: 'Lecture 3',
    value: '',
    name: 'Lecture 3',
    setName: vi.fn(),
    setKind: vi.fn(),
  }),
}))
// A downloaded video row: its re-download button opens the overwrite confirm.
vi.mock('@/features/downloads/utils/existingItems', () => ({
  existingNames: () => [],
  materialsOf: () => [],
  hasResource: (item: { media: string }) => item.media === 'video',
  overwritesVideo: () => true,
  splitSiblings: () => [],
}))

i18n.activate('en')

const ITEM = { ref: 'r', title: 'Rec', kind: 'lecture', media: 'video', expandable: false } as Item

function tree(busy: boolean, moodle: boolean) {
  return createElement(I18nProvider, {
    i18n,
    children: createElement(MoodleLockProvider, {
      frame: { moodleBusy: busy },
      children: createElement(RecordingRow, {
        item: { ...ITEM, moodle },
        edit: undefined,
        lock: undefined,
        course: 'Algebra',
        onReconnect: vi.fn(),
      }),
    }),
  })
}

// The modal's primary action and its dismiss button, and the settled row's re-download icon.
const button = (sel: string) => document.querySelector(sel) as HTMLButtonElement
const SUBMIT = '.modal .btn--primary'
const CANCEL = '.modal .btn--ghost'
const AGAIN = '.pipeline-icon-btn'
const typePasscode = () =>
  fireEvent.change(document.querySelector('.passcode-input')!, { target: { value: '1234' } })

afterEach(cleanup)
beforeEach(() => {
  hook.download.mockReset()
  hook.passcode = null
})

describe('RecordingRow modals under the Moodle lock', () => {
  it("disables the confirm's Yes while busy and re-enables it once the push clears", () => {
    const view = render(tree(false, true))
    fireEvent.click(button(AGAIN))
    view.rerender(tree(true, true))
    expect(button(SUBMIT).disabled).toBe(true)
    expect(button(CANCEL).disabled).toBe(false)
    fireEvent.click(button(SUBMIT))
    expect(hook.download).not.toHaveBeenCalled()
    view.rerender(tree(false, true))
    expect(button(SUBMIT).disabled).toBe(false)
    fireEvent.click(button(SUBMIT))
    expect(hook.download).toHaveBeenCalledTimes(1)
  })

  it("disables the passcode's Submit while busy and re-enables it once the push clears", () => {
    const onSubmit = vi.fn()
    hook.passcode = { reason: 'missing', busy: false, onSubmit, onCancel: vi.fn() }
    const view = render(tree(true, true))
    typePasscode()
    expect(button(SUBMIT).disabled).toBe(true)
    expect(button(CANCEL).disabled).toBe(false)
    fireEvent.submit(button(SUBMIT).closest('form')!)
    expect(onSubmit).not.toHaveBeenCalled()
    view.rerender(tree(false, true))
    expect(button(SUBMIT).disabled).toBe(false)
    fireEvent.click(button(SUBMIT))
    expect(onSubmit).toHaveBeenCalledWith('1234', 'course')
  })

  it('leaves both enabled on a row that does not reach Moodle', () => {
    hook.passcode = { reason: 'missing', busy: false, onSubmit: vi.fn(), onCancel: vi.fn() }
    render(tree(true, false))
    typePasscode()
    expect(button(SUBMIT).disabled).toBe(false)
    cleanup()
    // The confirm on its own, so the query cannot land on the passcode's Submit.
    hook.passcode = null
    render(tree(true, false))
    fireEvent.click(button(AGAIN))
    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    expect(button(SUBMIT).disabled).toBe(false)
  })
})

describe('RecordingRow unknown rows', () => {
  it('shows Unsupported with Download disabled for a row probed as a non-video file', () => {
    const item = { ...ITEM, media: 'unknown', resolvedMedia: 'unsupported' } as Item
    render(
      createElement(I18nProvider, {
        i18n,
        children: createElement(MoodleLockProvider, {
          frame: { moodleBusy: false },
          children: createElement(RecordingRow, {
            item,
            edit: undefined,
            lock: undefined,
            course: 'Algebra',
            onReconnect: vi.fn(),
          }),
        }),
      }),
    )
    expect(document.querySelector('.chip--neutral')?.textContent).toBe('Unsupported')
    expect(document.body.textContent).not.toContain('Material')
    expect(button('.recording-download-btn').disabled).toBe(true)
  })
})
