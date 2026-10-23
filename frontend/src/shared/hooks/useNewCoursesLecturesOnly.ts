import { useEffect, useState } from 'react'
import { fetchCourseStructure } from '@/services/database'
import { useNotify } from './useNotify'

// Whether a course the tree lacks yet would be lectures-only: the live mode is `lectures_all`.
// Refetched on every notify, which a mode change broadcasts; a failed read keeps the last answer.
export function useNewCoursesLecturesOnly(): boolean {
  const [all, setAll] = useState(false)
  const load = () => {
    fetchCourseStructure()
      .then((mode) => setAll(mode === 'lectures_all'))
      .catch(() => {})
  }
  useEffect(load, [])
  useNotify(load)
  return all
}
