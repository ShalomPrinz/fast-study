export interface CourseExpansion {
  expanded: boolean
  recExpanded: boolean
}

// Module scope outlives the tree pane's unmount, so active courses reopen as the user left them.
const saved = new Map<string, CourseExpansion>()

export function savedExpansion(course: string): CourseExpansion | undefined {
  return saved.get(course)
}

export function saveExpansion(course: string, state: CourseExpansion) {
  saved.set(course, state)
}

// A renamed course remounts under its new name, which would otherwise find nothing and open collapsed.
export function moveSavedExpansion(from: string, to: string) {
  const state = saved.get(from)
  if (!state) return
  saved.delete(from)
  saved.set(to, state)
}
