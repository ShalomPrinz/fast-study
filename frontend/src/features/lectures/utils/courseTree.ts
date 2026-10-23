import type { Course, Lecture, Kind } from '@/types'
import { compareMerged } from './lectureSort'

export function findLecture(
  courses: Course[],
  courseName: string,
  lectureName: string,
  kind: Kind,
): Lecture | null {
  const course = courses.find((c) => c.name === courseName)
  const list = kind === 'recitation' ? course?.recitations : course?.lectures
  return list?.find((l) => l.name === lectureName) ?? null
}

// A listed item with the kind it really has on disk, which every route and request keeps.
export type TrackItem = Lecture & { kind: Kind }

const withKind = (items: Lecture[], kind: Kind): TrackItem[] => items.map((l) => ({ ...l, kind }))

// The lecture list as shown: a lectures-only course merges its recitations in, in `compareMerged` order.
export function lectureTrack(
  course: Pick<Course, 'lectures' | 'recitations' | 'lectures_only'>,
): TrackItem[] {
  const lectures = withKind(course.lectures, 'lecture')
  if (!course.lectures_only) return lectures
  return [...lectures, ...withKind(course.recitations ?? [], 'recitation')].sort(compareMerged)
}

// The separate recitation list; a lectures-only course has none.
export function recitationTrack(
  course: Pick<Course, 'recitations' | 'lectures_only'>,
): TrackItem[] {
  return course.lectures_only ? [] : withKind(course.recitations ?? [], 'recitation')
}

// Whether new items in `course` are always lectures: the tree's flag for a course it has, else
// whether the live mode makes every course lectures-only (a course the request will create).
export function lecturesOnly(courses: Course[], course: string, newCourses: boolean): boolean {
  return courses.find((c) => c.name === course)?.lectures_only ?? newCourses
}

// The kind an item named `name` takes in a lectures-only course: a lecture, unless the name is an
// existing recitation's — nothing moves, so that one stays a recitation.
export function lecturesOnlyKind(courses: Course[], course: string, name: string): Kind {
  const node = courses.find((c) => c.name === course)
  const isRecitation =
    node?.recitations.some((r) => r.name === name) && !node.lectures.some((l) => l.name === name)
  return isRecitation ? 'recitation' : 'lecture'
}
