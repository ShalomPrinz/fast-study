const STORAGE_KEY = 'fastStudyOpenCourse'

// Remembers the course the tree shows open; storage failures are ignored.
export function writeOpenCourse(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // best effort
  }
}

export function readOpenCourse(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

// The course the tree shows open: the first wanted name that exists (a renamed course is wanted under its new
// name, then its old one until the tree catches up), else the first course.
export function resolveOpenCourse<T extends { name: string }>(
  courses: T[],
  ...wanted: (string | null | undefined)[]
): T | undefined {
  for (const w of wanted) {
    const c = w == null ? undefined : courses.find((x) => x.name === w)
    if (c) return c
  }
  return courses[0]
}

export interface WantedCourse {
  name: string | null
  was?: string
}

// Opening the course already wanted keeps its `was`, so a follow-up navigation to a renamed course doesn't lose the fallback.
export function nextWanted(prev: WantedCourse, name: string, was?: string): WantedCourse {
  return { name, was: was ?? (prev.name === name ? prev.was : undefined) }
}

// The first non-empty course name; routeParam yields '' (not undefined) when no route matches, so `??` would stop on it.
export function firstCourseName(...names: (string | null | undefined)[]): string | null {
  return names.find((n) => n) ?? null
}
