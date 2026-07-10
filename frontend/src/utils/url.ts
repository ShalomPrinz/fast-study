import type { Kind, CoursePhase } from '@/types'

// Tagged template that percent-encodes every interpolated value while leaving the
// literal segments untouched, so Hebrew course/lecture names stay URL-safe.
// Invariant: never feed `path` output (or `lectureBase`, built from it) back into
// another `path`, or the already-encoded segment gets double-encoded.
//   path`/courses/${'מבוא/א'}`  -> "/courses/%D7%9E%D7%91%D7%95%D7%90%2F%D7%90"
export function path(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) {
    out += encodeURIComponent(String(values[i])) + strings[i + 1]
  }
  return out
}

// The `?kind=recitation` query suffix appended to both browser routes and API paths.
// Lectures carry no suffix, so the default is the empty string.
export function kindQuery(kind: Kind | undefined): string {
  return kind === 'recitation' ? '?kind=recitation' : ''
}

// Browser route: the in-app URL react-router navigates to for a lecture.
//   lectureRoute('ד׳', 'שיעור 1', undefined)  ->  "/%D7%93%D7%B3/..."
export function lectureRoute(course: string, lecture: string, kind: Kind | undefined): string {
  return path`/${course}/${lecture}` + kindQuery(kind)
}

// API path: the database/backend endpoint prefix for a lecture. Note this differs
// from the browser route above — it's `/courses/{course}/lectures/{lecture}`, not
// `/{course}/{lecture}`. Already encoded, so don't pass it back through `path`.
export function lectureBase(course: string, lecture: string): string {
  return path`/courses/${course}/lectures/${lecture}`
}

// Browser route: the in-app URL for course overview.
export function courseRoute(course: string): string {
  return path`/course/${course}`
}

// API path: the overview endpoint prefix shared by the backend and database services.
export function courseOverviewBase(course: string): string {
  return path`/courses/${course}/overview`
}

// `?extractors=a,b` CSV suffix for overview triggers; omitted/empty selects all
// extractors server-side, so the default is the empty string.
export function extractorsQuery(names?: string[]): string {
  return names?.length ? `?extractors=${names.map(encodeURIComponent).join(',')}` : ''
}

// Query for an overview /generate trigger: optional extractor CSV + optional start
// phase + optional skip_existing (continue: generate only missing phase outputs).
export function overviewGenerateQuery(names?: string[], fromPhase?: CoursePhase, skipExisting?: boolean): string {
  let q = extractorsQuery(names)
  if (fromPhase) q += `${q ? '&' : '?'}from_phase=${fromPhase}`
  if (skipExisting) q += `${q ? '&' : '?'}skip_existing=true`
  return q
}
