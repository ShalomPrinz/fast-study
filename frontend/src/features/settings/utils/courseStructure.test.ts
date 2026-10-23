import { describe, it, expect } from 'vitest'
import { checklistState } from './courseStructure'

describe('checklistState', () => {
  it('lists the courses once "specific courses" is the saved mode', () => {
    expect(checklistState('lectures_some', 'lectures_some')).toBe('list')
  })

  it('waits for a save while the flags still follow another mode', () => {
    expect(checklistState('lectures_some', 'split')).toBe('saveFirst')
    expect(checklistState('lectures_some', 'lectures_all')).toBe('saveFirst')
  })

  it('shows nothing under the other choices', () => {
    expect(checklistState('split', 'lectures_some')).toBe('hidden')
    expect(checklistState('lectures_all', 'lectures_all')).toBe('hidden')
  })
})
