import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Course, Lecture } from '@/types'
import { lastLectureRoute, readLastLecture, writeLastLecture } from './lastLecture'

// A Map-backed stand-in: the helpers only need `getItem`/`setItem`, not a DOM.
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})

const lecture = (name: string) => ({ name }) as Lecture
const courses: Course[] = [
  {
    name: 'אלגברה',
    archived: false,
    source_url: null,
    lectures: [lecture('Lecture 1')],
    recitations: [lecture('Recitation 1')],
  },
]

describe('lastLectureRoute', () => {
  it('routes to a stored lecture the tree still has', () => {
    writeLastLecture({ course: 'אלגברה', lecture: 'Recitation 1', kind: 'recitation' })
    expect(lastLectureRoute(courses, readLastLecture())).toBe(
      `/${encodeURIComponent('אלגברה')}/Recitation%201?kind=recitation`,
    )
  })

  it('falls back home once the stored lecture was renamed away', () => {
    writeLastLecture({ course: 'אלגברה', lecture: 'Lecture 9', kind: 'lecture' })
    expect(lastLectureRoute(courses, readLastLecture())).toBe('/')
  })

  it('falls back home when nothing was stored', () => {
    expect(readLastLecture()).toBeNull()
    expect(lastLectureRoute(courses, null)).toBe('/')
  })
})

describe('readLastLecture', () => {
  it('ignores malformed JSON and wrong shapes', () => {
    localStorage.setItem('fastStudyLastLecture', '{not json')
    expect(readLastLecture()).toBeNull()
    localStorage.setItem('fastStudyLastLecture', '{"course":"a","lecture":"b","kind":"x"}')
    expect(readLastLecture()).toBeNull()
  })
})
