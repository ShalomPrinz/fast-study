import { describe, it, expect } from 'vitest'
import { moveSavedExpansion, saveExpansion, savedExpansion } from './courseExpansion'

describe('moveSavedExpansion', () => {
  it('carries the expansion flags to the new name and drops the old one', () => {
    saveExpansion('old', { recExpanded: true, assignExpanded: true })
    moveSavedExpansion('old', 'new')
    expect(savedExpansion('new')).toEqual({ recExpanded: true, assignExpanded: true })
    expect(savedExpansion('old')).toBeUndefined()
  })

  it('leaves the target alone when nothing was saved under the old name', () => {
    saveExpansion('kept', { recExpanded: false })
    moveSavedExpansion('never-saved', 'kept')
    expect(savedExpansion('kept')).toEqual({ recExpanded: false })
  })
})
