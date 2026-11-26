const STORAGE_KEY = 'fastStudyOpenCourse'
const VIEW_KEY = 'fastStudyCoursesView'

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

// Whether the pane lists every course instead of showing the open one; the course view on first run or when storage fails.
export function readCoursesView(): boolean {
  try {
    return localStorage.getItem(VIEW_KEY) === 'courses'
  } catch {
    return false
  }
}

export function writeCoursesView(courses: boolean): void {
  try {
    localStorage.setItem(VIEW_KEY, courses ? 'courses' : 'course')
  } catch {
    // best effort
  }
}

// A course named by the route shows its tree on entry whatever view was saved; the user can still open the list by hand there.
export function showsCoursesView(routeCourse: string | null, saved: boolean): boolean {
  return routeCourse ? false : saved
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

// The tree's scroll offset for the open course: the saved one only if it was saved for this same course, else the top.
export function treeScrollTop(saved: { course: string; top: number }, openName: string): number {
  return saved.course === openName ? saved.top : 0
}

// The name a scroll save is tagged with: a renamed course still open under its old name keeps the new tag the rename already moved the saved one to; a new course (saved tag not moved) never takes it.
export function scrollTag(openName: string, want: WantedCourse, saved: { course: string }): string {
  return want.was === openName && want.name && saved.course === want.name ? want.name : openName
}

// Focus targets after a hand view switch, best first: the current row then the back button in the list, the header button in the tree.
export function viewFocusSelectors(toCourses: boolean): string[] {
  return toCourses
    ? ['.other-course[aria-current]', '.course-toggle--head']
    : ['.course-toggle--head']
}
