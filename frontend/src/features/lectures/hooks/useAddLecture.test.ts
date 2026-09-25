// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { Course } from '@/types'
import { RequestError } from '@/services/http'
import { useAddLecture } from './useAddLecture'

const { createLecture, refreshCourses, toast } = vi.hoisted(() => ({
  createLecture: vi.fn(),
  refreshCourses: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/services/database', () => ({ createLecture }))
vi.mock('@/services/toaster', () => ({ toast, toastConnectionError: vi.fn() }))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ courses: [], refreshCourses }),
}))

const COURSE = { name: 'Algebra', lectures: [], recitations: [] } as unknown as Course

beforeEach(() => {
  vi.clearAllMocks()
})

async function commitName(name: string) {
  const { result } = renderHook(() => useAddLecture(COURSE))
  act(() => result.current.start('lecture'))
  act(() => result.current.edit.setValue(name))
  await act(() => result.current.commit())
}

describe('useAddLecture', () => {
  it('toasts a taken name with its code and skips the refresh', async () => {
    createLecture.mockRejectedValue(
      new RequestError('already exists', 'name_taken', { name: 'Lecture 3' }),
    )

    await commitName('Lecture 3')

    expect(toast).toHaveBeenCalledTimes(1)
    const [kind, node] = toast.mock.calls[0]
    expect(kind).toBe('error')
    // The code and params reach the toast, so it resolves through the name_taken catalog row.
    expect((node as ReactElement<{ failure: unknown }>).props.failure).toMatchObject({
      code: 'name_taken',
      params: { name: 'Lecture 3' },
    })
    expect(refreshCourses).not.toHaveBeenCalled()
  })

  it('refreshes after a successful create', async () => {
    createLecture.mockResolvedValue(undefined)

    await commitName('Lecture 4')

    expect(createLecture).toHaveBeenCalledWith('Algebra', 'Lecture 4', 'lecture')
    expect(toast).not.toHaveBeenCalled()
    expect(refreshCourses).toHaveBeenCalledTimes(1)
  })
})
