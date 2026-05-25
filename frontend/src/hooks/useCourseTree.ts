import { useState, useEffect, useMemo } from 'react'
import type { Course, LectureDerived, Selected } from '../types'
import { fetchTree, fetchCourse } from '../services/database'
import { findLecture } from '../utils/courseTree'
import { useNotify } from './useNotify'

export function useCourseTree(selected: Selected | null) {
  const [courses, setCourses] = useState<Course[]>([])

  function refreshCourses() {
    return fetchTree().then(setCourses)
  }

  // Refresh courses on mount
  useEffect(() => {
    refreshCourses()
  }, [])

  // Refresh courses when SSE 'notify' events are received
  useNotify(refreshCourses)

  const sortedCourses = useMemo(
    () => courses.map((c) => ({
      ...c,
      lectures: [...c.lectures].sort((a, b) => a.name.localeCompare(b.name)),
      recitations: [...(c.recitations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    })),
    [courses]
  )

  const { files, transcribePartial } = useMemo<LectureDerived>(() => {
    if (!selected) return { files: null, transcribePartial: null }
    const lecture = findLecture(courses, selected.course, selected.lecture, selected.kind)
    return {
      files: lecture?.files ?? null,
      transcribePartial: lecture?.transcribePartial ?? null,
    }
  }, [courses, selected])

  function handleCourseClick(courseName: string) {
    fetchCourse(courseName).then((updated) => {
      if (!updated) return
      setCourses((prev) => prev.map((c) => (c.name === courseName ? updated : c)))
    })
  }

  return { courses: sortedCourses, files, transcribePartial, refreshCourses, onCourseClick: handleCourseClick }
}
