// The course the box names: while the edit route is active its `:course` is the source of truth,
// since the URL (a cold open, a Forward) can name a course other than the one last picked.
export function boxCourse(chosen: string, editName: string | null, editExists: boolean): string {
  return editName && editExists ? editName : chosen
}
