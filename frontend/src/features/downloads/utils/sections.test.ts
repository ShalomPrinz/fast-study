import { describe, it, expect } from 'vitest'
import type { Item, Media, ResolvedMedia } from '../services/autoDownloader'
import { groupSections } from './sections'

function item(
  ref: string,
  section: string,
  media: Media = 'video',
  resolvedMedia?: ResolvedMedia,
): Item {
  return { ref, title: ref, kind: 'lecture', media, resolvedMedia, expandable: false, section }
}

const refs = (sections: [string, Item[]][]) =>
  sections.map(([title, items]) => [title, items.map((i) => i.ref)])

describe('groupSections', () => {
  it('keeps only the active media', () => {
    const items = [item('a', 'Week 1'), item('b', 'Week 1', 'material')]
    expect(refs(groupSections(items, 'video'))).toEqual([['Week 1', ['a']]])
    expect(refs(groupSections(items, 'material'))).toEqual([['Week 1', ['b']]])
  })

  it('isolates unknown rows into their own segment', () => {
    const items = [
      item('a', 'Week 1'),
      item('b', 'Week 1', 'material'),
      item('c', 'Week 1', 'unknown'),
    ]
    expect(refs(groupSections(items, 'unknown'))).toEqual([['Week 1', ['c']]])
    expect(refs(groupSections(items, 'video'))).toEqual([['Week 1', ['a']]])
    expect(refs(groupSections(items, 'material'))).toEqual([['Week 1', ['b']]])
  })

  it('keeps a resolved unknown row in the unknown segment', () => {
    const items = [
      item('a', 'Week 1', 'unknown', 'video'),
      item('b', 'Week 1', 'unknown', 'material'),
    ]
    expect(refs(groupSections(items, 'unknown'))).toEqual([['Week 1', ['a', 'b']]])
    expect(groupSections(items, 'video')).toEqual([])
    expect(groupSections(items, 'material')).toEqual([])
  })

  it('drops a section with nothing on the active side', () => {
    const items = [item('a', 'Week 1'), item('b', 'Week 2', 'material')]
    expect(refs(groupSections(items, 'video'))).toEqual([['Week 1', ['a']]])
    expect(refs(groupSections(items, 'material'))).toEqual([['Week 2', ['b']]])
  })

  it('groups by section in first-seen order', () => {
    const items = [item('a', 'Week 2'), item('b', 'Week 1'), item('c', 'Week 2')]
    expect(refs(groupSections(items, 'video'))).toEqual([
      ['Week 2', ['a', 'c']],
      ['Week 1', ['b']],
    ])
  })

  it('files a blank heading under Other', () => {
    expect(refs(groupSections([item('a', '')], 'video'))).toEqual([['Other', ['a']]])
  })

  it('returns nothing when the active side is empty', () => {
    expect(groupSections([item('a', 'Week 1')], 'material')).toEqual([])
    expect(groupSections([], 'video')).toEqual([])
  })
})
