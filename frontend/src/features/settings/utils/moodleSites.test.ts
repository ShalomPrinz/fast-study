import { describe, it, expect } from 'vitest'
import { choiceForSite, choosesNoSite, MOODLE_SITE_PRESETS, OTHER_SITE } from './moodleSites'

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

describe('choosesNoSite', () => {
  it('reads the placeholder as no university', () => {
    expect(choosesNoSite('', '')).toBe(true)
  })

  it('reads "Other…" as no university until an address is typed', () => {
    expect(choosesNoSite(OTHER_SITE, '')).toBe(true)
    expect(choosesNoSite(OTHER_SITE, '   ')).toBe(true)
    expect(choosesNoSite(OTHER_SITE, 'https://x.ac.il')).toBe(false)
  })

  it('never reads a preset as no university', () => {
    expect(choosesNoSite('biu', '')).toBe(false)
  })
})
