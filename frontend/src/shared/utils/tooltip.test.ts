import { describe, expect, it } from 'vitest'
import { hasTooltipContent, physicalPlacement } from './tooltip'

describe('hasTooltipContent', () => {
  it('shows nothing for an absent, false or blank hint', () => {
    for (const c of [undefined, null, false, '', '   ']) expect(hasTooltipContent(c)).toBe(false)
  })

  it('shows a non-blank string or a number', () => {
    expect(hasTooltipContent('Open PDF')).toBe(true)
    expect(hasTooltipContent(0)).toBe(true)
  })
})

describe('physicalPlacement', () => {
  it('keeps top and bottom in both directions', () => {
    expect(physicalPlacement('top', true)).toBe('top')
    expect(physicalPlacement('bottom', false)).toBe('bottom')
  })

  it('maps the logical sides to the physical ones per direction', () => {
    expect(physicalPlacement('inline-end', false)).toBe('right')
    expect(physicalPlacement('inline-end', true)).toBe('left')
    expect(physicalPlacement('inline-start', false)).toBe('left')
    expect(physicalPlacement('inline-start', true)).toBe('right')
  })
})
