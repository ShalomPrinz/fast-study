import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Link, useLocation } from 'react-router-dom'
import type { AppMode } from '@/types'
import Icon from '@/shared/components/Icon'
import type { IconName } from '@/shared/components/Icon'
import { useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import CoursesList from '@/features/course-overview/CoursesList'
import LecturesSidebar from '@/features/lectures/sidebar/LecturesSidebar'
import NewCourseRow from '@/features/lectures/sidebar/NewCourseRow'
import LanguageSwitcher from './LanguageSwitcher'
import './Sidebar.css'

// Kept from the segmented switch this nav replaced, so an existing choice survives the redesign.
const MODE_KEY = 'fastStudyMode'

function storedMode(): AppMode {
  return localStorage.getItem(MODE_KEY) === 'courses' ? 'courses' : 'lectures'
}

// How many downloads are running right now, for the Downloads badge.
function useRunningDownloads(): number {
  const byRef = useJobsByRef()
  let running = 0
  for (const jobs of byRef.values()) running += jobs.filter((j) => j.status === 'running').length
  return running
}

function rowClass(active: boolean): string {
  return `sidebar-nav-row${active ? ' active' : ''}`
}

function NavBody({ icon, label, badge }: { icon: IconName; label: string; badge?: number }) {
  return (
    <>
      <Icon icon={icon} />
      <span className="sidebar-nav-label">{label}</span>
      {badge ? <span className="sidebar-nav-badge">{badge}</span> : null}
    </>
  )
}

export default function Sidebar() {
  const { t } = useLingui()
  const { pathname } = useLocation()
  // Which tree the body shows; persisted so a reload reopens the one that was in use.
  const [mode, setMode] = useState<AppMode>(storedMode)
  const running = useRunningDownloads()

  function selectMode(m: AppMode) {
    setMode(m)
    localStorage.setItem(MODE_KEY, m)
  }

  // A route row outranks the two tree rows: on /downloads or /search the tree is still there, but
  // it is not what the main pane is showing.
  const onDownloads = pathname.startsWith('/downloads')
  const onSearch = pathname.startsWith('/search')
  const onRoute = onDownloads || onSearch

  const Body = mode === 'courses' ? CoursesList : LecturesSidebar

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        {/* The product name is a brand, not copy — it reads the same in every locale. */}
        <span>Fast Study</span>
      </div>

      <nav className="sidebar-nav-block">
        <button
          className={rowClass(!onRoute && mode === 'lectures')}
          onClick={() => selectMode('lectures')}
        >
          <NavBody icon="nav-lectures" label={t`Lectures`} />
        </button>
        <button
          className={rowClass(!onRoute && mode === 'courses')}
          onClick={() => selectMode('courses')}
        >
          <NavBody icon="nav-courses" label={t`Courses`} />
        </button>
        <Link className={rowClass(onDownloads)} to="/downloads">
          <NavBody icon="nav-downloads" label={t`Downloads`} badge={running} />
        </Link>
        <Link className={rowClass(onSearch)} to="/search">
          <NavBody icon="nav-search" label={t`Search`} />
        </Link>
      </nav>

      <Body />

      <div className="sidebar-footer">
        <NewCourseRow />
        <LanguageSwitcher />
      </div>
    </aside>
  )
}
