import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Course } from '@/types'
import { unskipForDownload } from './unskip'

const { updateSkipped, toastFailure } = vi.hoisted(() => ({
  updateSkipped: vi.fn(),
  toastFailure: vi.fn(),
}))
vi.mock('@/services/database', () => ({ updateSkipped }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure }))

const courses = [{ name: 'Algebra', skipped: ['a', 'b'] }] as unknown as Course[]

beforeEach(() => vi.clearAllMocks())

describe('unskipForDownload', () => {
  it('sends one batched remove with only the skipped refs', async () => {
    await unskipForDownload(courses, 'Algebra', ['a', 'x', 'b'])
    expect(updateSkipped).toHaveBeenCalledExactlyOnceWith('Algebra', { remove: ['a', 'b'] })
  })

  it('makes no call when none is skipped', async () => {
    await unskipForDownload(courses, 'Algebra', ['x'])
    await unskipForDownload(courses, 'Other', ['a'])
    expect(updateSkipped).not.toHaveBeenCalled()
  })

  it('toasts a failed write and resolves', async () => {
    updateSkipped.mockRejectedValue(new Error('nope'))
    await expect(unskipForDownload(courses, 'Algebra', ['a'])).resolves.toBeUndefined()
    expect(toastFailure).toHaveBeenCalledOnce()
  })
})
