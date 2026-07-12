import PaginatedList from '@/features/lectures/components/PaginatedList'
import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import LectureItem from './LectureItem'

// The paginated lecture/recitation list for the enclosing LectureListProvider's kind.
export default function LectureList() {
  const { course } = useCourseGroup()
  const kind = useLectureListKind()
  const items = kind === 'recitation' ? (course.recitations ?? []) : course.lectures

  return (
    <PaginatedList
      items={items}
      renderItem={(lecture) => <LectureItem key={`${kind}::${lecture.name}`} lecture={lecture} />}
    />
  )
}
