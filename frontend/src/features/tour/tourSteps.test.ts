import { describe, expect, it } from 'vitest'
import rects from '@/assets/tour/rects.json'
import { TOUR_SHOTS, TOUR_STEPS, shotRange, stepOnShot } from './tourSteps'

describe('TOUR_STEPS', () => {
  it('is seven steps with unique ids, each on a known screenshot, grouped in screenshot order', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(7)
    const shots = TOUR_SHOTS.map((s) => s.id)
    expect(TOUR_STEPS.every((s) => shots.includes(s.shot))).toBe(true)
    expect(TOUR_STEPS.map((s) => s.shot)).toEqual([
      'downloads',
      'downloads',
      'downloads',
      'lecture',
      'lecture',
      'lecture',
      'lecture',
    ])
  })

  it('has a captured rect for every step in both languages', () => {
    for (const lang of ['he', 'en'] as const)
      for (const s of TOUR_STEPS) expect(rects[lang]).toHaveProperty(s.id)
  })

  it('keeps a screenshot on its nearest step while another screenshot is active', () => {
    expect(shotRange(TOUR_STEPS, 'lecture')).toEqual([3, 6])
    expect(stepOnShot(TOUR_STEPS, 'downloads', 5)).toBe(2)
    expect(stepOnShot(TOUR_STEPS, 'lecture', 0)).toBe(3)
    expect(stepOnShot(TOUR_STEPS, 'lecture', 4)).toBe(4)
  })
})
