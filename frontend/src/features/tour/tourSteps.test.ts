import { describe, expect, it } from 'vitest'
import { TOUR_SLIDES } from './tourSteps'

describe('TOUR_SLIDES', () => {
  it('is the three slides in order, each with a unique screenshot id', () => {
    expect(TOUR_SLIDES.map((s) => s.id)).toEqual(['downloads', 'runner', 'lecture'])
  })
})
