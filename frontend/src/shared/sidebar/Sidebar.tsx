import { useLingui } from '@lingui/react/macro'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Icon from '@/shared/components/Icon'
import type { IconName } from '@/shared/components/Icon'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import { lastLectureRoute, readLastLecture } from '@/features/lectures/utils/lastLecture'
import LanguageSwitcher from './LanguageSwitcher'
import './Sidebar.css'

// How many downloads are running right now, for the Downloads badge.
function useRunningDownloads(): number {
  const byRef = useJobsByRef()
  let running = 0
  for (const jobs of byRef.values()) running += jobs.filter((j) => j.status === 'running').length
  return running
}

// `current/total` while the runner is on, for the Running pipelines badge; undefined when idle.
function useRunnerProgress(): string | undefined {
  const { status } = useRunnerStatus()
  if (!status?.runner.running) return undefined
  // `done` counts finished lectures; display the 1-indexed current one, capped at total.
  const current = Math.min(status.runner.done + 1, status.runner.total)
  return `${current}/${status.runner.total}`
}

function rowClass(active: boolean): string {
  return `sidebar-nav-row${active ? ' active' : ''}`
}

function NavBody({
  icon,
  label,
  badge,
}: {
  icon: IconName
  label: string
  badge?: string | number
}) {
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
  const navigate = useNavigate()
  const { courses } = useCourseTreeContext()
  const runningDownloads = useRunningDownloads()
  const runnerProgress = useRunnerProgress()

  const onRunning = pathname.startsWith('/running')
  const onDownloads = pathname.startsWith('/downloads')
  const onSearch = pathname.startsWith('/search')
  const onSettings = pathname.startsWith('/settings')
  // Every path the other rows don't claim is `/`, `/course/:c` or `/:c/:l[/edit]` — a lectures page.
  const onLectures = !(onRunning || onDownloads || onSearch || onSettings)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        {/* The product name is a brand, not copy — it reads the same in every locale. */}
        <span>Fast Study</span>
      </div>

      <nav className="sidebar-nav-block">
        <button
          className={rowClass(onLectures)}
          onClick={() => navigate(lastLectureRoute(courses, readLastLecture()))}
        >
          <NavBody icon="nav-lectures" label={t`Lectures`} />
        </button>
        <Link className={rowClass(onRunning)} to="/running">
          <NavBody icon="nav-running" label={t`Running pipelines`} badge={runnerProgress} />
        </Link>
        <Link className={rowClass(onDownloads)} to="/downloads">
          <NavBody icon="nav-downloads" label={t`Downloads`} badge={runningDownloads} />
        </Link>
        <Link className={rowClass(onSearch)} to="/search">
          <NavBody icon="nav-search" label={t`Search`} />
        </Link>
        <Link className={rowClass(onSettings)} to="/settings">
          <NavBody icon="nav-settings" label={t`Settings`} />
        </Link>
      </nav>

      <div className="sidebar-footer">
        <LanguageSwitcher />
      </div>
    </aside>
  )
}
