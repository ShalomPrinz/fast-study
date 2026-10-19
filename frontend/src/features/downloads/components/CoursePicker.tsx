import Tooltip from '@/shared/components/Tooltip'
import { useState } from 'react'
import { Plural, Trans } from '@lingui/react/macro'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { useEnrolledCourses } from '@/features/downloads/hooks/useEnrolledCourses'
import { useLocaleHold } from '@/shared/hooks/useLocaleHold'
import type { EnrolledCourse } from '@/features/downloads/services/autoDownloader'
import { codeOverCap, pickerView, splitCourses } from '@/features/downloads/utils/coursePicker'
import CourseUrlPaste from './CourseUrlPaste'
import '@/styles/button.css'
import '@/styles/chip.css'
import './CoursePicker.css'

interface Props {
  // The source already saved, marked in the list and prefilled in the paste input.
  currentUrl: string
  onChoose: (course: EnrolledCourse) => void
  // A pasted URL that passed its check, was saved anyway, or is empty (clearing).
  onPaste: (url: string) => void
  onCancel: () => void
}

// Picks a course's source from the enrolled courses (past ones behind a toggle) or a pasted URL; with no
// list to offer (not connected, or the site's list closed) it opens straight on the paste input.
export default function CoursePicker({ currentUrl, onChoose, onPaste, onCancel }: Props) {
  const { status } = useAuthStatus()
  const disconnected = status?.connected === false
  // Its names are in the locale at open, so the language stays put while it is open.
  useLocaleHold()
  const list = useEnrolledCourses(!disconnected)
  const [pasting, setPasting] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const view = pickerView(status, list, pasting)
  const { current, past } = splitCourses(Array.isArray(list) ? list : [])

  const item = (c: EnrolledCourse) => (
    <li key={c.id}>
      <Tooltip content={c.url}>
        <button
          className={[
            'course-picker-item',
            c.url === currentUrl && 'course-picker-item--current',
            codeOverCap(c.code) && 'course-picker-item--long-code',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={c.url === currentUrl || undefined}
          onClick={() => onChoose(c)}
        >
          {/* Each isolated, so the code chip leads on the page's start edge and a name in either script
              can't reorder across it. */}
          {c.code && <bdi className="chip course-picker-code">{c.code}</bdi>}
          <bdi className="course-picker-name">{c.name}</bdi>
        </button>
      </Tooltip>
    </li>
  )

  return (
    <div className={`course-picker course-picker--${view}`}>
      {disconnected && (
        <p className="course-picker-hint">
          {status?.unconfigured ? (
            <Trans>Choose your university in Settings first</Trans>
          ) : (
            <Trans>Connect your university account first</Trans>
          )}
        </p>
      )}
      {view === 'loading' && (
        <p className="course-picker-note">
          <Trans>Loading your courses…</Trans>
        </p>
      )}
      {view === 'list' && (
        <>
          {current.length > 0 ? (
            <ul className="course-picker-list">{current.map(item)}</ul>
          ) : (
            <p className="course-picker-note">
              <Trans>No current courses.</Trans>
            </p>
          )}
          {past.length > 0 && (
            <button
              className="course-picker-past-toggle"
              aria-expanded={showPast}
              onClick={() => setShowPast((v) => !v)}
            >
              {showPast ? (
                <Trans>Hide past courses</Trans>
              ) : (
                <Plural value={past.length} one="Show # past course" other="Show # past courses" />
              )}
            </button>
          )}
          {showPast && (
            <ul className="course-picker-list course-picker-list--past">{past.map(item)}</ul>
          )}
        </>
      )}
      {view === 'paste' ? (
        <CourseUrlPaste initial={currentUrl} onSave={onPaste} onCancel={onCancel} />
      ) : (
        <div className="course-picker-actions">
          <button className="btn btn--ghost course-picker-paste" onClick={() => setPasting(true)}>
            <Trans>Paste a URL instead</Trans>
          </button>
          <button className="btn btn--ghost" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </button>
        </div>
      )}
    </div>
  )
}
