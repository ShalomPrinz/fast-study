import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import LectureItem from './LectureItem'
import PlaceholderLectureItem from './PlaceholderLectureItem'
import { useCourseJobs } from '@/features/downloads/contexts/DownloadJobsContext'
import { placeholderJobs } from '@/features/downloads/utils/placeholders'
import { lectureTrack, recitationTrack } from '@/features/lectures/utils/courseTree'
import { timelineClass, timelineCurrentIndex } from '@/features/lectures/utils/studyProgress'

export default function LectureList() {
  const { course } = useCourseGroup()
  const kind = useLectureListKind()
  // A lectures-only course's lecture list holds its recitations too, each keeping its own kind.
  const items = kind === 'recitation' ? recitationTrack(course) : lectureTrack(course)
  const jobs = useCourseJobs(course.name)
  const pending = placeholderJobs(jobs, course.name, course, kind)

  const count = items.length + pending.length
  const current = timelineCurrentIndex(items)

  return (
    <>
      {items.map((item, i) => (
        <LectureItem
          key={`${item.kind}::${item.name}`}
          lecture={item}
          timeline={timelineClass(i, count, current)}
        />
      ))}
      {pending.map((job, i) => (
        <PlaceholderLectureItem
          key={`${job.kind}::${job.lecture}`}
          job={job}
          timeline={timelineClass(items.length + i, count, current)}
        />
      ))}
    </>
  )
}
