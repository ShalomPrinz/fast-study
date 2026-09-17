import { matchPath } from 'react-router-dom'
import type { Course, Kind, Selected } from '@/types'
import { lectureRoute } from '@/shared/utils/url'
import { ROUTES } from '@/shared/utils/routes'
import { findLecture } from './courseTree'

const STORAGE_KEY = 'fastStudyLastLecture'

// The lecture a path opens, or null; an overview path also fits the lecture prefix with course "course".
export function lectureToRemember(pathname: string, kind: Kind): Selected | null {
  if (matchPath(ROUTES.overview, pathname)) return null
  const params = matchPath(`${ROUTES.lecture}/*`, pathname)?.params
  if (!params?.course || !params.lecture) return null
  return {
    course: decodeURIComponent(params.course),
    lecture: decodeURIComponent(params.lecture),
    kind,
  }
}

// Remembers the open lecture so the Lectures nav row can reopen it; storage failures are ignored.
export function writeLastLecture(sel: Selected): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sel))
  } catch {
    // best effort
  }
}

// The stored lecture, or null when nothing usable is stored (absent, blocked or malformed).
export function readLastLecture(): Selected | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    const ok =
      typeof v?.course === 'string' &&
      typeof v?.lecture === 'string' &&
      (v?.kind === 'lecture' || v?.kind === 'recitation')
    return ok ? { course: v.course, lecture: v.lecture, kind: v.kind } : null
  } catch {
    return null
  }
}

// Route back to the stored lecture while the tree still has it, else the lectures home.
export function lastLectureRoute(courses: Course[], stored: Selected | null): string {
  if (!stored || !findLecture(courses, stored.course, stored.lecture, stored.kind)) return '/'
  return lectureRoute(stored.course, stored.lecture, stored.kind)
}
