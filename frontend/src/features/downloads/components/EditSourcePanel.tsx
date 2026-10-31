import type { Course } from '@/types'
import { setCourseSourceUrl } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { sourceChangeAction } from '@/features/downloads/utils/sourceChange'
import { useDownloadsActions } from '@/features/downloads/contexts/DownloadsSessionContext'
import CoursePicker from './CoursePicker'

interface Props {
  course: Course
  // Whether the course's recordings are open or loading, so a cleared URL closes them.
  loaded: boolean
  loading: boolean
  // Loads the course from its new URL, as picking it would (deferred while discovery is barred).
  onLoad: (course: Course) => void
  onDone: () => void
}

// Edits the picked course's source URL: the course picker with the saved URL selected and marked current.
// A Moodle pick is saved as is; a pasted one arrives already checked or saved anyway.
export default function EditSourcePanel({ course, loaded, loading, onLoad, onDone }: Props) {
  const { refreshCourses } = useCourseTreeContext()
  const { close } = useDownloadsActions()

  async function save(url: string) {
    const oldUrl = course.source_url ?? ''
    onDone()
    if (url === oldUrl) return
    await setCourseSourceUrl(course.name, url)
    const action = sourceChangeAction(loaded, loading, oldUrl, url)
    // A cleared course is refreshed before closing, so the box sees it has no source and keeps it.
    if (action === 'close') {
      await refreshCourses()
      close()
      return
    }
    if (action === 'reload') onLoad({ ...course, source_url: url })
    await refreshCourses()
  }

  return (
    <CoursePicker
      resetKey={course.name}
      currentUrl={course.source_url ?? ''}
      onChoose={(c) => void save(c.url)}
      onPaste={(url) => void save(url)}
      onCancel={onDone}
    />
  )
}
