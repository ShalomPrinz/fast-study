import { useState, useEffect, useMemo } from 'react'
import type { Course, FileStatus, Selected } from '../types'
import { fetchTree, fetchCourse, databaseUrl } from '../services/database'
import { findLecture } from '../utils/courseTree'

export function useCourseTree(selected: Selected | null) {
  const [courses, setCourses] = useState<Course[]>([])

  function refreshCourses() {
    return fetchTree().then(setCourses)
  }

  useEffect(() => {
    refreshCourses()
  }, [])

  useEffect(() => {
    const es = new EventSource(`${databaseUrl}/events`)
    const onNotify = () => { refreshCourses() }
    es.addEventListener('notify', onNotify)
    return () => {
      es.removeEventListener('notify', onNotify)
      es.close()
    }
  }, [])

  const sortedCourses = useMemo(
    () => courses.map((c) => ({
      ...c,
      lectures: [...c.lectures].sort((a, b) => a.name.localeCompare(b.name)),
      recitations: [...(c.recitations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    })),
    [courses]
  )

  const files = useMemo<FileStatus | null>(() => {
    if (!selected) return null
    const lecture = findLecture(courses, selected.course, selected.lecture, selected.kind)
    return lecture?.files ?? null
  }, [courses, selected])

  const transcribePartial = useMemo(() => {
    if (!selected) return null
    const lecture = findLecture(courses, selected.course, selected.lecture, selected.kind)
    return lecture?.transcribePartial ?? null
  }, [courses, selected])

  function handleCourseClick(courseName: string) {
    fetchCourse(courseName).then((updated) => {
      if (!updated) return
      setCourses((prev) => prev.map((c) => (c.name === courseName ? updated : c)))
    })
  }

  return { courses: sortedCourses, files, transcribePartial, refreshCourses, onCourseClick: handleCourseClick }
}
