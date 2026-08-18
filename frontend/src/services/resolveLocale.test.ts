import { describe, expect, it } from 'vitest'
import { resolveLocale } from './i18n'

describe('resolveLocale', () => {
  it('honours a stored choice over the browser', () => {
    expect(resolveLocale('en', 'he-IL')).toBe('en')
    expect(resolveLocale('he', 'en-US')).toBe('he')
  })

  it('ignores a stored value that is not a locale we ship', () => {
    expect(resolveLocale('fr', 'en-GB')).toBe('en')
    expect(resolveLocale('', 'en-GB')).toBe('en')
  })

  it('falls back to the browser language with no stored choice', () => {
    expect(resolveLocale(null, 'en-US')).toBe('en')
    expect(resolveLocale(null, 'EN')).toBe('en')
    expect(resolveLocale(null, 'he-IL')).toBe('he')
  })

  it('defaults to Hebrew for any other language, and for no answer at all', () => {
    expect(resolveLocale(null, 'fr-FR')).toBe('he')
    expect(resolveLocale(null, undefined)).toBe('he')
    expect(resolveLocale(null, '')).toBe('he')
  })
})

describe('Hebrew plural categories', () => {
  // Asserted against CLDR rather than a fixed list: Hebrew's set has been revised across versions,
  // and the catalog only has to cover whatever this runtime actually selects.
  it('are what the Hebrew catalog has to cover', () => {
    const categories = new Intl.PluralRules('he').resolvedOptions().pluralCategories
    expect(categories).toContain('one')
    expect(categories).toContain('other')
    // Every category must be one Lingui/ICU knows, or a plural form would silently never match.
    const icu = ['zero', 'one', 'two', 'few', 'many', 'other']
    expect(categories.every((c) => icu.includes(c))).toBe(true)
  })

  it('select distinct forms for the counts the UI shows', () => {
    const rules = new Intl.PluralRules('he')
    // 1 is never 'other' in Hebrew, so a catalog that only fills 'other' would read wrong for it.
    expect(rules.select(1)).toBe('one')
    expect(rules.select(10)).toBe('other')
  })
})
