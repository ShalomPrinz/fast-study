import { describe, it, expect } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import { courseRoute, lectureRoute } from './url'
import { ROUTES, routeParam } from './routes'

const routes = [{ path: ROUTES.overview }, { path: ROUTES.lecture }, { path: ROUTES.editor }]

// What a route component reads for `url`: React Router's own match, then `routeParam`.
function paramsOf(url: string) {
  const [pathname, search = ''] = url.split('?')
  const match = matchRoutes(routes, { pathname, search })?.[0]
  return { course: routeParam(match?.params.course), lecture: routeParam(match?.params.lecture) }
}

const NAMES = ['שיעור 1', 'הנחה 50% ab %2F', '%41 and %2f', 'a # b', '100%', 'Recitations']

describe('routeParam', () => {
  it.each(NAMES)('round-trips the lecture and editor routes for %s', (name) => {
    expect(paramsOf(lectureRoute('קורס %2F', name, 'lecture'))).toEqual({
      course: 'קורס %2F',
      lecture: name,
    })
    expect(paramsOf(lectureRoute('c', name, 'recitation'))).toEqual({ course: 'c', lecture: name })
    const editor = lectureRoute('c', name, 'recitation').replace('?', '/edit?')
    expect(paramsOf(editor)).toEqual({ course: 'c', lecture: name })
  })

  it.each(NAMES)('round-trips the overview route for %s', (name) => {
    expect(paramsOf(courseRoute(name)).course).toBe(name)
  })
})
