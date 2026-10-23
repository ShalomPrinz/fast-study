import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CourseStructure } from '@/services/settings'
import { setCourseLecturesOnly } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toastFailure } from '@/shared/utils/failure'
import { checklistState } from '../utils/courseStructure'
import '@/styles/settings-form.css'
import './CourseStructureField.css'

// The mode saves with the page; a course's pick under "specific courses" writes at once, like archiving.
export default function CourseStructureField({
  value,
  saved,
  onChange,
}: {
  value: CourseStructure
  saved: CourseStructure
  onChange: (v: CourseStructure) => void
}) {
  const { t } = useLingui()
  const state = checklistState(value, saved)

  return (
    <div className="settings-field">
      <div className="settings-label">
        <label htmlFor="course-structure">
          <Trans>Course structure</Trans>
        </label>
      </div>
      <select
        id="course-structure"
        className="settings-select"
        value={value}
        onChange={(e) => onChange(e.target.value as CourseStructure)}
      >
        <option value="split">{t`Lectures and recitations`}</option>
        <option value="lectures_all">{t`Lectures only, in every course`}</option>
        <option value="lectures_some">{t`Lectures only, in the courses I choose`}</option>
      </select>
      <span className="settings-hint">
        <Trans>
          A lectures-only course lists its recitations among its lectures, and everything you add to
          it is a lecture. Nothing already saved moves.
        </Trans>
      </span>
      {state === 'saveFirst' && (
        <p className="settings-note" data-course-structure="save-first">
          <Trans>Save to choose the courses.</Trans>
        </p>
      )}
      {state === 'list' && <CourseChecklist />}
    </div>
  )
}

function CourseChecklist() {
  const { courses, refreshUntil } = useCourseTreeContext()
  const [pending, setPending] = useState<string | null>(null)
  const active = courses.filter((c) => !c.archived)

  async function toggle(course: string, on: boolean) {
    setPending(course)
    try {
      await setCourseLecturesOnly(course, on)
      // Held until the tree carries the new flag, so the box never flips back for a frame.
      await refreshUntil((tree) => tree.find((c) => c.name === course)?.lectures_only === on)
    } catch (err) {
      toastFailure(err)
    }
    setPending(null)
  }

  if (!active.length) {
    return (
      <p className="settings-note">
        <Trans>No courses yet.</Trans>
      </p>
    )
  }
  return (
    <ul className="course-structure-list" data-course-structure="list">
      {active.map((c) => (
        <li key={c.name}>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={c.lectures_only}
              disabled={pending !== null}
              onChange={(e) => void toggle(c.name, e.target.checked)}
            />
            <span className="settings-check-text">
              <bdi>{c.name}</bdi>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}
