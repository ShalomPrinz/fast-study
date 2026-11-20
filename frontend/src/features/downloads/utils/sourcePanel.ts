// The course the box names: while the edit route is active its `:course` is the source of truth,
// since the URL (a cold open, a Forward) can name a course other than the one last picked.
export function boxCourse(chosen: string, editName: string | null, editExists: boolean): string {
  return editName && editExists ? editName : chosen
}

// The note above a pick that shows no recordings: why discovery is barred. The Moodle-busy reason is
// dropped over a failure of this course, whose error says it and whose gate cooldown would shift it.
export function loadNoteFor(
  reason: string | null,
  failedHere: boolean,
  disconnected: boolean,
): string | null {
  return failedHere && !disconnected ? null : reason
}
