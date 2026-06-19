import type { Kind } from '@/types'

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
