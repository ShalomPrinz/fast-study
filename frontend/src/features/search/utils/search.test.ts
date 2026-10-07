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
  it('is the containing sentence alone, with no ellipsis on either side', () => {
    const doc = lecture('First sentence. Second has target inside. Third sentence.')
    const [hit] = hitsFor([doc], 'target')

    expect(hit.snippet).toBe('Second has target inside.')
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
    const doc = lecture('One. Two   with    target   inside. Three. Four.')
    const [hit] = hitsFor([doc], 'target')

    expect(hit.snippet).toContain('Two with target inside.')
    expect(hit.snippet).not.toMatch(/ {2}|\n/)
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })

  it('never cuts a word, even when the document has no sentence delimiter', () => {
    const filler = 'word '.repeat(200)
    const doc = lecture(`${filler}target ${filler}`)
    const [hit] = hitsFor([doc], 'target')

    expect(doc.content.length).toBeGreaterThan(1000)
    // A delimiter-less document is one sentence, so it renders whole rather than cut mid-word.
    const words = hit.snippet.trim().split(' ')
    expect(words.every((word) => word === 'word' || word === 'target')).toBe(true)
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })

  it('keeps the sentence whole on both sides of a long match', () => {
    const doc = lecture(`One. ${'long '.repeat(60)}target${' long'.repeat(60)}. Three.`)
    const [hit] = hitsFor([doc], 'target')

    expect(hit.snippet.startsWith('long')).toBe(true)
    expect(hit.snippet.endsWith('long.')).toBe(true)
  })

  it('cuts at every kind of delimiter, not only a period', () => {
    for (const delim of ['?', '!', ';', ':', '…']) {
      const doc = lecture(`Before${delim} holds target${delim} after`)
      const [hit] = hitsFor([doc], 'target')

      expect(hit.snippet).toBe(`holds target${delim}`)
    }
  })

  it('cuts at a line break and drops the markdown marker opening the line', () => {
    const doc = lecture('# Heading\n- a bullet with target inside\n## Next')
    const [hit] = hitsFor([doc], 'target')

    expect(hit.snippet).toBe('a bullet with target inside')
  })

  describe('markdown markup', () => {
    const highlighted = (hit: { snippet: string; ranges: { start: number; end: number }[] }) =>
      hit.ranges.map((r) => hit.snippet.slice(r.start, r.end))

    it('drops an ordered-list marker and paired bold, keeping math untouched', () => {
      const doc = lecture('## סיכום\n1. **מיון מיזוג** — $O(n \\log n)$ בכל מקרה\n2. אחר')
      const [hit] = hitsFor([doc], 'מיזוג')

      expect(hit.snippet).toBe('מיון מיזוג — $O(n \\log n)$ בכל מקרה')
      expect(highlighted(hit)).toEqual(['מיזוג'])
    })

    it('drops bold whose opener sits before the sentence delimiter', () => {
      const doc = lecture('- **הגדרה:** מיון יציב שומר על הסדר')
      const [hit] = hitsFor([doc], 'יציב')

      expect(hit.snippet).toBe('מיון יציב שומר על הסדר')
      expect(highlighted(hit)).toEqual(['יציב'])
    })

    it('drops paired __ but keeps it intraword and inside math or code', () => {
      const doc = lecture('> __חשוב__ target in snake__case and $a__b$ and `x__y`')
      const [hit] = hitsFor([doc], 'target')

      expect(hit.snippet).toBe('חשוב target in snake__case and $a__b$ and `x__y`')
      expect(highlighted(hit)).toEqual(['target'])
    })

    it('renders a table row as its cells, not pipes, and keeps a pipe inside math', () => {
      const doc = lecture(
        '| אלגוריתם | זיכרון | זמן |\n|---|:---:|---|\n| חיפוש לינארי | אין | $O(|n|)$ |',
      )
      const [hit] = hitsFor([doc], 'לינארי')

      expect(hit.snippet).toBe('חיפוש לינארי · אין · $O(|n|)$')
      expect(highlighted(hit)).toEqual(['לינארי'])
    })

    it('keeps a whole table row as one window, delimiters in cells included', () => {
      const doc = lecture('| a. **b** target | c: target |')
      const [hit] = hitsFor([doc], 'target')

      expect(hit.snippet).toBe('a. b target · c: target')
      expect(highlighted(hit)).toEqual(['target', 'target'])
    })

    it('finds nothing in a table separator row', () => {
      const doc = lecture('| a | b |\n|---|---|\n| c - d | e |')

      expect(findMatches([doc], '-').map((m) => m.index)).toEqual([
        doc.content.indexOf('c - d') + 2,
      ])
    })

    it('finds text as the snippet displays it', () => {
      const merge = lecture('## סיכום\n1. **מיון מיזוג** — $O(n \\log n)$')
      const table = lecture('| חיפוש לינארי | אין | $O(n)$ |')
      const spaced = lecture('alpha   beta\ngamma')

      expect(hitsFor([merge], 'מיון מיזוג —')).toHaveLength(1)
      expect(highlighted(hitsFor([merge], 'מיון מיזוג —')[0])).toEqual(['מיון מיזוג —'])
      expect(highlighted(hitsFor([table], 'חיפוש לינארי · אין')[0])).toEqual(['חיפוש לינארי · אין'])
      expect(highlighted(hitsFor([spaced], 'alpha  beta')[0])).toEqual(['alpha beta'])
      expect(findMatches([spaced], 'beta gamma')).toHaveLength(1)
    })

    it('no longer finds raw markup that the snippet does not show', () => {
      expect(findMatches([lecture('- **bold** text')], '**bold')).toEqual([])
    })
  })
})

describe('groupMatches', () => {
  it('merges two matches in one sentence into a single snippet with two ranges', () => {
    const doc = lecture('One. Two has target here and target again. Three.')
    const groups = groupMatches(findMatches([doc], 'target'))

    expect(groups).toHaveLength(1)
    expect(groups[0].matches).toHaveLength(2)

    const hit = buildHit(groups[0])
    expect(hit.ranges).toHaveLength(2)
    expect(hit.ranges[0].end).toBeLessThanOrEqual(hit.ranges[1].start)
    for (const range of hit.ranges) expect(hit.snippet.slice(range.start, range.end)).toBe('target')
  })

  it('keeps matches in different sentences in separate groups', () => {
    const doc = lecture('Opening with target here. Closing with target again.')
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

describe('findMatches offset mapping', () => {
  it('maps whole-word matches to raw offsets and skips embedded ones', () => {
    const summary = lecture('cat concat catalog cat')
    const matches = findMatches([summary], 'cat', { wholeWord: true })

    expect(matches.map((m) => [m.index, m.end])).toEqual([
      [0, 3],
      [19, 22],
    ])
  })

  it('maps a match spanning a line break back to the raw span', () => {
    const summary = lecture('foo\nbar baz')
    const [m] = findMatches([summary], 'foo bar')

    expect(summary.content.slice(m.index, m.end)).toBe('foo\nbar')
  })

  it('maps matches after a table separator row to their raw position', () => {
    const summary = lecture('| a | b |\n|---|---|\n| target | c |')
    const [m] = findMatches([summary], 'target')

    expect(summary.content.slice(m.index, m.end)).toBe('target')
    expect(findMatches([summary], '---')).toEqual([])
  })

  it('serves a repeated call from the cache', () => {
    const summary = lecture('alpha beta')
    const first = findMatches([summary], 'alpha')
    summary.content = 'zzzzzzzzzz'

    expect(findMatches([summary], 'alpha')).toEqual(first)
  })
})
