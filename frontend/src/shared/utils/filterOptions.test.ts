import { describe, it, expect } from 'vitest'
import { filterOptions } from './filterOptions'

describe('filterOptions', () => {
  const options = ['Algebra', 'Calculus', 'Linear Algebra']

  it('keeps every name until the text is edited', () => {
    expect(filterOptions(options, 'Calculus', false)).toEqual(options)
  })

  it('keeps the options containing the edited text, ignoring case and edge spaces', () => {
    expect(filterOptions(options, ' algebra ', true)).toEqual(['Algebra', 'Linear Algebra'])
    expect(filterOptions(options, '', true)).toEqual(options)
  })
})
