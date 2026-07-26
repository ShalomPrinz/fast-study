import { describe, expect, it } from 'vitest'
import { buildHit, findMatches, groupMatches } from '@/features/search/utils/search'
import type { CourseSummary } from '@/types'

const lecture = (content: string, name = 'Lecture 1'): CourseSummary => ({
  name,
  kind: 'lecture',
  content,
})
const recitation = (content: string, name = 'Recitation 1'): CourseSummary => ({
  name,
  kind: 'recitation',
  content,
})

// The kind filter lives in SearchView, not in the matcher — replicated here to test that boundary.
const inScope = (summaries: CourseSummary[], lectures: boolean, recitations: boolean) =>
  summaries.filter((s) => (s.kind === 'lecture' ? lectures : recitations))

const hitsFor = (summaries: CourseSummary[], query: string, wholeWord = false) =>
  groupMatches(findMatches(summaries, query, { wholeWord })).map(buildHit)

describe('findMatches', () => {
  it('returns every occurrence in a summary, not just the first', () => {
    const summary = lecture('alpha beta alpha gamma alpha')
    const matches = findMatches([summary], 'alpha')

    expect(matches).toHaveLength(3)
    expect(matches.map((m) => m.index)).toEqual([0, 11, 23])
    expect(matches.every((m) => summary.content.slice(m.index, m.end) === 'alpha')).toBe(true)
  })

  it('is case-insensitive and keeps a reference to the matched summary', () => {
    const summary = lecture('Alpha and ALPHA')
    const matches = findMatches([summary], 'alpha')

    expect(matches).toHaveLength(2)
    expect(matches.every((m) => m.summary === summary)).toBe(true)
  })

  it('ignores an empty or whitespace-only query', () => {
    const summaries = [lecture('alpha beta')]

    expect(findMatches(summaries, '')).toEqual([])
    expect(findMatches(summaries, '   \n\t ')).toEqual([])
    expect(findMatches(summaries, '  ', { wholeWord: true })).toEqual([])
  })

  it('trims the query before matching', () => {
    expect(findMatches([lecture('alpha beta')], '  beta ')).toHaveLength(1)
  })

  describe('whole word, Hebrew', () => {
    const doc = lecture('הוא קרא ספר אתמול. יש כאן מספרים רבים.')

    it('matches a Hebrew term inside a longer word when off', () => {
      expect(findMatches([doc], 'ספר')).toHaveLength(2)
    })

    it('rejects a Hebrew term that is only a substring of a longer word when on', () => {
      const matches = findMatches([doc], 'ספר', { wholeWord: true })

      expect(matches).toHaveLength(1)
      expect(matches[0].index).toBe(doc.content.indexOf('ספר'))
    })

    it('still matches when the neighbours are Hebrew punctuation or line breaks', () => {
      const doc = lecture('הכותרת ״ספר״ מופיעה.\nספר׳ בקיצור.\nספר בסוף.')

      expect(findMatches([doc], 'ספר', { wholeWord: true })).toHaveLength(3)
    })
  })

  describe('whole word, Latin term in Hebrew text', () => {
    const doc = lecture('המודל GPT הוא מודל שפה. יש גם GPT4 וגם GPTX כאן.')

    it('matches inside longer tokens when off', () => {
      expect(findMatches([doc], 'gpt')).toHaveLength(3)
    })

    it('keeps only the standalone token when on', () => {
      const matches = findMatches([doc], 'gpt', { wholeWord: true })

      expect(matches).toHaveLength(1)
      expect(matches[0].index).toBe(doc.content.indexOf('GPT'))
    })
  })

  describe('regex metacharacters', () => {
    it('matches a query with parentheses literally', () => {
      const doc = lecture('Given f(x) = 1, compute f(x) twice.')

      expect(() => findMatches([doc], 'f(x)')).not.toThrow()
      expect(findMatches([doc], 'f(x)')).toHaveLength(2)
    })

    it('treats "." as a literal, not a wildcard', () => {
      const doc = lecture('Given a.b and axb.')
      const matches = findMatches([doc], 'a.b')

      expect(matches).toHaveLength(1)
      expect(matches[0].index).toBe(doc.content.indexOf('a.b'))
    })

    it('does not throw on an unbalanced metacharacter', () => {
      expect(() => findMatches([lecture('a [b] c')], '[b')).not.toThrow()
      expect(findMatches([lecture('a [b] c')], '[b')).toHaveLength(1)
    })
  })

  describe('kind filtering at the view boundary', () => {
    const summaries = [lecture('alpha in a lecture'), recitation('alpha in a recitation')]

    it('searches both kinds when both are included', () => {
      expect(findMatches(inScope(summaries, true, true), 'alpha')).toHaveLength(2)
    })

    it('searches lectures only', () => {
      const matches = findMatches(inScope(summaries, true, false), 'alpha')

      expect(matches).toHaveLength(1)
      expect(matches[0].summary.kind).toBe('lecture')
    })

    it('searches recitations only', () => {
      const matches = findMatches(inScope(summaries, false, true), 'alpha')

      expect(matches).toHaveLength(1)
      expect(matches[0].summary.kind).toBe('recitation')
    })

    it('yields no hits when both kinds are excluded', () => {
      expect(hitsFor(inScope(summaries, false, false), 'alpha')).toEqual([])
    })
  })
})

