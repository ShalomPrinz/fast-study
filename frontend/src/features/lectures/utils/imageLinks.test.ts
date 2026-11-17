import { describe, it, expect } from 'vitest'
import { figureSuggestions, missingImageLinks, scanImageLinks } from './imageLinks'

describe('scanImageLinks', () => {
  it('spans the target only, stopping at a title or the paren', () => {
    const text = '![a](figures/fig1.pdf "t") and ![b](x.png)'
    expect(scanImageLinks(text).map((l) => text.slice(l.from, l.to))).toEqual([
      'figures/fig1.pdf',
      'x.png',
    ])
  })

  it('ignores plain links', () => {
    expect(scanImageLinks('[a](figures/fig1.pdf)')).toEqual([])
  })
})

describe('missingImageLinks', () => {
  const figures = ['fig1.pdf', 'fig2.png']

  it('keeps links that are not an exact listed figure', () => {
    const text = [
      '![a](figures/fig1.pdf)',
      '![b](figures/nope.png)',
      '![c](https://x.com/a.png)',
      '![d](/abs/fig1.pdf)',
      '![e](fig1.pdf)',
    ].join('\n')
    expect(missingImageLinks(text, figures).map((l) => l.src)).toEqual([
      'figures/nope.png',
      'https://x.com/a.png',
      '/abs/fig1.pdf',
      'fig1.pdf',
    ])
  })

  it('flags nothing when the list failed to load', () => {
    expect(missingImageLinks('![a](nope.png)', null)).toEqual([])
  })

  it('flags every link against an empty list', () => {
    expect(missingImageLinks('![a](figures/fig1.pdf)', [])).toHaveLength(1)
  })
})

describe('literal text and target forms', () => {
  const figures = ['fig1.pdf', 'a b.png']

  it('skips links in fences, inline code and math', () => {
    const text = [
      '```',
      '![a](nope.png)',
      '```',
      'use `![b](nope.png)` here',
      '$![c](nope.png)$',
      '$$',
      '![d](nope.png)',
      '$$',
      '![e](nope.png)',
    ].join('\n')
    expect(missingImageLinks(text, figures).map((l) => l.src)).toEqual(['nope.png'])
  })

  it('accepts angle-bracket and ./ targets that name a listed figure', () => {
    const text = [
      '![a](<figures/fig1.pdf>)',
      '![b](./figures/fig1.pdf)',
      '![c](<figures/a b.png>)',
      '![d](<figures/nope.png>)',
      '![e](<./figures/nope.png>)',
    ].join('\n')
    expect(missingImageLinks(text, figures).map((l) => l.src)).toEqual([
      '<figures/nope.png>',
      '<./figures/nope.png>',
    ])
  })
})

describe('figureSuggestions', () => {
  const figures = ['fig1.pdf', 'fig2.png']

  it('offers figures/<name> from the start of the typed target', () => {
    const prefix = 'text ![x](fig'
    const s = figureSuggestions(prefix, 10, figures)
    expect(s?.from).toBe(10 + prefix.length - 3)
    expect(s?.options).toEqual(['figures/fig1.pdf', 'figures/fig2.png'])
  })

  it('offers on an empty target', () => {
    expect(figureSuggestions('![x](', 0, figures)?.from).toBe(5)
  })

  it('is silent outside a target, after it closes, and without a list', () => {
    expect(figureSuggestions('![x]', 0, figures)).toBeNull()
    expect(figureSuggestions('![x](figures/fig1.pdf)', 0, figures)).toBeNull()
    expect(figureSuggestions('[x](fig', 0, figures)).toBeNull()
    expect(figureSuggestions('![x](', 0, null)).toBeNull()
    expect(figureSuggestions('![x](', 0, [])).toBeNull()
  })
})
