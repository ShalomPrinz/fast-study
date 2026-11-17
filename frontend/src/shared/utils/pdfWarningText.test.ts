import { describe, it, expect } from 'vitest'
import { MISSING_CHARS_WARNING, pdfWarningText } from './pdfWarningText'

const TRANSLATED = 'The summary contains invalid characters Gemini wrote'

describe('pdfWarningText', () => {
  it('replaces the marker alone', () => {
    expect(pdfWarningText(MISSING_CHARS_WARNING)).toBe(TRANSLATED)
  })
  it('replaces the marker joined with another warning', () => {
    expect(pdfWarningText(`LaTeX failed; ${MISSING_CHARS_WARNING}`)).toBe(
      `LaTeX failed; ${TRANSLATED}`,
    )
  })
  it('leaves an unrelated warning unchanged', () => {
    expect(pdfWarningText('LaTeX failed')).toBe('LaTeX failed')
  })
})
