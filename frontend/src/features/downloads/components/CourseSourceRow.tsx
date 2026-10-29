import Tooltip from '@/shared/components/Tooltip'
import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { Course } from '@/types'
import { setCourseSourceUrl } from '@/services/database'
import { openExternalUrl } from '@/services/open'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { useMoodleLockState } from '@/features/downloads/contexts/MoodleLockContext'
import { moodleLocked } from '@/features/downloads/utils/moodleLock'
import { moodleBusyMessage } from '@/features/downloads/utils/downloadErrors'
import { sourceChangeAction } from '@/features/downloads/utils/sourceChange'
import { useDownloadsActions } from '@/features/downloads/contexts/DownloadsSessionContext'
import CoursePicker from './CoursePicker'
import Icon from '@/shared/components/Icon'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/pipeline-card.css'
import './CourseSourceRow.css'

interface Props {
  course: Course
  onDiscover?: () => void
  selected?: boolean
  discovering?: boolean
}

// One course: name, source URL and Load course, a Loaded chip on the open course. The pencil, or
// "+ add source URL" with none, opens the course picker under the row.
export default function CourseSourceRow({ course, onDiscover, selected, discovering }: Props) {
  const { t } = useLingui()
  const { refreshCourses } = useCourseTreeContext()
  // The actions bag is identity-stable, so reading it costs the row no re-renders.
  const { discover, close } = useDownloadsActions()
  const { status } = useAuthStatus()
  // Only a probe that came back "not connected" bars discovery. A probe still in flight or one that
  // failed says nothing, and guessing "disconnected" there would lock a working session out.
  const disconnected = status?.connected === false
  const locked = moodleLocked(useMoodleLockState())
  const [editing, setEditing] = useState(false)
  // A const, not the prop: the click handler below closes over it, and TS narrows only a const.
  const sourceUrl = course.source_url

  function start() {
    setEditing(true)
  }

  // A course picked from Moodle's list is saved as is; a pasted one arrives already checked or saved anyway.
  async function save(url: string) {
    const oldUrl = course.source_url ?? ''
    setEditing(false)
    if (url === oldUrl) return
    await setCourseSourceUrl(course.name, url)
    const action = sourceChangeAction(!!selected, !!discovering, oldUrl, url)
    if (action !== 'none') close()
    if (action === 'reload') void discover({ ...course, source_url: url }, { wait: true })
    await refreshCourses()
  }

  return (
    <div className={selected ? 'source-row source-row--selected' : 'source-row'}>
      <Tooltip content={course.name}>
        <span className="source-row-name" dir="auto">
          {course.name}
        </span>
      </Tooltip>
      {sourceUrl ? (
        <Tooltip content={sourceUrl}>
          <a
            className="source-row-url-text"
            href={sourceUrl}
            onClick={(e) => {
              e.preventDefault()
              void openExternalUrl(sourceUrl)
            }}
            dir="auto"
          >
            {sourceUrl}
          </a>
        </Tooltip>
      ) : (
        <button className="source-row-url" onClick={start} disabled={editing} dir="auto">
          <Trans>+ add source URL</Trans>
        </button>
      )}
      {!editing && sourceUrl && (
        <div className="source-row-actions">
          <Tooltip content={t`Edit source URL`}>
            <button className="pipeline-icon-btn" onClick={start} aria-label={t`Edit source URL`}>
              <Icon icon="edit" />
            </button>
          </Tooltip>
          {/* The loaded course's recordings are already on the page, so it states that instead —
              but not until the discovery that loads them has actually landed. */}
          {selected && !discovering ? (
            <span className="chip chip--accent">
              <Trans>Loaded</Trans>
            </span>
          ) : (
            onDiscover && (
              <Tooltip
                content={
                  status?.unconfigured
                    ? t`Choose your university in Settings first`
                    : disconnected
                      ? t`Connect your university account first`
                      : locked
                        ? moodleBusyMessage()
                        : undefined
                }
              >
                <button
                  className="btn btn--ghost"
                  onClick={onDiscover}
                  disabled={discovering || disconnected || locked}
                >
                  {discovering ? t`Loading…` : t`Load course`}
                </button>
              </Tooltip>
            )
          )}
        </div>
      )}
      {editing && (
        <div className="source-row-picker">
          <CoursePicker
            currentUrl={sourceUrl ?? ''}
            onChoose={(c) => void save(c.url)}
            onPaste={(url) => void save(url)}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  )
}
