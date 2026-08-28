import { describe, it, expect } from 'vitest'
import type { MaterialInfo } from '@/types'
import { materialIndicator } from './materialIndicator'

const material = (name: string, mtime: number): MaterialInfo => ({ name, size: 10, mtime })

describe('materialIndicator', () => {
  it('warns when the lecture has no material and no summary yet', () => {
    const { text, cls } = materialIndicator([], false, null)
    expect(text).toBe('no material found')
    expect(cls).toBe('material-indicator--missing')
  })

  it('names the single material a pending summarize will use', () => {
    const { text, cls } = materialIndicator([material('material.pdf', 100)], false, null)
    expect(text).toBe('material.pdf will be used')
    expect(cls).toBe('material-indicator--will-use')
  })

  it('counts several materials instead of naming them', () => {
    const materials = [material('material.pdf', 100), material('material.2.pdf', 120)]
    expect(materialIndicator(materials, false, null).text).toBe('2 materials will be used')
    expect(materialIndicator(materials, true, 200).text).toBe('2 materials were used')
  })

  it('reports a material older than the summary as used', () => {
    const { text, cls } = materialIndicator([material('material.pdf', 100)], true, 200)
    expect(text).toBe('material.pdf was used')
    expect(cls).toBe('material-indicator--used')
  })

  it('keeps the name of a surviving sibling index', () => {
    expect(materialIndicator([material('material.3.pdf', 100)], true, 200).text).toBe(
      'material.3.pdf was used',
    )
  })

  it('counts the used ones when only some predate the summary', () => {
    const materials = [
      material('material.pdf', 100),
      material('material.2.pdf', 300),
      material('material.3.pdf', 400),
    ]
    const { text, cls } = materialIndicator(materials, true, 200)
    expect(text).toBe('summary used only 1 of 3 materials')
    expect(cls).toBe('material-indicator--partial')
  })

  it('reports none used when every material is newer than the summary', () => {
    const materials = [material('material.pdf', 300), material('material.2.pdf', 400)]
    const { text, cls } = materialIndicator(materials, true, 200)
    expect(text).toBe('summary did not use any material')
    expect(cls).toBe('material-indicator--was-missing')
  })

  it('names the one material when it alone is newer than the summary', () => {
    const { text, cls } = materialIndicator([material('material.2.pdf', 300)], true, 200)
    expect(text).toBe('summary did not use material.2.pdf')
    expect(cls).toBe('material-indicator--was-missing')
  })

  it('reports not-used when a summary exists with no material at all', () => {
    const { text, cls } = materialIndicator([], true, 200)
    expect(text).toBe('summary did not use material')
    expect(cls).toBe('material-indicator--was-missing')
  })
})
