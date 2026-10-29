import { describe, it, expect } from 'vitest'
import type { Course } from '@/types'
import type { Item } from '../services/autoDownloader'
import {
  buildNewView,
  courseSubmitGated,
  checkedRefs,
  entryCount,
  recognisedByRef,
  anyRecognised,
  sectionCheck,
  selectableRefs,
  showsSkipBanner,
  skippableRefs,
  toggleSection,
} from './newView'

function item(ref: string, section: string, over: Partial<Item> = {}): Item {
  return {
    ref,
    title: ref,
    kind: 'lecture',
    media: 'video',
    expandable: false,
    section,
    likelyRecording: true,
    moodle: true,
    ...over,
  } as Item
}

const none = () => false
const base = {
  skipped: new Set<string>(),
  isDone: none,
  engaged: none,
  childrenOf: () => null,
}

describe('buildNewView', () => {
  const items = [
    item('m1', 'W1', { media: 'material' }),
    item('v1', 'W2'),
    item('v2', 'W1'),
    item('a1', 'W1', { media: 'assignment' }),
    item('u1', 'W1', { media: 'unknown' }),
  ]

  it('orders media videos, materials, assignments, unknown and keeps Moodle order inside', () => {
    const groups = buildNewView(items, base)
    expect(groups.map((g) => g.media)).toEqual(['video', 'material', 'assignment', 'unknown'])
    expect(groups[0].sections.map((s) => s.title)).toEqual(['W2', 'W1'])
  })

  it('hides skipped and downloaded rows, and groups and sections left empty', () => {
    const groups = buildNewView(items, {
      ...base,
      skipped: new Set(['m1']),
      isDone: (i) => i.ref === 'v1',
    })
    expect(groups.map((g) => g.media)).toEqual(['video', 'assignment', 'unknown'])
    expect(groups[0].sections.map((s) => s.title)).toEqual(['W1'])
  })

  it('keeps a downloaded row that a run or download still holds', () => {
    const groups = buildNewView(items, {
      ...base,
      isDone: () => true,
      engaged: (r) => r === 'v1',
    })
    expect(selectableRefs(groups)).toEqual(['v1'])
  })

  it('lists a playlist as a header, then its unskipped, undone children in its section', () => {
    const playlist = item('p', 'W1', { expandable: true })
    const kids = [item('c1', 'W9'), item('c2', 'W9'), item('c3', 'W9')]
    const input = {
      ...base,
      skipped: new Set(['c2']),
      isDone: (i: Item) => i.ref === 'c3',
      childrenOf: (r: string) => (r === 'p' ? kids : null),
    }
    const [group] = buildNewView([playlist], input)
    expect(group.sections).toHaveLength(1)
    expect(group.sections[0].title).toBe('W1')
    expect(group.sections[0].entries.map((e) => [e.item.ref, e.playlist])).toEqual([
      ['p', true],
      ['c1', false],
    ])
    expect(selectableRefs([group])).toEqual(['c1'])
  })

  it('shows an unexpanded playlist with no selectable row, and drops a skipped one', () => {
    const playlist = item('p', 'W1', { expandable: true })
    const groups = buildNewView([playlist], base)
    expect(selectableRefs(groups)).toEqual([])
    expect(entryCount(groups[0].sections[0].entries, () => null)).toBe(1)
    expect(buildNewView([playlist], { ...base, skipped: new Set(['p']) })).toEqual([])
  })
})

describe('selection', () => {
  const refs = ['a', 'b', 'c']
  const free = () => false

  it('starts with every row checked', () => {
    expect(checkedRefs(refs, new Set(), free)).toEqual(refs)
  })

  it('leaves out unchecked and engaged rows', () => {
    expect(checkedRefs(refs, new Set(['a']), (r) => r === 'c')).toEqual(['b'])
  })

  it('reads a section box as all, some or none of its free rows', () => {
    expect(sectionCheck(refs, new Set(), free)).toBe('all')
    expect(sectionCheck(refs, new Set(['a']), free)).toBe('some')
    expect(sectionCheck(refs, new Set(refs), free)).toBe('none')
    expect(sectionCheck(refs, new Set(['a']), (r) => r !== 'a')).toBe('none')
  })

  it('select-all unchecks a fully checked section and checks a partial one', () => {
    expect([...toggleSection(refs, new Set(), free)].sort()).toEqual(refs)
    expect([...toggleSection(refs, new Set(['a']), free)]).toEqual([])
  })

  it('never touches an engaged row', () => {
    const next = toggleSection(refs, new Set(), (r) => r === 'c')
    expect([...next].sort()).toEqual(['a', 'b'])
  })
})

describe('recognisedByRef and the first-load banner', () => {
  const course = (over: Partial<Course>): Course[] => [
    {
      name: 'Algebra',
      archived: false,
      source_url: null,
      lectures_only: false,
      lectures: [],
      recitations: [],
      assignments: [],
      skipped: [],
      ...over,
    },
  ]
  const lecture = (extra: object) =>
    ({ name: 'L1', materials: [], files: {}, ...extra }) as unknown as Course['lectures'][number]

  it('recognises each media by its own stored source', () => {
    const courses = course({
      lectures: [lecture({ videoSource: 'v' }), lecture({ materials: [{ source: 'm' }] })],
      assignments: [{ name: 'A', files: [{ source: 'a' }] }] as unknown as Course['assignments'],
    })
    expect(recognisedByRef({ ref: 'v', media: 'video' }, courses, 'Algebra')).toBe(true)
    expect(recognisedByRef({ ref: 'm', media: 'material' }, courses, 'Algebra')).toBe(true)
    expect(recognisedByRef({ ref: 'a', media: 'assignment' }, courses, 'Algebra')).toBe(true)
    expect(recognisedByRef({ ref: 'x', media: 'video' }, courses, 'Algebra')).toBe(false)
    expect(recognisedByRef({ ref: 'v', media: 'unknown' }, courses, 'Algebra')).toBe(false)
    expect(anyRecognised([item('v', 'W')], courses, 'Algebra')).toBe(true)
  })

  it('shows only for a fresh course with something to skip, until dismissed', () => {
    const fresh = { skipped: [], recognised: false, newCount: 3, dismissed: false }
    expect(showsSkipBanner(fresh)).toBe(true)
    expect(showsSkipBanner({ ...fresh, skipped: ['x'] })).toBe(false)
    expect(showsSkipBanner({ ...fresh, recognised: true })).toBe(false)
    expect(showsSkipBanner({ ...fresh, newCount: 0 })).toBe(false)
    expect(showsSkipBanner({ ...fresh, dismissed: true })).toBe(false)
  })

  it('Skip all covers every entry, playlists included, minus engaged rows', () => {
    const groups = buildNewView([item('a', 'W'), item('p', 'W', { expandable: true })], base)
    expect(skippableRefs(groups, none)).toEqual(['a', 'p'])
    expect(skippableRefs(groups, (r) => r === 'a')).toEqual(['p'])
  })
})

describe('courseSubmitGated', () => {
  const base = { hasMoodleRow: true, locked: true, appending: false }
  it('holds a Moodle submit while another holder has the lock', () => {
    expect(courseSubmitGated(base)).toBe(true)
  })
  it('never holds a submit appended to this course run', () => {
    expect(courseSubmitGated({ ...base, appending: true })).toBe(false)
  })
  it('does not hold a submit with no Moodle row or a free lock', () => {
    expect(courseSubmitGated({ ...base, hasMoodleRow: false })).toBe(false)
    expect(courseSubmitGated({ ...base, locked: false })).toBe(false)
  })
})
