import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import type { Course } from '@/types'
import { lectureTrack } from '@/features/lectures/utils/courseTree'
import { readMoreOpen, writeMoreOpen } from '@/features/lectures/utils/openCourse'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import './MoreCourses.css'

// The bar sits above the footer; open, it shares the pane with the main tree and its panel scrolls alone.
export default function MoreCourses({
  others,
  onOpen,
}: {
  others: Course[]
  onOpen: (name: string) => void
}) {
  const [open, setOpen] = useState(readMoreOpen)
  const count = others.length

  function toggle() {
    writeMoreOpen(!open)
    setOpen(!open)
  }

  return (
    <>
      <button className="more-courses-bar" aria-expanded={open} onClick={toggle}>
        <span className={`course-chevron${open ? '' : ' course-chevron--closed'}`}>
          <Icon icon="chevron-down" />
        </span>
        <span>
          <Trans>More courses ({count})</Trans>
        </span>
      </button>
      {open && (
        <nav className="sidebar-nav more-courses-panel">
          <ul className="other-courses-list">
            {others.map((c) => {
              const { done, total } = trackProgress(lectureTrack(c))
              return (
                <li key={c.name}>
                  <button className="other-course" onClick={() => onOpen(c.name)}>
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
        </nav>
      )}
    </>
  )
}
