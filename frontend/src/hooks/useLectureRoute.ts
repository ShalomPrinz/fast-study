import { useParams, useOutletContext } from 'react-router-dom'
import type { LectureContext } from '../types'

export function useLectureRoute() {
  const params = useParams<{ course: string; lecture: string }>()
  const { files, transcribePartial, refreshCourses, kind } = useOutletContext<LectureContext>()
  return {
    course: params.course ?? '',
    lecture: params.lecture ?? '',
    kind,
    files,
    transcribePartial,
    refreshCourses,
  }
}
