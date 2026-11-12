// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clampedSelectPoint, hasTooltipContent, isOutsidePress, physicalPlacement } from './tooltip'

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

describe('isOutsidePress', () => {
  it('treats a press in the container or in any hint as inside', () => {
    document.body.innerHTML =
      '<div id="menu"><button id="item"></button></div><div class="tooltip"><span id="hint">t</span></div><p id="out"></p>'
    const menu = document.getElementById('menu')
    expect(isOutsidePress(menu, document.getElementById('item'))).toBe(false)
    expect(isOutsidePress(menu, document.getElementById('hint')!.firstChild)).toBe(false)
    expect(isOutsidePress(menu, document.getElementById('out'))).toBe(true)
  })
})

describe('clampedSelectPoint', () => {
  const box = { left: 100, top: 50, right: 200, bottom: 80 }

  it('leaves a pointer inside the box to the browser', () => {
    expect(clampedSelectPoint(box, 150, 60)).toBeNull()
  })

  it('ends at the start above the box and at the end below it, whatever the x', () => {
    expect(clampedSelectPoint(box, 900, 10)).toBe('start')
    expect(clampedSelectPoint(box, 0, 500)).toBe('end')
  })

  it('clamps a pointer beside the box onto the same line inside it', () => {
    expect(clampedSelectPoint(box, 0, 60)).toEqual({ x: 101, y: 60 })
    expect(clampedSelectPoint(box, 900, 70)).toEqual({ x: 199, y: 70 })
  })
})
