import { describe, it, expect } from 'vitest'
import { renameFollowTarget, type OpenPage } from './renameFollow'

const none: OpenPage = {
  selected: null,
  overviewOpen: false,
  openAssignment: null,
  mergedOpen: false,
  mergedNewOpen: false,
}

describe('renameFollowTarget', () => {
  it('follows a selected lecture of the course', () => {
    const selected = { course: 'A', lecture: 'L1', kind: 'lecture' as const }
    expect(renameFollowTarget('A', 'B', { ...none, selected })).toEqual({
      type: 'lecture',
      lecture: 'L1',
      kind: 'lecture',
    })
  })

  it('ignores a selection in another course', () => {
    const selected = { course: 'Z', lecture: 'L1', kind: 'lecture' as const }
    expect(renameFollowTarget('A', 'B', { ...none, selected })).toBeNull()
  })

  it('follows the overview', () => {
    expect(renameFollowTarget('A', 'B', { ...none, overviewOpen: true })).toEqual({
      type: 'path',
      to: '/course/B/overview',
    })
  })

  it('follows an assignment', () => {
    const t = renameFollowTarget('A', 'B', { ...none, openAssignment: 'hw1' })
    expect(t).toMatchObject({ type: 'path' })
    expect((t as { to: string }).to).toContain('/course/B/')
    expect((t as { to: string }).to).toContain('hw1')
  })

  it('follows the merged history page', () => {
    expect(renameFollowTarget('A', 'B', { ...none, mergedOpen: true })).toEqual({
      type: 'path',
      to: '/course/B/merged',
    })
  })

  it('follows the merged create page', () => {
    expect(renameFollowTarget('A', 'B', { ...none, mergedNewOpen: true })).toEqual({
      type: 'path',
      to: '/course/B/merged/new',
    })
  })

  it('keeps precedence: lecture, overview, assignment, then merged', () => {
    const all = { ...none, overviewOpen: true, openAssignment: 'x', mergedOpen: true }
    expect(renameFollowTarget('A', 'B', all)).toEqual({ type: 'path', to: '/course/B/overview' })
    expect(renameFollowTarget('A', 'B', { ...all, overviewOpen: false })).toMatchObject({
      type: 'path',
    })
  })

  it('does nothing when no page of the course is open', () => {
    expect(renameFollowTarget('A', 'B', none)).toBeNull()
  })
})
