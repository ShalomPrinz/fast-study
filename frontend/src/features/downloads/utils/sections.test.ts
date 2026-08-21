import { describe, it, expect, afterEach } from 'vitest'
import { i18n } from '@lingui/core'
import { messages as en } from '@/locales/en/messages.po'
import { messages as he } from '@/locales/he/messages.po'
import type { Item, Media, ResolvedMedia } from '../services/autoDownloader'
import type { Section } from './sections'
import {
  OTHER_SECTION,
  OTHER_VIDEOS_SECTION,
  groupSections,
  parseSectionId,
  sectionId,
  sectionTitle,
} from './sections'

function item(
  ref: string,
  section: string,
  media: Media = 'video',
  resolvedMedia?: ResolvedMedia,
): Item {
  return { ref, title: ref, kind: 'lecture', media, resolvedMedia, expandable: false, section }
}

// A row the keyword hint says is not a lecture recording.
function stray(ref: string, section: string, media: Media = 'video'): Item {
  return { ...item(ref, section, media), likelyRecording: false }
}

const refs = (sections: Section[]) => sections.map((s) => [s.title, s.items.map((i) => i.ref)])

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

describe('the Other Videos bucket', () => {
  it('pulls a non-recording video out of its heading, last', () => {
    const items = [stray('x', 'Week 1'), item('a', 'Week 1'), item('b', 'Week 2')]
    expect(refs(groupSections(items, 'video'))).toEqual([
      ['Week 1', ['a']],
      ['Week 2', ['b']],
      [OTHER_VIDEOS_SECTION, ['x']],
    ])
  })

  it('is absent when every video is a likely recording', () => {
    const sections = groupSections([item('a', 'Week 1')], 'video')
    expect(sections.every((s) => !s.synthetic)).toBe(true)
  })

  it('only marks the bucket synthetic', () => {
    const sections = groupSections([item('a', 'Week 1'), stray('x', 'Week 1')], 'video')
    expect(sections.map((s) => s.synthetic)).toEqual([false, true])
  })

  it('leaves the other segments grouped by heading', () => {
    const items = [stray('x', 'Week 1', 'material'), stray('y', 'Week 1', 'unknown')]
    expect(refs(groupSections(items, 'material'))).toEqual([['Week 1', ['x']]])
    expect(refs(groupSections(items, 'unknown'))).toEqual([['Week 1', ['y']]])
  })

  it('keeps a real heading spelled the same as its own section', () => {
    const items = [item('a', OTHER_VIDEOS_SECTION), stray('x', 'Week 1')]
    const sections = groupSections(items, 'video')
    expect(refs(sections)).toEqual([
      [OTHER_VIDEOS_SECTION, ['a']],
      [OTHER_VIDEOS_SECTION, ['x']],
    ])
    expect(sections.map((s) => s.synthetic)).toEqual([false, true])
  })
})

describe('parseSectionId', () => {
  it('round-trips what sectionId builds', () => {
    expect(parseSectionId(sectionId('Algebra', 'video', 'Week 1'))).toEqual({
      course: 'Algebra',
      media: 'video',
      title: 'Week 1',
    })
  })

  it('keeps colons in the title', () => {
    expect(parseSectionId(sectionId('Algebra', 'material', 'Week 1: intro: part 2'))).toEqual({
      course: 'Algebra',
      media: 'material',
      title: 'Week 1: intro: part 2',
    })
  })

  it('handles every media', () => {
    for (const media of ['video', 'material', 'unknown'] as Media[])
      expect(parseSectionId(sectionId('C', media, 'S'))?.media).toBe(media)
  })

  it('rejects an unknown media segment', () => {
    expect(parseSectionId('Algebra:audio:Week 1')).toBeNull()
  })

  it('rejects ids missing a part', () => {
    expect(parseSectionId('Algebra:video')).toBeNull()
    expect(parseSectionId('Algebra')).toBeNull()
    expect(parseSectionId('')).toBeNull()
    expect(parseSectionId(':video:Week 1')).toBeNull()
    expect(parseSectionId('Algebra:video:')).toBeNull()
  })
})

describe('sectionTitle', () => {
  afterEach(() => i18n.loadAndActivate({ locale: 'en', messages: en }))

  it('passes a real heading through untouched', () => {
    expect(sectionTitle('Week 1')).toBe('Week 1')
    i18n.loadAndActivate({ locale: 'he', messages: he })
    expect(sectionTitle('Week 1')).toBe('Week 1')
  })

  it('translates the Other sentinel', () => {
    i18n.loadAndActivate({ locale: 'he', messages: he })
    expect(sectionTitle(OTHER_SECTION)).toBe('אחר')
  })

  it('leaves the run key locale-independent', () => {
    const id = sectionId('Algebra', 'video', OTHER_SECTION)
    i18n.loadAndActivate({ locale: 'he', messages: he })
    expect(sectionId('Algebra', 'video', OTHER_SECTION)).toBe(id)
    expect(parseSectionId(id)?.title).toBe('Other')
  })
})
