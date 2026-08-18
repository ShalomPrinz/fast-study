// @vitest-environment jsdom
// The only test in the suite needing a DOM: `activateLocale` writes to <html>, and the direction
// flip is the single point where a wrong locale breaks the whole layout rather than one string.
import { describe, expect, it } from 'vitest'
import { activateLocale } from './i18n'

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
