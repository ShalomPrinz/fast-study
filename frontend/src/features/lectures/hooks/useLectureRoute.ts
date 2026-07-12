import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useKindParam } from '@/shared/hooks/useKindParam'
import { findLecture } from '@/features/lectures/utils/courseTree'

export function useLectureRoute() {
  const params = useParams<{ course: string; lecture: string }>()
  const kind = useKindParam()

  const course = params.course ?? ''
  const lecture = params.lecture ?? ''

  const { courses } = useCourseTreeContext()

  const { files, transcribePartial } = useMemo(() => {
    if (!course || !lecture) return { files: null, transcribePartial: null }
    const found = findLecture(courses, course, lecture, kind)
    return {
      files: found?.files ?? null,
      transcribePartial: found?.transcribePartial ?? null,
    }
  }, [courses, course, lecture, kind])

  return { course, lecture, kind, files, transcribePartial }
}
