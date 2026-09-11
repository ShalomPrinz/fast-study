// @vitest-environment jsdom
// The only test in the suite needing a DOM: `activateLocale` writes to <html>, and the direction
// flip is the single point where a wrong locale breaks the whole layout rather than one string.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activateLocale, chooseLocale, initialLocale, resolveLocale } from './i18n'

beforeEach(() => {
  localStorage.clear()
})

// Only `locale` is read when resolving the initial language, so the rest of the bridge is irrelevant.
function setBridgeLocale(locale: string): void {
  window.faststudy = { locale } as unknown as Window['faststudy']
}

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

// The packaged app takes its language from the OS, which reaches the renderer as `app.getLocale()`
// on the preload bridge. jsdom's `navigator.language` is `en-US`, so a Hebrew bridge locale
// resolving to `he` is the whole proof that the bridge outranks the browser.
describe('the OS locale off the bridge', () => {
  afterEach(() => {
    delete window.faststudy
  })

  it('decides the language when the profile has no pick', () => {
    setBridgeLocale('he-IL')
    expect(initialLocale()).toBe('he')

    setBridgeLocale('en-GB')
    expect(initialLocale()).toBe('en')
  })

  it('still loses to a stored pick', async () => {
    setBridgeLocale('he-IL')
    await chooseLocale('en')

    expect(initialLocale()).toBe('en')
  })
})
