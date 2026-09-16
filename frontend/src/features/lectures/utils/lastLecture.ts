import type { Course, Selected } from '@/types'
import { lectureRoute } from '@/shared/utils/url'
import { findLecture } from './courseTree'

const STORAGE_KEY = 'fastStudyLastLecture'

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
