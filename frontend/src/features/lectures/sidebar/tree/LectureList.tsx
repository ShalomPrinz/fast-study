import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import LectureItem from './LectureItem'

export default function LectureList() {
  const { course } = useCourseGroup()
  const kind = useLectureListKind()
  const items = kind === 'recitation' ? (course.recitations ?? []) : course.lectures

  return (
    <>
      {items.map((lecture) => (
        <LectureItem key={`${kind}::${lecture.name}`} lecture={lecture} />
      ))}
    </>
  )
}
