import { describe, it, expect } from 'vitest'
import {
  accountView,
  choiceForSite,
  choosesNoSite,
  MOODLE_SITE_PRESETS,
  OTHER_SITE,
} from './moodleSites'

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

describe('accountView', () => {
  const site = 'https://lemida.biu.ac.il'
  it('offers Connect once the form holds the saved site', () => {
    expect(accountView(site, site)).toBe('connect')
    // A choice still being probed leaves the saved site's account in place.
    expect(accountView(site, null)).toBe('connect')
  })

  it('asks for a university while none is saved', () => {
    expect(accountView(null, '')).toBe('choose')
    expect(accountView(null, null)).toBe('choose')
  })

  it('holds Connect while the form holds an unsaved site', () => {
    expect(accountView(null, site)).toBe('save')
    expect(accountView(site, 'https://moodle.bgu.ac.il/moodle')).toBe('save')
    expect(accountView(site, '')).toBe('save')
  })
})
