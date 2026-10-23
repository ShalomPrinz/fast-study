import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import LectureItem from './LectureItem'
import { lectureTrack, recitationTrack } from '@/features/lectures/utils/courseTree'

export default function LectureList() {
  const { course } = useCourseGroup()
  const kind = useLectureListKind()
  // A lectures-only course's lecture list holds its recitations too, each keeping its own kind.
  const items = kind === 'recitation' ? recitationTrack(course) : lectureTrack(course)

  return (
    <>
      {items.map((item) => (
        <LectureItem key={`${item.kind}::${item.name}`} lecture={item} />
      ))}
    </>
  )
}
