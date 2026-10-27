import { describe, it, expect } from 'vitest'
import type { MaterialInfo } from '@/types'
import {
  FALLBACK_SUPPORTED,
  MAX_GEMINI_FILE_BYTES,
  attachmentsChanged,
  displayName,
  extensionOf,
  materialAttached,
  materialSupported,
  materialTooLarge,
} from './materials'

const m = (name: string, extra: Partial<MaterialInfo> = {}): MaterialInfo => ({
  name,
  size: 10,
  mtime: 1,
  ...extra,
})
const SUPPORTED = new Set(['pdf', 'png'])

describe('extensionOf', () => {
  it('lower-cases the last extension', () => {
    expect(extensionOf('material.2.PNG')).toBe('png')
    expect(extensionOf('material')).toBe('')
  })
})

describe('displayName', () => {
  it('prefers the original name and falls back to the disk name', () => {
    expect(displayName(m('material.pdf', { filename: 'Lecture3.pdf' }))).toBe('Lecture3.pdf')
    expect(displayName(m('material.pdf'))).toBe('material.pdf')
  })
})

describe('materialSupported', () => {
  it('checks the extension against the set', () => {
    expect(materialSupported(m('material.png'), SUPPORTED)).toBe(true)
    expect(materialSupported(m('material.pptx'), SUPPORTED)).toBe(false)
  })
  it('treats everything as supported before the set loads', () => {
    expect(materialSupported(m('material.pptx'), null)).toBe(true)
  })
  it('keeps only pdf in the failure fallback', () => {
    expect(materialSupported(m('material.png'), FALLBACK_SUPPORTED)).toBe(false)
    expect(materialSupported(m('material.pdf'), FALLBACK_SUPPORTED)).toBe(true)
  })
})

describe('materialAttached', () => {
  it('attaches a supported material unless the user switched it off', () => {
    expect(materialAttached(m('material.pdf'), SUPPORTED)).toBe(true)
    expect(materialAttached(m('material.pdf', { attach: true }), SUPPORTED)).toBe(true)
    expect(materialAttached(m('material.pdf', { attach: false }), SUPPORTED)).toBe(false)
  })
  it('never attaches an unsupported type, even when switched on', () => {
    expect(materialAttached(m('material.pptx', { attach: true }), SUPPORTED)).toBe(false)
  })
})

describe('materialTooLarge', () => {
  it('exempts Office files, which are capped by extracted text', () => {
    const all = new Set(['pdf', 'docx', 'pptx', 'xlsx'])
    const size = MAX_GEMINI_FILE_BYTES + 1
    for (const n of ['material.docx', 'material.PPTX', 'material.xlsx'])
      expect(materialTooLarge(m(n, { size }), all)).toBe(false)
    expect(materialTooLarge(m('material.pdf', { size }), all)).toBe(true)
  })

  it('flags only an attached material over the limit', () => {
    const big = { size: MAX_GEMINI_FILE_BYTES + 1 }
    expect(materialTooLarge(m('material.pdf', big), SUPPORTED)).toBe(true)
    expect(materialTooLarge(m('material.pdf', { size: MAX_GEMINI_FILE_BYTES }), SUPPORTED)).toBe(
      false,
    )
    expect(materialTooLarge(m('material.pdf', { ...big, attach: false }), SUPPORTED)).toBe(false)
    expect(materialTooLarge(m('material.pptx', big), SUPPORTED)).toBe(false)
  })
})

describe('attachmentsChanged', () => {
  const mats = [m('material.pdf'), m('material.2.png')]
  it('is false for the same set in any order', () => {
    expect(attachmentsChanged(['material.2.png', 'material.pdf'], mats, SUPPORTED)).toBe(false)
  })
  it('sees a toggle flip', () => {
    const flipped = [m('material.pdf'), m('material.2.png', { attach: false })]
    expect(attachmentsChanged(['material.pdf', 'material.2.png'], flipped, SUPPORTED)).toBe(true)
  })
  it('sees a new download and a delete', () => {
    expect(attachmentsChanged(['material.pdf'], mats, SUPPORTED)).toBe(true)
    expect(
      attachmentsChanged(['material.pdf', 'material.2.png'], [m('material.pdf')], SUPPORTED),
    ).toBe(true)
  })
  it('ignores an unsupported material', () => {
    expect(
      attachmentsChanged(['material.pdf'], [...mats.slice(0, 1), m('material.3.pptx')], SUPPORTED),
    ).toBe(false)
  })

  it('never reports a change while the support read is pending or fell back', () => {
    expect(attachmentsChanged([], mats, null)).toBe(false)
    expect(attachmentsChanged([], mats, FALLBACK_SUPPORTED)).toBe(false)
  })
})
