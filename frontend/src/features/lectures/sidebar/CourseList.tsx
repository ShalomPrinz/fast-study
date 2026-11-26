import { Trans, useLingui } from '@lingui/react/macro'
import type { Course } from '@/types'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import { lectureTrack } from '@/features/lectures/utils/courseTree'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import '@/styles/sidebar-tree.css'
import './tree/CourseHeader.css'
import './CourseList.css'

// The pane's courses view: a frozen "All courses" header (its back arrow returns to the open course), then every course
// with its done/total count, the open one highlighted.
export default function CourseList({
  courses,
  openName,
  onOpen,
  onBack,
}: {
  courses: Course[]
  openName: string | undefined
  onOpen: (name: string) => void
  onBack: () => void
}) {
  const { t } = useLingui()
  const back = openName ? t`Back to ${openName}` : t`Back`
  return (
    <>
      <div className="pane-sticky-head">
        <div className="course-header">
          <Tooltip content={back} placement="inline-end">
            <button className="course-toggle course-toggle--head" onClick={onBack}>
              <span className="course-head-title">
                <span className="course-switch-icon course-switch-icon--back">
                  <Icon icon="arrow-start" />
                </span>
                <Trans>All courses</Trans>
              </span>
              <span className="tree-visually-hidden">{back}</span>
            </button>
          </Tooltip>
        </div>
      </div>
      <ul className="other-courses-list">
        {courses.map((c) => {
          const { done, total } = trackProgress(lectureTrack(c))
          const current = c.name === openName
          return (
            <li key={c.name}>
              <button
                className={current ? 'other-course current-course' : 'other-course'}
                aria-current={current || undefined}
                onClick={() => onOpen(c.name)}
              >
                <span className="course-name" dir="auto">
                  {c.name}
                </span>
                {total > 0 && (
                  <span className="course-count">
                    {done}/{total}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
