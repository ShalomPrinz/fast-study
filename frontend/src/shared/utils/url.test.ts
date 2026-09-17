import { describe, it, expect } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import {
  path,
  kindQuery,
  courseRoute,
  lectureRoute,
  lectureBase,
  extractorsQuery,
  overviewGenerateQuery,
} from './url'
import { ROUTES } from './routes'

describe('path', () => {
  it('encodes interpolated values and leaves the literals alone', () => {
    expect(path`/courses/${'אלגברה'}/files/${'a/b?c#d%e'}`).toBe(
      `/courses/${encodeURIComponent('אלגברה')}/files/a%2Fb%3Fc%23d%25e`,
    )
  })
})

describe('kindQuery', () => {
  it('adds a suffix for recitations only', () => {
    expect(kindQuery('recitation')).toBe('?kind=recitation')
    expect(kindQuery('lecture')).toBe('')
    expect(kindQuery(undefined)).toBe('')
  })
})

describe('lecture addresses', () => {
  it('routes the browser by course and lecture, carrying the kind', () => {
    expect(lectureRoute('C', 'L 1', 'recitation')).toBe('/C/L%201?kind=recitation')
    expect(lectureRoute('C', 'L 1', 'lecture')).toBe('/C/L%201')
  })

  it('addresses the API under /courses/…/lectures/… with no kind', () => {
    expect(lectureBase('C', 'L 1')).toBe('/courses/C/lectures/L%201')
  })
})

describe('browser routes', () => {
  // App.tsx's index route is `/`; the rest come from ROUTES (pathless layouts add no segment).
  const routes = [
    { id: 'home', path: '/' },
    ...Object.entries(ROUTES).map(([id, path]) => ({ id, path })),
  ]
  const resolve = (url: string) => {
    const m = matchRoutes(routes, url.split('?')[0])?.at(-1)
    return m && { id: m.route.id, params: m.params }
  }

  it('addresses a course overview in three segments', () => {
    expect(courseRoute('C 1')).toBe('/course/C%201/overview')
  })

  it('keeps every page of a course literally named course reachable', () => {
    expect(resolve(lectureRoute('course', 'Lecture 1', 'lecture'))).toEqual({
      id: 'lecture',
      params: { course: 'course', lecture: 'Lecture 1' },
    })
    expect(resolve(lectureRoute('course', 'Lecture 1', 'lecture') + '/edit')).toEqual({
      id: 'editor',
      params: { course: 'course', lecture: 'Lecture 1' },
    })
    expect(resolve(courseRoute('course'))).toEqual({ id: 'overview', params: { course: 'course' } })
  })

  it('keeps a lecture named overview a lecture', () => {
    expect(resolve(lectureRoute('course', 'overview', 'lecture'))?.id).toBe('lecture')
  })
})

describe('extractorsQuery', () => {
  it('sends nothing for an empty selection', () => {
    expect(extractorsQuery([])).toBe('')
    expect(extractorsQuery(undefined)).toBe('')
  })

  it('joins encoded names with commas', () => {
    expect(extractorsQuery(['a b', 'c,d'])).toBe('?extractors=a%20b,c%2Cd')
  })
})

describe('overviewGenerateQuery', () => {
  it('joins every combination of its three parts with one ? and & between', () => {
    expect(overviewGenerateQuery()).toBe('')
    expect(overviewGenerateQuery(['x'])).toBe('?extractors=x')
    expect(overviewGenerateQuery(undefined, 'topics')).toBe('?from_phase=topics')
    expect(overviewGenerateQuery(undefined, undefined, true)).toBe('?skip_existing=true')
    expect(overviewGenerateQuery(['x'], 'topics')).toBe('?extractors=x&from_phase=topics')
    expect(overviewGenerateQuery(['x'], undefined, true)).toBe('?extractors=x&skip_existing=true')
    expect(overviewGenerateQuery(undefined, 'topics', true)).toBe(
      '?from_phase=topics&skip_existing=true',
    )
    expect(overviewGenerateQuery(['x'], 'topics', true)).toBe(
      '?extractors=x&from_phase=topics&skip_existing=true',
    )
  })
})
