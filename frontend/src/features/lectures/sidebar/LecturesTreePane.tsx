import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMatch } from 'react-router-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { courseLoadNotice, isCourseTreeLoading } from '@/shared/utils/courseLoadNotice'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { lectureTrack } from '@/features/lectures/utils/courseTree'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import {
  nextWanted,
  readOpenCourse,
  resolveOpenCourse,
  writeOpenCourse,
  type WantedCourse,
  firstCourseName,
} from '@/features/lectures/utils/openCourse'
import { PendingUploadProvider } from './PendingUploadModal'
import NewCourseRow from './NewCourseRow'
import CourseGroup from './tree/CourseGroup'
import '@/styles/sidebar-tree.css'
import '@/styles/spinner.css'
import './LecturesTreePane.css'

// Saved on every scroll rather than on unmount, where the detached nav already reads 0.
let savedScrollTop = 0

export default function LecturesTreePane() {
  return (
    <PendingUploadProvider>
      <LecturesTreePaneBody />
    </PendingUploadProvider>
  )
}

function LecturesTreePaneBody() {
  const { courses, loaded, loadFailed } = useCourseTreeContext()
  const notice = courseLoadNotice(courses, loaded, loadFailed)
  const loading = isCourseTreeLoading(courses, loaded, loadFailed)
  const { t } = useLingui()
  const navRef = useRef<HTMLElement>(null)
  const { selected } = useSelection()
  const overviewMatch = useMatch(ROUTES.overview)
  const assignmentMatch = useMatch(ROUTES.assignment)
  const routeCourse = firstCourseName(
    selected?.course,
    routeParam((overviewMatch ?? assignmentMatch)?.params.course),
  )
  // `was` keeps a renamed course open until the refreshed tree carries its new name; the route wins on first paint.
  const [want, setWant] = useState<WantedCourse>(() => ({
    name: routeCourse ?? readOpenCourse(),
  }))
  const open = resolveOpenCourse(courses, want.name, want.was)
  const others = courses.filter((c) => c !== open)

  function openCourse(name: string, was?: string) {
    setWant((prev) => nextWanted(prev, name, was))
    writeOpenCourse(name)
  }

  // Navigating into another course (search, deep link, Downloads) opens it; swapping by hand never re-runs this.
  useEffect(() => {
    if (routeCourse) openCourse(routeCourse)
  }, [routeCourse])

  useLayoutEffect(() => {
    if (navRef.current) navRef.current.scrollTop = savedScrollTop
  }, [])

  return (
    <aside className="tree-pane">
      <nav
        className={notice || loading ? 'sidebar-nav sidebar-nav--empty' : 'sidebar-nav'}
        ref={navRef}
        onScroll={(e) => {
          savedScrollTop = e.currentTarget.scrollTop
        }}
      >
        {loading ? (
          <div
            className="spinner spinner--sm tree-pane-spinner"
            role="status"
            aria-label={t`Loading courses…`}
          />
        ) : notice === 'failed' ? (
          <p className="tree-pane-empty tree-pane-empty--failed">
            <Trans>Courses failed to load.</Trans>
          </p>
        ) : notice === 'no-courses' ? (
          <p className="tree-pane-empty">
            <Trans>No lectures yet. Add one from Downloads, or add a course manually.</Trans>
          </p>
        ) : (
          <>
            {open && (
              <CourseGroup
                key={open.name}
                course={open}
                onRenamed={(from, to) => {
                  if (from === open.name) openCourse(to, from)
                }}
              />
            )}
            {others.length > 0 && (
              <section className="other-courses">
                <h3 className="other-courses-title">
                  <Trans>Other courses</Trans>
                </h3>
                <ul className="other-courses-list">
                  {others.map((c) => {
                    const { done, total } = trackProgress(lectureTrack(c))
                    return (
                      <li key={c.name}>
                        <button className="other-course" onClick={() => openCourse(c.name)}>
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
              </section>
            )}
          </>
        )}
      </nav>
      <div className="tree-pane-footer">
        <NewCourseRow onCreated={(name) => openCourse(name, open?.name)} />
      </div>
    </aside>
  )
}
