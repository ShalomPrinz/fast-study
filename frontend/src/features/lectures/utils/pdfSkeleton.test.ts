import { describe, expect, it } from 'vitest'
import { heroPhase, skeletonHeight } from './pdfSkeleton'

describe('heroPhase', () => {
  it('shows the skeleton until the page renders', () => {
    expect(heroPhase(false, false)).toBe('loading')
    expect(heroPhase(false, true)).toBe('ready')
  })
  it('a failed load wins over everything', () => {
    expect(heroPhase(true, false)).toBe('failed')
    expect(heroPhase(true, true)).toBe('failed')
  })
})

describe('skeletonHeight', () => {
  it('is the Letter page minus the top crop at zoom', () => {
    // x0 = (1 - 1/1.15)/2; the top crop equals x0 of the width.
    const x0 = (1 - 1 / 1.15) / 2
    expect(skeletonHeight(1000, 1.15, null)).toBe(Math.round((11 / 8.5) * 1000 - x0 * 1000))
  })
  it('is capped like the thumbnail', () => {
    expect(skeletonHeight(1000, 1.15, 375)).toBe(375)
    expect(skeletonHeight(1000, 1.15, 5000)).toBe(skeletonHeight(1000, 1.15, null))
  })
  it('is zero before the width is measured', () => {
    expect(skeletonHeight(0, 1.15, 375)).toBe(0)
  })
})
