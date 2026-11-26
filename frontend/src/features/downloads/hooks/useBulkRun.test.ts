// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { I18nProvider } from '@lingui/react'
import { setupI18n } from '@lingui/core'
import { renderHook, act } from '@testing-library/react'
import type { Item } from '@/features/downloads/services/autoDownloader'
import { useBulkRun } from './useBulkRun'

const { updateSkipped, toastFailure, startSectionRun, tree, hasResource } = vi.hoisted(() => ({
  updateSkipped: vi.fn(),
  toastFailure: vi.fn(),
  startSectionRun: vi.fn(),
  tree: { courses: [] as unknown[] },
  hasResource: vi.fn(),
}))
vi.mock('@/services/database', () => ({ updateSkipped }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure }))
vi.mock('@/services/toaster', () => ({ toast: vi.fn() }))
vi.mock('@/features/downloads/services/downloadServer', () => ({
  startSectionRun,
  cancelRun: vi.fn(),
  resumeRun: vi.fn(),
}))
vi.mock('@/features/downloads/services/autoDownloader', () => ({ saveZoomPasscode: vi.fn() }))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ courses: tree.courses }),
}))
vi.mock('@/shared/contexts/RunnerStatusContext', () => ({
  useRunnerStatus: () => ({ status: null }),
}))
vi.mock('@/features/downloads/contexts/DownloadJobsContext', () => ({ useJobsByRef: () => ({}) }))
vi.mock('@/features/downloads/contexts/SectionRunsContext', () => ({
  useSectionRun: () => null,
}))
vi.mock('@/features/downloads/contexts/MoodleLockContext', () => ({
  useWithMoodleLock: () => (f: () => Promise<unknown>) => f(),
}))
vi.mock('@/features/downloads/contexts/ResolvedMediaContext', () => ({
  useResolveMedia: () => vi.fn(),
}))
vi.mock('@/features/downloads/contexts/RowEditsContext', () => ({
  useRowEditsDispatch: () => ({
    setName: vi.fn(),
    lock: vi.fn(),
    read: () => ({ edits: {}, locks: {} }),
  }),
  resolveRow: (item: Item) => ({ name: item.title, kind: 'lecture' }),
}))
vi.mock('@/features/downloads/utils/existingItems', () => ({
  hasResource,
  overwritesVideo: () => false,
  splitSiblings: () => [],
}))

const item = (ref: string) => ({ ref, title: ref, media: 'video' }) as unknown as Item

beforeEach(() => {
  vi.clearAllMocks()
  startSectionRun.mockResolvedValue([])
  hasResource.mockImplementation((i: Item) => i.ref === 'done')
  tree.courses = [{ name: 'Algebra', skipped: ['a', 'done', 'b'] }]
})

const i18n = setupI18n({ locale: 'en', messages: { en: {} } })
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(I18nProvider, { i18n, children })

function start(queue: Item[]) {
  const { result } = renderHook(() => useBulkRun('sec', 'Algebra', 'Section'), { wrapper })
  return act(() => result.current.start(queue, false))
}

describe('useBulkRun un-skipping', () => {
  it('sends one remove with only skipped, pending refs', async () => {
    await start([item('a'), item('x'), item('done'), item('b')])
    expect(updateSkipped).toHaveBeenCalledExactlyOnceWith('Algebra', { remove: ['a', 'b'] })
    expect(startSectionRun).toHaveBeenCalledOnce()
  })

  it('makes no call when no pending ref is skipped', async () => {
    await start([item('x'), item('done')])
    expect(updateSkipped).not.toHaveBeenCalled()
  })

  it('toasts a failed write and still starts the run', async () => {
    updateSkipped.mockRejectedValue(new Error('nope'))
    await start([item('a')])
    expect(toastFailure).toHaveBeenCalledOnce()
    expect(startSectionRun).toHaveBeenCalledOnce()
  })
})