describe('buildHit', () => {
  it('omits the leading ellipsis when the match is in the first sentence', () => {
    const doc = lecture('Target opens here. Second sentence. Third sentence. Fourth sentence.')
    const [hit] = hitsFor([doc], 'Target')

    expect(hit.snippet.startsWith('…')).toBe(false)
    expect(hit.snippet.startsWith('Target opens here.')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
  })

  it('omits the trailing ellipsis when the match is in the last sentence', () => {
    const doc = lecture('First sentence. Second sentence. Third one ends with target.')
    const [hit] = hitsFor([doc], 'target')

    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(false)
    expect(hit.snippet.endsWith('ends with target.')).toBe(true)
  })

  it('reports ranges as offsets into the snippet, not the document', () => {
    const doc = lecture('First sentence. Second sentence. Third one ends with target.')
    const [hit] = hitsFor([doc], 'target')

    // The window starts past the document head, so the two offset spaces genuinely differ.
    expect(hit.ranges).toHaveLength(1)
    expect(hit.ranges[0].start).not.toBe(doc.content.indexOf('target'))
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })

  it('collapses whitespace runs inside the window', () => {
    const doc = lecture('One. Two   with\n\n  target   inside. Three. Four.')
    const [hit] = hitsFor([doc], 'target')

    expect(hit.snippet).toContain('Two with target inside.')
    expect(hit.snippet).not.toMatch(/ {2}|\n/)
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })

  it('clamps the snippet when the document has no sentence terminator', () => {
    const filler = 'word '.repeat(200)
    const doc = lecture(`${filler}target ${filler}`)
    const [hit] = hitsFor([doc], 'target')

    expect(doc.content.length).toBeGreaterThan(1000)
    // MAX_BEFORE (140) + needle + MAX_AFTER (200), plus an ellipsis at each end.
    expect(hit.snippet.length).toBeLessThanOrEqual(140 + 'target'.length + 200 + 2)
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })
})

describe('groupMatches', () => {
  it('merges two nearby matches into one snippet with two ranges', () => {
    const doc = lecture('One. Two has target here. Three. Four has target again. Five.')
    const groups = groupMatches(findMatches([doc], 'target'))

    expect(groups).toHaveLength(1)
    expect(groups[0].matches).toHaveLength(2)

    const hit = buildHit(groups[0])
    expect(hit.ranges).toHaveLength(2)
    expect(hit.ranges[0].end).toBeLessThanOrEqual(hit.ranges[1].start)
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })

  it('keeps far-apart matches in separate groups', () => {
    const filler = 'A filler sentence with nothing of interest at all. '.repeat(12)
    const doc = lecture(`Opening with target here. ${filler}Closing with target again.`)
    const groups = groupMatches(findMatches([doc], 'target'))

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.matches.length)).toEqual([1, 1])
    expect(groups[0].to).toBeLessThan(groups[1].from)
  })

  it('never groups matches across summaries', () => {
    const summaries = [lecture('target', 'A'), lecture('target', 'B')]
    const groups = groupMatches(findMatches(summaries, 'target'))

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.summary.name)).toEqual(['A', 'B'])
  })

  it('returns nothing for no matches', () => {
    expect(groupMatches([])).toEqual([])
  })
})
