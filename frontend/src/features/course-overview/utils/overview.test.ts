import { describe, expect, it } from 'vitest'
import { formatRange } from './overview'

const at = '2026-01-01T00:00:00Z'

describe('formatRange', () => {
  it('names both kinds in a split course', () => {
    const entry = { lectures: { start: '2', end: '9' }, recitations: null, generatedAt: at }
    expect(formatRange(entry)).toBe('Lectures 2-9, No Recitations')
  })

  it('shows one lecture span over both ranges in a lectures-only course', () => {
    const entry = {
      lectures: { start: '2', end: '9' },
      recitations: { start: '1', end: '10' },
      generatedAt: at,
    }
    expect(formatRange(entry, true)).toBe('Lectures 1-10')
  })

  it('never says "No Recitations" for meta written before the switch', () => {
    const entry = { lectures: { start: '4', end: '4' }, recitations: null, generatedAt: at }
    expect(formatRange(entry, true)).toBe('Lecture 4')
  })

  it('orders dotted numbers naturally', () => {
    const entry = {
      lectures: { start: '2.2', end: '10' },
      recitations: { start: '2', end: '9.3' },
      generatedAt: at,
    }
    expect(formatRange(entry, true)).toBe('Lectures 2-10')
  })

  it('falls back to "No Lectures" when neither kind has a number', () => {
    expect(formatRange({ lectures: null, recitations: null, generatedAt: at }, true)).toBe(
      'No Lectures',
    )
  })
})
