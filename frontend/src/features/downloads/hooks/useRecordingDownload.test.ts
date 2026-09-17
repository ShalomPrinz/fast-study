// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  PasscodeError,
  ReconnectError,
  UnsupportedError,
  type Item,
} from '@/features/downloads/services/autoDownloader'
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'
import { ResolvedMediaContext } from '@/features/downloads/contexts/ResolvedMediaContext'
import { RowEditsDispatchContext } from '@/features/downloads/contexts/RowEditsContext'
import { useRecordingDownload } from './useRecordingDownload'

const { downloadItem, saveZoomPasscode, toastDownloadError } = vi.hoisted(() => ({
  downloadItem: vi.fn(),
  saveZoomPasscode: vi.fn(),
  toastDownloadError: vi.fn(),
}))
vi.mock('@/features/downloads/services/downloadServer', () => ({ downloadItem }))
// Partial: the hook's `is*` guards are `instanceof` checks, so the real error classes must stay.
vi.mock('@/features/downloads/services/autoDownloader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveZoomPasscode,
}))
vi.mock('@/features/downloads/utils/downloadErrors', () => ({ toastDownloadError }))
vi.mock('@/services/toaster', () => ({ toast: vi.fn(), toastConnectionError: vi.fn() }))

const resolveMedia = vi.fn()
const setName = vi.fn()
const setKind = vi.fn()
const onReconnect = vi.fn()

const ITEM = { ref: 'row-ref', title: 'Row title', kind: 'lecture' } as Item
const ROW_ARGS = { ref: 'row-ref', course: 'Algebra', name: 'Lecture 3', kind: 'lecture' }
const JOB = {
  id: 'job-1',
  title: 'Clip 2',
  ref: 'clip-ref',
  course: 'Algebra',
  kind: 'recitation',
} as JobProgress

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ResolvedMediaContext.Provider,
    { value: resolveMedia },
    createElement(RowEditsDispatchContext.Provider, { value: { setName, setKind } }, children),
  )
}

function render() {
  return renderHook(
    () =>
      useRecordingDownload({
        item: ITEM,
        course: 'Algebra',
        name: 'Lecture 3',
        kind: 'lecture',
        onReconnect,
      }),
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useRecordingDownload', () => {
  it('resolves the row and adopts the server rename on success', async () => {
    let finish!: (v: unknown) => void
    downloadItem.mockReturnValueOnce(new Promise((res) => (finish = res)))
    const { result } = render()

    let done!: Promise<void>
    act(() => {
      done = result.current.download()
    })
    expect(result.current.pending).toBe(true)

    await act(async () => {
      finish({ media: 'video', jobIds: ['j'], renames: [{ ref: 'row-ref', name: 'Lecture 3_' }] })
      await done
    })

    expect(downloadItem).toHaveBeenCalledWith(ROW_ARGS)
    expect(resolveMedia).toHaveBeenCalledWith('row-ref', 'video')
    expect(setName).toHaveBeenCalledWith('row-ref', 'Lecture 3_')
    expect(result.current.pending).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  it('steers a reconnect error to the reconnect pill without a toast', async () => {
    downloadItem.mockRejectedValueOnce(new ReconnectError())
    const { result } = render()

    await act(() => result.current.download())

    expect(onReconnect).toHaveBeenCalledTimes(1)
    expect(toastDownloadError).not.toHaveBeenCalled()
    expect(result.current.failed).toBe(false)
  })

  it('resolves an unsupported file and marks the row failed', async () => {
    downloadItem.mockRejectedValueOnce(new UnsupportedError('zip'))
    const { result } = render()

    await act(() => result.current.download())

    expect(resolveMedia).toHaveBeenCalledWith('row-ref', 'unsupported')
    expect(result.current.failed).toBe(true)
    expect(toastDownloadError).toHaveBeenCalledTimes(1)
  })

  it('toasts a generic failure without resolving the row', async () => {
    downloadItem.mockRejectedValueOnce(new Error('HTTP 500'))
    const { result } = render()

    await act(() => result.current.download())

    expect(toastDownloadError).toHaveBeenCalledTimes(1)
    expect(result.current.failed).toBe(true)
    expect(resolveMedia).not.toHaveBeenCalled()
  })

  it('opens the passcode gate on a row download and replays the row after saving', async () => {
    downloadItem
      .mockRejectedValueOnce(new PasscodeError('incorrect'))
      .mockResolvedValueOnce({ media: 'video', jobIds: [] })
    saveZoomPasscode.mockResolvedValueOnce(undefined)
    const { result } = render()

    await act(() => result.current.download())
    expect(result.current.passcode?.reason).toBe('incorrect')

    await act(async () => {
      await result.current.passcode!.onSubmit('1234', 'course')
    })

    expect(saveZoomPasscode).toHaveBeenCalledWith({
      course: 'Algebra',
      name: 'Lecture 3',
      passcode: '1234',
      scope: 'course',
    })
    expect(result.current.passcode).toBeNull()
    expect(downloadItem).toHaveBeenCalledTimes(2)
    expect(downloadItem).toHaveBeenLastCalledWith(ROW_ARGS)
  })

  it('replays the clip, not the row, when a clip retry hit the passcode gate', async () => {
    downloadItem
      .mockRejectedValueOnce(new PasscodeError('missing'))
      .mockResolvedValueOnce({ media: 'video', jobIds: [] })
    saveZoomPasscode.mockResolvedValueOnce(undefined)
    const { result } = render()

    await act(() => result.current.retryClip(JOB))
    await act(async () => {
      await result.current.passcode!.onSubmit('1234', 'lecture')
    })

    expect(saveZoomPasscode).toHaveBeenCalledWith({
      course: 'Algebra',
      name: 'Clip 2',
      passcode: '1234',
      scope: 'lecture',
    })
    expect(downloadItem).toHaveBeenCalledTimes(2)
    expect(downloadItem).toHaveBeenLastCalledWith({
      ref: 'clip-ref',
      course: 'Algebra',
      name: 'Clip 2',
      kind: 'recitation',
      only: true,
    })
  })

  it('fails the row and replays nothing when saving the passcode fails', async () => {
    downloadItem.mockRejectedValueOnce(new PasscodeError('missing'))
    saveZoomPasscode.mockRejectedValueOnce(new Error('HTTP 500'))
    const { result } = render()

    await act(() => result.current.download())
    await act(async () => {
      await result.current.passcode!.onSubmit('1234', 'course')
    })

    expect(toastDownloadError).toHaveBeenCalledTimes(1)
    expect(result.current.failed).toBe(true)
    expect(result.current.passcode).toBeNull()
    expect(downloadItem).toHaveBeenCalledTimes(1)
  })

  it('fails the row and replays nothing when the prompt is cancelled', async () => {
    downloadItem.mockRejectedValueOnce(new PasscodeError('missing'))
    const { result } = render()

    await act(() => result.current.download())
    act(() => result.current.passcode!.onCancel())

    expect(result.current.passcode).toBeNull()
    expect(result.current.failed).toBe(true)
    expect(downloadItem).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty passcode', async () => {
    downloadItem.mockRejectedValueOnce(new PasscodeError('missing'))
    const { result } = render()

    await act(() => result.current.download())
    await act(async () => {
      await result.current.passcode!.onSubmit('', 'course')
    })

    expect(saveZoomPasscode).not.toHaveBeenCalled()
    expect(result.current.passcode).not.toBeNull()
    expect(downloadItem).toHaveBeenCalledTimes(1)
  })
})
