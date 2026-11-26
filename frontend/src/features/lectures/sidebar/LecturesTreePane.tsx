import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMatch } from 'react-router-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { courseLoadNotice, isCourseTreeLoading } from '@/shared/utils/courseLoadNotice'
import { ROUTES, routeParam } from '@/shared/utils/routes'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import {
  nextWanted,
  readCoursesView,
  readOpenCourse,
  resolveOpenCourse,
  showsCoursesView,
  writeCoursesView,
  writeOpenCourse,
  type WantedCourse,
  firstCourseName,
  scrollTag,
  treeScrollTop,
  viewFocusSelectors,
} from '@/features/lectures/utils/openCourse'
import { PendingUploadProvider } from './PendingUploadModal'
import NewCourseRow from './NewCourseRow'
import CourseList from './CourseList'
import CourseGroup from './tree/CourseGroup'
import '@/styles/sidebar-tree.css'
import '@/styles/spinner.css'
import './LecturesTreePane.css'

// Saved on every scroll rather than on unmount, where the detached nav already reads 0; tagged with its course.
let savedScroll = { course: '', top: 0 }

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
  const mergedMatch = useMatch(ROUTES.merged)
  const mergedNewMatch = useMatch(ROUTES.mergedNew)
  const routeCourse = firstCourseName(
    selected?.course,
    routeParam((overviewMatch ?? assignmentMatch ?? mergedMatch ?? mergedNewMatch)?.params.course),
  )
  // `was` keeps a renamed course open until the refreshed tree carries its new name; the route wins on first paint.
  const [want, setWant] = useState<WantedCourse>(() => ({
    name: routeCourse ?? readOpenCourse(),
  }))
  const open = resolveOpenCourse(courses, want.name, want.was)
  // Set by a hand switch so the new view takes focus; a route-forced one leaves it alone.
  const focusAfterSwitch = useRef<'list' | 'tree' | null>(null)
  const [coursesView, setCoursesView] = useState(() =>
    showsCoursesView(routeCourse, readCoursesView()),
  )

  // Only a hand switch is remembered; a route-forced course view must not overwrite the saved choice.
  function switchView(toCourses: boolean) {
    if (toCourses !== coursesView) focusAfterSwitch.current = toCourses ? 'list' : 'tree'
    setCoursesView(toCourses)
    writeCoursesView(toCourses)
  }

  function openCourse(name: string, was?: string) {
    setWant((prev) => nextWanted(prev, name, was))
    writeOpenCourse(name)
  }

  // Navigating into another course (search, deep link, Downloads) opens it; swapping by hand never re-runs this.
  useEffect(() => {
    if (!routeCourse) return
    openCourse(routeCourse)
    setCoursesView(false)
  }, [routeCourse])

  // The courses list starts at the top; the tree comes back where it was left, unless a different course opened.
  const openName = open?.name
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    nav.scrollTop = coursesView || !openName ? 0 : treeScrollTop(savedScroll, openName)
    const pending = focusAfterSwitch.current
    focusAfterSwitch.current = null
    if (pending) {
      for (const sel of viewFocusSelectors(pending === 'list')) {
        const el = nav.querySelector<HTMLElement>(sel)
        if (el) {
          el.focus()
          break
        }
      }
    }
  }, [coursesView, openName])

  return (
    <aside className="tree-pane">
      <nav
        className={notice || loading ? 'sidebar-nav sidebar-nav--empty' : 'sidebar-nav'}
        ref={navRef}
        onScroll={(e) => {
          if (!coursesView && openName) {
            savedScroll = {
              course: scrollTag(openName, want, savedScroll),
              top: e.currentTarget.scrollTop,
            }
          }
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
          open &&
          (coursesView ? (
            <CourseList
              courses={courses}
              openName={open.name}
              onOpen={(name) => {
                openCourse(name)
                switchView(false)
              }}
              onBack={() => switchView(false)}
            />
          ) : (
            <CourseGroup
              key={open.name}
              course={open}
              onRenamed={(from, to) => {
                if (from !== open.name) return
                if (savedScroll.course === from) savedScroll = { ...savedScroll, course: to }
                openCourse(to, from)
              }}
              onSwitch={() => switchView(true)}
            />
          ))
        )}
      </nav>
      <div className="tree-pane-footer">
        <NewCourseRow
          onCreated={(name) => {
            openCourse(name, open?.name)
            switchView(false)
          }}
        />
      </div>
    </aside>
  )
}
