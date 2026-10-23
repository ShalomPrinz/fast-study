import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import { lectureTrack, lecturesOnly, recitationTrack } from './courseTree'
import { sortLectures } from './lectureSort'

const node = (lectures: string[], recitations: string[], lectures_only: boolean): Course => ({
  name: 'Algebra',
  archived: false,
  source_url: null,
  lectures_only,
  // The tree arrives with each list in `sortLectures` order, as SnapshotProvider hands it out.
  lectures: sortLectures(lectures.map((name) => ({ name }) as Lecture)),
  recitations: sortLectures(recitations.map((name) => ({ name }) as Lecture)),
})

const shown = (c: Course) => lectureTrack(c).map((i) => `${i.kind}:${i.name}`)

describe('lectureTrack', () => {
  it('interleaves by number, a lecture before the recitation of the same number', () => {
    const c = node(['Lecture 2', 'Lecture 1'], ['Recitation 2', 'Recitation 1'], true)
    expect(shown(c)).toEqual([
      'lecture:Lecture 1',
      'recitation:Recitation 1',
      'lecture:Lecture 2',
      'recitation:Recitation 2',
    ])
  })

  it('keeps a lecture and its sub-sessions ahead of the same-numbered recitation', () => {
    const c = node(['Lecture 1.2', 'Lecture 1.1'], ['Recitation 1'], true)
    expect(shown(c)).toEqual([
      'lecture:Lecture 1.1',
      'lecture:Lecture 1.2',
      'recitation:Recitation 1',
    ])
  })

  it('puts unnumbered names after numbered ones, by name', () => {
    const c = node(['Intro', 'Lecture 1'], ['Exam prep', 'Recitation 1'], true)
    expect(shown(c)).toEqual([
      'lecture:Lecture 1',
      'recitation:Recitation 1',
      'recitation:Exam prep',
      'lecture:Intro',
    ])
  })

  it('lists only lectures in a split course, which keeps its recitations apart', () => {
    const c = node(['Lecture 1'], ['Recitation 1'], false)
    expect(shown(c)).toEqual(['lecture:Lecture 1'])
    expect(recitationTrack(c).map((i) => i.name)).toEqual(['Recitation 1'])
  })

  it('leaves a lectures-only course with no recitation list', () => {
    expect(recitationTrack(node(['Lecture 1'], ['Recitation 1'], true))).toEqual([])
  })
})

describe('lecturesOnly', () => {
  it("reads a known course's flag and the new-course default for any other", () => {
    const courses = [node([], [], true)]
    expect(lecturesOnly(courses, 'Algebra', false)).toBe(true)
    expect(lecturesOnly(courses, 'Physics', false)).toBe(false)
    expect(lecturesOnly(courses, 'Physics', true)).toBe(true)
  })
})
