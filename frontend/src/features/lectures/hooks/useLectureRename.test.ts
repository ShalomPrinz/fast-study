// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLectureRename } from './useLectureRename'

const { renameLecture, refreshUntil, onSelect, state } = vi.hoisted(() => ({
  renameLecture: vi.fn(),
  refreshUntil: vi.fn(),
  onSelect: vi.fn(),
  state: { status: null as unknown },
}))
vi.mock('@/services/database', () => ({ renameLecture }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure: vi.fn() }))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ refreshUntil }),
}))
vi.mock('@/shared/contexts/RunnerStatusContext', () => ({
  useRunnerStatus: () => ({ status: state.status }),
}))
vi.mock('@/features/lectures/hooks/useSelection', () => ({
  useSelection: () => ({ selected: null, onSelect }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.status = null
  refreshUntil.mockResolvedValue(undefined)
})

describe('useLectureRename', () => {
  it('renames, then moves the open page to the folder the database answered with', async () => {
    renameLecture.mockResolvedValue('New')
    const { result } = renderHook(() => useLectureRename('C', 'Old', 'lecture', true))
    act(() => result.current.actions.start())
    expect(result.current.edit.value).toBe('Old')
    act(() => result.current.edit.setValue(' New '))
    await act(() => result.current.actions.commit())
    expect(renameLecture).toHaveBeenCalledWith('C', 'Old', 'New', 'lecture')
    expect(onSelect).toHaveBeenCalledWith('C', 'New', 'lecture', { replace: true })
    expect(result.current.renaming).toBe(false)
  })

  it('does not navigate when the lecture is not the open page', async () => {
    renameLecture.mockResolvedValue('New')
    const { result } = renderHook(() => useLectureRename('C', 'Old', 'lecture', false))
    act(() => result.current.actions.start())
    act(() => result.current.edit.setValue('New'))
    await act(() => result.current.actions.commit())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('skips an unchanged or empty name', async () => {
    const { result } = renderHook(() => useLectureRename('C', 'Old', 'lecture', true))
    act(() => result.current.actions.start())
    await act(() => result.current.actions.commit())
    expect(renameLecture).not.toHaveBeenCalled()
  })

  it('will not open while a run holds the lecture', () => {
    state.status = {
      inFlight: [{ course: 'C', lecture: 'Old', kind: 'lecture' }],
      queue: [],
      overviewRunning: [],
    }
    const { result } = renderHook(() => useLectureRename('C', 'Old', 'lecture', true))
    expect(result.current.locked).toBe(true)
    act(() => result.current.actions.start())
    expect(result.current.renaming).toBe(false)
  })

  it('cancel closes without renaming', () => {
    const { result } = renderHook(() => useLectureRename('C', 'Old', 'lecture', true))
    act(() => result.current.actions.start())
    act(() => result.current.actions.cancel())
    expect(result.current.renaming).toBe(false)
    expect(renameLecture).not.toHaveBeenCalled()
  })
})
