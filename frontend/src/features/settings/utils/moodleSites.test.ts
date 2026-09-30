import { describe, it, expect } from 'vitest'
import { choiceForSite, MOODLE_SITE_PRESETS, OTHER_SITE } from './moodleSites'

describe('choiceForSite', () => {
  it('preselects nothing when no site is stored', () => {
    expect(choiceForSite(null)).toBe('')
  })

  it('opens a stored preset root on its preset', () => {
    expect(choiceForSite('https://lemida.biu.ac.il')).toBe('biu')
    expect(choiceForSite('https://lemida.biu.ac.il/')).toBe('biu')
    expect(choiceForSite('https://moodle.bgu.ac.il/moodle/')).toBe('bgu')
  })

  it('opens any other root on "Other…"', () => {
    expect(choiceForSite('https://x.ac.il/moodle')).toBe(OTHER_SITE)
  })

  it('keeps preset ids unique and clear of the "Other…" value', () => {
    const ids = MOODLE_SITE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(OTHER_SITE)
  })
})
