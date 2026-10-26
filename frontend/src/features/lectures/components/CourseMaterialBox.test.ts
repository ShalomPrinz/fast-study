// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import type { AssignmentLecture, Course } from '@/types'
import CourseMaterialBox from './CourseMaterialBox'

const { setAssignmentLectures } = vi.hoisted(() => ({ setAssignmentLectures: vi.fn() }))
vi.mock('@/services/database', () => ({ setAssignmentLectures }))
vi.mock('@/shared/utils/failure', () => ({ toastFailure: vi.fn() }))

i18n.activate('en')

const lecture = (name: string) => ({ name, files: { 'summary.md': { exists: true, size: 1 } } })
const course = {
  name: 'C',
  lectures: [lecture('A'), lecture('B')],
  recitations: [],
} as unknown as Course

afterEach(() => {
  cleanup()
  setAssignmentLectures.mockReset()
})

function mount(chosen: AssignmentLecture[]) {
  render(
    createElement(I18nProvider, {
      i18n,
      children: createElement(CourseMaterialBox, {
        course,
        assignment: 'HW',
        chosen,
        locked: false,
      }),
    }),
  )
  fireEvent.click(document.querySelector('.course-material-picker > button')!)
  return [...document.querySelectorAll<HTMLInputElement>('.course-material-option input')]
}

describe('CourseMaterialBox', () => {
  it('keeps the first pick when a second lands before the tree refreshes', async () => {
    setAssignmentLectures.mockResolvedValue(undefined)
    const [a, b] = mount([])
    fireEvent.click(a)
    fireEvent.click(b)
    await waitFor(() => expect(setAssignmentLectures).toHaveBeenCalledTimes(2))
    expect(setAssignmentLectures.mock.calls[0][2]).toEqual([{ name: 'A', kind: 'lecture' }])
    expect(setAssignmentLectures.mock.calls[1][2]).toEqual([
      { name: 'A', kind: 'lecture' },
      { name: 'B', kind: 'lecture' },
    ])
  })
})
