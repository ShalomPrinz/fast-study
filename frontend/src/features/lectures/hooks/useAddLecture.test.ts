// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Course } from '@/types'
import { RequestError } from '@/services/http'
import { useAddLecture } from './useAddLecture'

const { createLecture, refreshUntil, onSelect, toast } = vi.hoisted(() => ({
  createLecture: vi.fn(),
  refreshUntil: vi.fn(),
  onSelect: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/services/database', () => ({ createLecture }))
vi.mock('@/services/toaster', () => ({ toast, toastConnectionError: vi.fn() }))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ courses: [], refreshUntil }),
}))
vi.mock('@/features/lectures/hooks/useSelection', () => ({
  useSelection: () => ({ selected: null, onSelect }),
}))

const COURSE = { name: 'Algebra', lectures: [], recitations: [] } as unknown as Course

beforeEach(() => {
  vi.clearAllMocks()
  refreshUntil.mockResolvedValue(undefined)
})

async function commitName(name: string) {
  const { result } = renderHook(() => useAddLecture(COURSE))
  act(() => result.current.start('lecture'))
  act(() => result.current.edit.setValue(name))
  await act(() => result.current.commit())
}

describe('useAddLecture', () => {
  it('keeps the input open with the typed text and the refusal code, skipping refresh and navigation', async () => {
    createLecture.mockRejectedValue(
      new RequestError('already exists', 'name_taken', { name: 'Lecture 3' }),
    )

    const { result } = renderHook(() => useAddLecture(COURSE))
    act(() => result.current.start('lecture'))
    act(() => result.current.edit.setValue('Lecture 3'))
    await act(() => result.current.commit())

    expect(result.current.target).toEqual({ kind: 'lecture' })
    expect(result.current.edit.value).toBe('Lecture 3')
    expect(result.current.attempt.error).toMatchObject({ code: 'name_taken' })
    expect(toast).not.toHaveBeenCalled()
    expect(refreshUntil).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens the created lecture once a tree holding it has landed', async () => {
    createLecture.mockResolvedValue('Lecture 4')
    let land!: () => void
    refreshUntil.mockReturnValue(new Promise<void>((r) => (land = r)))

    const { result } = renderHook(() => useAddLecture(COURSE))
    act(() => result.current.start('lecture'))
    act(() => result.current.edit.setValue('Lecture 4'))
    let done!: Promise<void>
    act(() => {
      done = result.current.commit()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(createLecture).toHaveBeenCalledWith('Algebra', 'Lecture 4', 'lecture')
    expect(onSelect).not.toHaveBeenCalled()
    // The wait is for the created row in this course's lecture list.
    const has = refreshUntil.mock.calls[0][0] as (tree: Course[]) => boolean
    expect(has([COURSE])).toBe(false)
    expect(has([{ ...COURSE, lectures: [{ name: 'Lecture 4' }] } as unknown as Course])).toBe(true)

    await act(async () => {
      land()
      await done
    })
    expect(toast).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('Algebra', 'Lecture 4', 'lecture')
  })

  it('opens the sanitized name the database answers, not the typed one', async () => {
    createLecture.mockResolvedValue('Lecture 34 intro')

    await commitName('Lecture 34: intro?')

    expect(createLecture).toHaveBeenCalledWith('Algebra', 'Lecture 34: intro?', 'lecture')
    const has = refreshUntil.mock.calls[0][0] as (tree: Course[]) => boolean
    expect(
      has([{ ...COURSE, lectures: [{ name: 'Lecture 34 intro' }] } as unknown as Course]),
    ).toBe(true)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('Algebra', 'Lecture 34 intro', 'lecture')
  })

  it('opens a recitation with its kind', async () => {
    createLecture.mockResolvedValue('Recitation 2')

    const { result } = renderHook(() => useAddLecture(COURSE))
    act(() => result.current.start('recitation'))
    act(() => result.current.edit.setValue('Recitation 2'))
    await act(() => result.current.commit())

    expect(createLecture).toHaveBeenCalledWith('Algebra', 'Recitation 2', 'recitation')
    expect(onSelect).toHaveBeenCalledWith('Algebra', 'Recitation 2', 'recitation')
  })
})
