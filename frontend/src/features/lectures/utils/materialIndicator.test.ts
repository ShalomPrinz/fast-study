import { describe, it, expect } from 'vitest'
import type { MaterialInfo } from '@/types'
import { materialIndicator } from './materialIndicator'

const material = (
  name: string,
  mtime: number,
  extra: Partial<MaterialInfo> = {},
): MaterialInfo => ({
  name,
  size: 10,
  mtime,
  ...extra,
})
const SUPPORTED = new Set(['pdf', 'png'])
const ind = (
  mats: MaterialInfo[],
  exists: boolean,
  mtime: number | null,
  record: string[] | null = null,
) => materialIndicator(mats, exists, mtime, record, SUPPORTED)

describe('materialIndicator before a summary', () => {
  it('warns when the lecture has no material', () => {
    const { text, cls } = ind([], false, null)!
    expect(text).toBe('no material found')
    expect(cls).toBe('material-indicator--missing')
  })

  it('warns when materials exist but none will be sent', () => {
    const mats = [material('material.pdf', 1, { attach: false }), material('material.2.pptx', 1)]
    const { text, cls } = ind(mats, false, null)!
    expect(text).toBe('no material will be sent')
    expect(cls).toBe('material-indicator--missing')
  })

  it('names the single attached material by its original name', () => {
    const { text, cls } = ind(
      [material('material.pdf', 100, { filename: 'Slides.pdf' })],
      false,
      null,
    )!
    expect(text).toBe('summary with Slides.pdf')
    expect(cls).toBe('material-indicator--will-use')
  })

  it('counts attached materials only', () => {
    const mats = [
      material('material.pdf', 1),
      material('material.2.png', 1),
      material('material.3.pdf', 1, { attach: false }),
    ]
    expect(ind(mats, false, null)!.text).toBe('summary with 2 materials')
  })
})

describe('materialIndicator after a summary, by mtime', () => {
  it('reports all used, none used and partial over attached materials', () => {
    const mats = [material('material.pdf', 100), material('material.2.pdf', 100)]
    expect(ind(mats, true, 200)!.text).toBe('2 materials were used')
    expect(ind([material('material.3.pdf', 100)], true, 200)!.text).toBe('material.3.pdf was used')
    const late = [material('material.pdf', 100), material('material.2.pdf', 300)]
    expect(ind(late, true, 200)!).toEqual({
      text: 'summary used only 1 of 2 materials',
      cls: 'material-indicator--partial',
    })
    const none = ind([material('material.2.pdf', 300)], true, 200)!
    expect(none.cls).toBe('material-indicator--was-missing')
    expect(ind(mats, true, null)!.cls).toBe('material-indicator--was-missing')
  })

  it('shows nothing when no material is attached', () => {
    expect(ind([], true, 200)).toBeNull()
    expect(ind([material('material.pdf', 1, { attach: false })], true, 200)).toBeNull()
  })

  it('ignores a late unattached material', () => {
    const mats = [material('material.pdf', 100), material('material.2.pdf', 900, { attach: false })]
    expect(ind(mats, true, 200)!.cls).toBe('material-indicator--used')
  })
})

describe('materialIndicator with the summarize record', () => {
  const mats = [material('material.pdf', 900)]

  it('reads the same set as used, whatever the mtimes', () => {
    expect(ind(mats, true, 200, ['material.pdf'])!.cls).toBe('material-indicator--used')
  })

  it('warns when the set changed', () => {
    const { text, cls } = ind(mats, true, 200, ['material.pdf', 'material.2.pdf'])!
    expect(cls).toBe('material-indicator--changed')
    expect(text).toBe('Attachments changed since the summary')
    expect(ind(mats, true, 200, [])!.cls).toBe('material-indicator--changed')
    expect(
      ind([material('material.pdf', 1, { attach: false })], true, 200, ['material.pdf'])!.cls,
    ).toBe('material-indicator--changed')
  })

  it('shows nothing for an empty record and nothing attached', () => {
    expect(ind([material('material.pdf', 1, { attach: false })], true, 200, [])).toBeNull()
  })
})
