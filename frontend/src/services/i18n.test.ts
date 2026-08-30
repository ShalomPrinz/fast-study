// @vitest-environment jsdom
// The only test in the suite needing a DOM: `activateLocale` writes to <html>, and the direction
// flip is the single point where a wrong locale breaks the whole layout rather than one string.
import { beforeEach, describe, expect, it } from 'vitest'
import { activateLocale, chooseLocale, initialLocale, resolveLocale } from './i18n'

beforeEach(() => {
  localStorage.clear()
})

describe('activateLocale', () => {
  it('points the document at the active locale and its direction', async () => {
    await activateLocale('he')
    expect(document.documentElement.lang).toBe('he')
    expect(document.documentElement.dir).toBe('rtl')

    await activateLocale('en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
  })
})

// The language is a per-browser preference and reaches no service, so `localStorage` is the only
// thing standing between a pick and the next boot.
describe('the stored language', () => {
  it('is what a pick leaves behind, and what the next boot reads', async () => {
    await chooseLocale('en')

    expect(localStorage.getItem('fast-study:locale')).toBe('en')
    expect(initialLocale()).toBe('en')
  })

  it('falls back to the browser once the profile has no pick', () => {
    expect(initialLocale()).toBe(resolveLocale(null, navigator.language))
  })
})
