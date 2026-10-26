import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { lectureNotFound, routeMiss } from '@/shared/utils/notFound'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import DocEditor from '@/features/lectures/DocEditor'
import { useLectureRoute } from '@/features/lectures/hooks/useLectureRoute'
import { useLectureDocSource } from '@/features/lectures/hooks/useLectureDocSource'

// The editor of a lecture's or recitation's summary. See docs/EDITOR.md.
export default function EditSummaryView() {
  const { course, lecture, kind } = useLectureRoute()
  const source = useLectureDocSource()
  const { courses, loaded: treeLoaded, loadFailed } = useCourseTreeContext()

  if (!course || !lecture) return null
  if (treeLoaded) {
    const miss = routeMiss(lectureNotFound(courses, course, lecture, kind), loadFailed)
    if (miss) return <NotFoundPanel {...miss} />
  }
  return <DocEditor source={source} />
}
