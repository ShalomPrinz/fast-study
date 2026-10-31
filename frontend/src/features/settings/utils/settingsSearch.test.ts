import { describe, expect, it } from 'vitest'
import { findMatches, stepMatch } from './settingsSearch'

describe('findMatches', () => {
  it('ignores case and finds every non-overlapping hit in a source', () => {
    expect(findMatches([{ text: 'Audio audio AUDIO' }], 'audio')).toEqual([
      { source: 0, start: 0, length: 5 },
      { source: 0, start: 6, length: 5 },
      { source: 0, start: 12, length: 5 },
    ])
    expect(findMatches([{ text: 'aaaa' }], 'aa')).toHaveLength(2)
  })

  it('matches Hebrew as typed', () => {
    const hits = findMatches([{ text: 'אחסון' }, { text: 'הגדרות אחסון ענן' }], 'אחסון')
    expect(hits).toEqual([
      { source: 0, start: 0, length: 5 },
      { source: 1, start: 7, length: 5 },
    ])
  })

  it('counts a select with matching option text once, covering the whole control', () => {
    const select = { text: 'Extract the audio only Run audio again', whole: true }
    expect(findMatches([{ text: 'Other' }, select], 'audio only')).toEqual([
      { source: 1, start: 0, length: select.text.length },
    ])
    expect(findMatches([select], 'audio')).toHaveLength(1)
  })

  it('finds nothing for an empty or blank query, or no hit', () => {
    expect(findMatches([{ text: 'abc' }], '')).toEqual([])
    expect(findMatches([{ text: 'abc' }], '   ')).toEqual([])
    expect(findMatches([{ text: 'abc' }], 'z')).toEqual([])
  })

  it('keeps indices valid when a letter lowercases to a different length', () => {
    const [hit] = findMatches([{ text: 'İx' }], 'x')
    expect(hit).toEqual({ source: 0, start: 1, length: 1 })
  })
})

describe('stepMatch', () => {
  it('wraps at both ends', () => {
    expect(stepMatch(4, 5, 1)).toBe(0)
    expect(stepMatch(0, 5, -1)).toBe(4)
    expect(stepMatch(1, 5, 1)).toBe(2)
    expect(stepMatch(1, 5, -1)).toBe(0)
  })

  it('stays at zero with no matches', () => {
    expect(stepMatch(0, 0, 1)).toBe(0)
    expect(stepMatch(0, 0, -1)).toBe(0)
  })
})
