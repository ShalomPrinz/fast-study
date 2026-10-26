import { useParams } from 'react-router-dom'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { assignmentDocNotFound, routeMiss } from '@/shared/utils/notFound'
import { routeParam } from '@/shared/utils/routes'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import DocEditor from '@/features/lectures/DocEditor'
import { useAssignmentDocSource } from '@/features/lectures/hooks/useAssignmentDocSource'

// The editor of an assignment's Intuition Guide or Full Solution. See docs/EDITOR.md.
export default function EditAssignmentDocView() {
  const params = useParams<{ course: string; assignment: string; doc: string }>()
  const course = routeParam(params.course)
  const assignment = routeParam(params.assignment)
  const doc = params.doc ?? ''
  const { courses, loaded, loadFailed } = useCourseTreeContext()
  // An unknown `doc` is a miss below; the source only needs a valid name to build from.
  const valid = doc === 'intuition' || doc === 'solution'
  const source = useAssignmentDocSource(course, assignment, valid ? doc : 'intuition')

  if (loaded) {
    const miss = routeMiss(assignmentDocNotFound(courses, course, assignment, doc), loadFailed)
    if (miss) return <NotFoundPanel {...miss} />
  }
  if (!valid) return null
  return <DocEditor source={source} key={source.id} />
}
