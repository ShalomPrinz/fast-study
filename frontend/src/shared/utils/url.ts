import type { Kind, CoursePhase } from '@/types'

// Percent-encodes every interpolated value, literals untouched (Hebrew names stay URL-safe).
// Invariant: never re-feed its output (or `lectureBase`) into another `path` — that double-encodes.
export function path(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) {
    out += encodeURIComponent(String(values[i])) + strings[i + 1]
  }
  return out
}

// `?kind=recitation` suffix for routes and API paths alike; lectures carry none.
export function kindQuery(kind: Kind | undefined): string {
  return kind === 'recitation' ? '?kind=recitation' : ''
}

// /run/{step} query: the kind plus `fresh`, which has the backend delete the step's output under the lecture lock.
export function runStepQuery(kind: Kind | undefined, fresh?: boolean): string {
  const q = kindQuery(kind)
  return fresh ? `${q}${q ? '&' : '?'}fresh=true` : q
}

// Browser route for a lecture — note it differs from the API path below.
export function lectureRoute(course: string, lecture: string, kind: Kind | undefined): string {
  return path`/${course}/${lecture}` + kindQuery(kind)
}

// API path for a lecture: `/courses/{c}/lectures/{l}`. Already encoded — don't re-`path` it.
export function lectureBase(course: string, lecture: string): string {
  return path`/courses/${course}/lectures/${lecture}`
}

// Browser route for an assignment; four segments, so no lecture or overview URL can reach it.
export function assignmentRoute(course: string, assignment: string): string {
  return path`/course/${course}/assignment/${assignment}`
}

// API path for an assignment: `/courses/{c}/assignments/{a}`. Already encoded — don't re-`path` it.
export function assignmentBase(course: string, assignment: string): string {
  return path`/courses/${course}/assignments/${assignment}`
}

// Browser route for a course overview; three segments so no `/:course/:lecture` URL can reach it.
export function courseRoute(course: string): string {
  return path`/course/${course}/overview`
}

// Overview prefix, shared by the backend and database services.
export function courseOverviewBase(course: string): string {
  return path`/courses/${course}/overview`
}

// `?extractors=a,b`; empty selects all extractors server-side.
export function extractorsQuery(names?: string[]): string {
  return names?.length ? `?extractors=${names.map(encodeURIComponent).join(',')}` : ''
}

// /generate query: extractor CSV + start phase + skip_existing (continue, never overwrite).
export function overviewGenerateQuery(
  names?: string[],
  fromPhase?: CoursePhase,
  skipExisting?: boolean,
): string {
  let q = extractorsQuery(names)
  if (fromPhase) q += `${q ? '&' : '?'}from_phase=${fromPhase}`
  if (skipExisting) q += `${q ? '&' : '?'}skip_existing=true`
  return q
}
