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
import {
  MoodleLockProvider,
  useMoodleLockState,
} from '@/features/downloads/contexts/MoodleLockContext'
import { MoodleBusyError } from '@/services/http'
import { useRecordingDownload } from './useRecordingDownload'

const { downloadItem, saveZoomPasscode, toastDownloadError, toastLectureBusy, runner } = vi.hoisted(
  () => ({
    downloadItem: vi.fn(),
    saveZoomPasscode: vi.fn(),
    toastDownloadError: vi.fn(),
    toastLectureBusy: vi.fn(),
    runner: { status: null as unknown },
  }),
)
vi.mock('@/features/downloads/services/downloadServer', () => ({ downloadItem }))
// Partial: the hook's `is*` guards are `instanceof` checks, so the real error classes must stay.
vi.mock('@/features/downloads/services/autoDownloader', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveZoomPasscode,
}))
vi.mock('@/features/downloads/utils/downloadErrors', () => ({
  toastDownloadError,
  toastLectureBusy,
}))
vi.mock('@/shared/contexts/RunnerStatusContext', () => ({
  useRunnerStatus: () => ({ status: runner.status }),
}))
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
    MoodleLockProvider,
    { frame: null, children: null },
    createElement(
      ResolvedMediaContext.Provider,
      { value: resolveMedia },
      createElement(RowEditsDispatchContext.Provider, { value: { setName, setKind } }, children),
    ),
  )
}

function render(siblings: string[] = []) {
  return renderHook(
    () =>
      useRecordingDownload({
        item: ITEM,
        course: 'Algebra',
        name: 'Lecture 3',
        kind: 'lecture',
        siblings,
        onReconnect,
      }),
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  runner.status = null
})

// Under a busy pushed lock: whether this row's download takes the lock is the row's `moodle` flag alone.
function renderUnderBusyLock(moodle: boolean) {
  const busyWrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MoodleLockProvider,
      { frame: { moodleBusy: true }, children: null },
      createElement(
        ResolvedMediaContext.Provider,
        { value: resolveMedia },
        createElement(RowEditsDispatchContext.Provider, { value: { setName, setKind } }, children),
      ),
    )
  return renderHook(
    () => ({
      row: useRecordingDownload({
        item: { ...ITEM, moodle },
        course: 'Algebra',
        name: 'Lecture 3',
        kind: 'lecture',
        siblings: [],
        onReconnect,
      }),
      lock: useMoodleLockState(),
    }),
    { wrapper: busyWrapper },
  )
}

describe('a row under a busy Moodle lock', () => {
  it('sends a Moodle row through the lock, claiming it while in flight', async () => {
    let finish!: (v: unknown) => void
    downloadItem.mockReturnValueOnce(new Promise((res) => (finish = res)))
    const { result } = renderUnderBusyLock(true)

    let done!: Promise<void>
    act(() => {
      done = result.current.row.download()
    })
    expect(result.current.lock).toEqual({ busy: true, claimed: true })
    await act(async () => {
      finish({ media: 'material', jobIds: ['j'], renames: [] })
      await done
    })
    expect(result.current.lock.claimed).toBe(false)
  })

  it('sends a non-Moodle row straight out, never touching the lock', async () => {
    let finish!: (v: unknown) => void
    downloadItem.mockReturnValueOnce(new Promise((res) => (finish = res)))
    const { result } = renderUnderBusyLock(false)

    let done!: Promise<void>
    act(() => {
      done = result.current.row.download()
    })
    expect(downloadItem).toHaveBeenCalledOnce()
    expect(result.current.lock).toEqual({ busy: true, claimed: false })
    await act(async () => {
      finish({ media: 'video', jobIds: ['j'], renames: [] })
      await done
    })
  })
})

describe('useRecordingDownload', () => {
  it('leaves the row as it was, untoasted, when a busy Moodle lock refuses it', async () => {
    downloadItem.mockRejectedValueOnce(new MoodleBusyError('lock taken'))
    const { result } = render()

    await act(() => result.current.download())

    expect(toastDownloadError).not.toHaveBeenCalled()
    expect(result.current.failed).toBe(false)
    expect(result.current.pending).toBe(false)
  })

  it('refuses to start while the pipeline runs or queues the target lecture', async () => {
    runner.status = {
      inFlight: [],
      queue: [{ course: 'Algebra', lecture: 'Lecture 3', kind: 'lecture', depth: 'full' }],
      overviewRunning: [],
    }
    const { result } = render()

    await act(() => result.current.download())

    expect(downloadItem).not.toHaveBeenCalled()
    expect(toastLectureBusy).toHaveBeenCalledWith('Lecture 3')
    expect(result.current.failed).toBe(false)
    expect(result.current.pending).toBe(false)
  })

  it('refuses a row download while the pipeline runs a split sibling it could overwrite', async () => {
    runner.status = {
      inFlight: [{ course: 'Algebra', lecture: 'Lecture 3.1', kind: 'lecture', depth: 'full' }],
      queue: [],
      overviewRunning: [],
    }
    const { result } = render(['Lecture 3.1', 'Lecture 3.2'])

    await act(() => result.current.download())

    expect(downloadItem).not.toHaveBeenCalled()
    expect(toastLectureBusy).toHaveBeenCalledWith('Lecture 3.1')
  })

  it('lets a clip retry through while the pipeline runs only its sibling clip', async () => {
    runner.status = {
      inFlight: [{ course: 'Algebra', lecture: 'Clip 1', kind: 'recitation', depth: 'full' }],
      queue: [],
      overviewRunning: [],
    }
    downloadItem.mockResolvedValueOnce({ media: 'video', jobIds: ['j'], renames: [] })
    const { result } = render(['Clip 1'])

    await act(() => result.current.retryClip(JOB))

    expect(toastLectureBusy).not.toHaveBeenCalled()
    expect(downloadItem).toHaveBeenCalledOnce()
  })

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
