import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MISSING_CHARS_WARNING } from './pdfWarningText'

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

// The frontend matches the backend's missing-glyph warning by exact text, so the two must agree.
describe('pdf warning drift', () => {
  it('backend to_pdf.py holds the literal the frontend matches', () => {
    const src = readFileSync(resolve(REPO, 'backend/pipeline/to_pdf.py'), 'utf8')
    expect(src).toContain(`MISSING_CHARS_WARNING = "${MISSING_CHARS_WARNING}"`)
  })
})
