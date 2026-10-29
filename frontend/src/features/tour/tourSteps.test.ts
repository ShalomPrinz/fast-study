import { describe, expect, it } from 'vitest'
import type { Course, FileStatus, Lecture } from '@/types'
import { TOUR_STEPS, tourRoutePath } from './tourSteps'

const files = (have: string[]) =>
  new Proxy({} as FileStatus, {
    get: (_t, name: string) => ({ exists: have.includes(name), size: null, mtime: null }),
  })
const lecture = (name: string, have: string[]): Lecture =>
  ({ name, files: files(have), materials: [] }) as unknown as Lecture
const course = (name: string, lectures: Lecture[], recitations: Lecture[] = []): Course =>
  ({ name, lectures, recitations }) as unknown as Course

describe('tourRoutePath', () => {
  it('passes a fixed route or the current screen through', () => {
    expect(tourRoutePath('/search', [], false)).toBe('/search')
    expect(tourRoutePath(null, [], false)).toBeNull()
  })
  it('has no lecture to open for a new user, so the step shows its card', () => {
    expect(tourRoutePath('lecture-pdf', [], false)).toBeNull()
    expect(
      tourRoutePath('lecture-editor', [course('c', [lecture('l', ['video.mp4'])])], false),
    ).toBeNull()
  })
  it('opens the first lecture with a PDF, and the first with a summary for the editor', () => {
    const cs = [
      course('מבוא', [lecture('a', ['summary.md']), lecture('b', ['summary.md', 'summary.pdf'])]),
    ]
    expect(tourRoutePath('lecture-pdf', cs, false)).toBe('/%D7%9E%D7%91%D7%95%D7%90/b')
    expect(tourRoutePath('lecture-editor', cs, false)).toBe('/%D7%9E%D7%91%D7%95%D7%90/a/edit')
  })
  it('keeps a recitation as such in the query', () => {
    const cs = [course('c', [], [lecture('r', ['summary.pdf'])])]
    expect(tourRoutePath('lecture-pdf', cs, false)).toBe('/c/r?kind=recitation')
  })
})

describe('tourRoutePath with Drive on', () => {
  it('skips a PDF lecture that is not uploaded, so the step shows its card', () => {
    const cs = [course('c', [lecture('a', ['summary.pdf'])])]
    expect(tourRoutePath('lecture-pdf', cs, true)).toBeNull()
  })
  it('picks the first uploaded lecture, the one whose page renders the anchor', () => {
    const cs = [
      course('c', [lecture('a', ['summary.pdf']), lecture('b', ['summary.pdf', 'drive_url.txt'])]),
    ]
    expect(tourRoutePath('lecture-pdf', cs, true)).toBe('/c/b')
  })
})

describe('TOUR_STEPS', () => {
  it('lists the seven steps in order with unique ids and anchors', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'sidebar',
      'downloads',
      'runner',
      'lecture',
      'editor',
      'search',
      'drive',
    ])
    expect(new Set(TOUR_STEPS.map((s) => s.anchor)).size).toBe(TOUR_STEPS.length)
  })
})
