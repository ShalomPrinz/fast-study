import { describe, it, expect, afterEach } from 'vitest'
import { i18n } from '@lingui/core'
import { messages as en } from '@/locales/en/messages.po'
import { messages as he } from '@/locales/he/messages.po'
import type { Item, Media, ResolvedMedia } from '../services/autoDownloader'
import { OTHER_SECTION, groupSections, parseSectionId, sectionId, sectionTitle } from './sections'

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
