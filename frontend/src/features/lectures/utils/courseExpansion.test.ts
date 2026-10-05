import { describe, it, expect } from 'vitest'
import { moveSavedExpansion, saveExpansion, savedExpansion } from './courseExpansion'

describe('moveSavedExpansion', () => {
  it('carries both expansion flags to the new name and drops the old one', () => {
    saveExpansion('old', { expanded: true, recExpanded: true })
    moveSavedExpansion('old', 'new')
    expect(savedExpansion('new')).toEqual({ expanded: true, recExpanded: true })
    expect(savedExpansion('old')).toBeUndefined()
  })

  it('leaves the target alone when nothing was saved under the old name', () => {
    saveExpansion('kept', { expanded: true, recExpanded: false })
    moveSavedExpansion('never-saved', 'kept')
    expect(savedExpansion('kept')).toEqual({ expanded: true, recExpanded: false })
  })
})
