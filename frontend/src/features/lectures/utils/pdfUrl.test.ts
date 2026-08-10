import { describe, it, expect } from 'vitest'
import { cacheBustedUrl } from './pdfUrl'

describe('cacheBustedUrl', () => {
  it('appends the mtime as a fresh query string', () => {
    expect(cacheBustedUrl('http://db/file/summary.pdf', 1700)).toBe(
      'http://db/file/summary.pdf?t=1700',
    )
  })

  it('appends to an existing query string', () => {
    expect(cacheBustedUrl('http://db/file?kind=recitation', 1700)).toBe(
      'http://db/file?kind=recitation&t=1700',
    )
  })

  it('leaves the url untouched when the mtime is unknown', () => {
    expect(cacheBustedUrl('http://db/file/summary.pdf', null)).toBe('http://db/file/summary.pdf')
  })

  it('keeps a zero mtime rather than treating it as missing', () => {
    expect(cacheBustedUrl('http://db/file/summary.pdf', 0)).toBe('http://db/file/summary.pdf?t=0')
  })
})
