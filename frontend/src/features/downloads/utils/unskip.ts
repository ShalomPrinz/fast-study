import type { Course } from '@/types'
import { updateSkipped } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'

// Un-skips the refs a download starts, in one write and only those in the course's skip set; a failed write toasts.
export async function unskipForDownload(
  courses: readonly Course[],
  course: string,
  refs: readonly string[],
): Promise<void> {
  const skipped = courses.find((c) => c.name === course)?.skipped
  const remove = refs.filter((ref) => skipped?.includes(ref))
  if (!remove.length) return
  try {
    await updateSkipped(course, { remove })
  } catch (err) {
    toastFailure(err)
  }
}
