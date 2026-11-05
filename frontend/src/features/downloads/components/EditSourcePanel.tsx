import { useEffect, useRef, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import type { Course } from '@/types'
import { setCourseSourceUrl } from '@/services/database'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { sourceChangeAction } from '@/features/downloads/utils/sourceChange'
import { useDownloadsActions } from '@/features/downloads/contexts/DownloadsSessionContext'
import { failureOf, toastFailure } from '@/shared/utils/failure'
import ServiceError from '@/shared/components/ServiceError'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import CoursePicker from './CoursePicker'
import './EditSourcePanel.css'

interface Props {
  course: Course
  // Whether the course's recordings are open or loading, so a cleared URL closes them.
  loaded: boolean
  loading: boolean
  // Loads the course from its new URL, as picking it would (deferred while discovery is barred).
  onLoad: (course: Course) => void
  onDone: () => void
}

// Edits the picked course's source URL: the course picker with the saved URL selected and marked current.
// A Moodle pick is saved as is; a pasted one arrives already checked or saved anyway.
export default function EditSourcePanel({ course, loaded, loading, onLoad, onDone }: Props) {
  const { refreshCourses } = useCourseTreeContext()
  const { close } = useDownloadsActions()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ServiceFailure | null>(null)
  // Refs, not the state: a second Enter can land before the render, and Cancel must reach the save already in flight.
  const pending = useRef(false)
  const cancelled = useRef(false)

  // Leaving the panel by any route (tab, another course, Back) is a Cancel for a save in flight.
  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  async function save(url: string) {
    if (pending.current) return
    const oldUrl = course.source_url ?? ''
    if (url === oldUrl) {
      onDone()
      return
    }
    pending.current = true
    setSaving(true)
    setError(null)
    try {
      await setCourseSourceUrl(course.name, url)
    } catch (e) {
      // Connection errors are toasted centrally; a cancelled save has no panel left to show it in.
      if (cancelled.current) toastFailure(e)
      else setError(failureOf(e))
      return
    } finally {
      pending.current = false
      if (!cancelled.current) setSaving(false)
    }
    try {
      // Cancelled mid-save: the write still landed, so only the tree is refreshed.
      if (cancelled.current) {
        await refreshCourses()
        return
      }
      onDone()
      const action = sourceChangeAction(loaded, loading, oldUrl, url)
      // A cleared course is refreshed before closing, so the box sees it has no source and keeps it.
      if (action === 'close') {
        await refreshCourses()
        close()
        return
      }
      if (action === 'reload') onLoad({ ...course, source_url: url })
      await refreshCourses()
    } catch (e) {
      toastFailure(e)
    }
  }

  function cancel() {
    cancelled.current = true
    onDone()
  }

  return (
    <div className="edit-source-panel" aria-busy={saving}>
      {saving && (
        <p className="edit-source-saving" role="status">
          <Trans>Saving…</Trans>
        </p>
      )}
      {error && (
        <div className="edit-source-error" role="alert">
          {error.code ? (
            <ServiceError failure={error} />
          ) : (
            <Trans>Failed to save the course's source URL</Trans>
          )}
        </div>
      )}
      <CoursePicker
        resetKey={course.name}
        currentUrl={course.source_url ?? ''}
        onChoose={(c) => void save(c.url)}
        onPaste={(url) => void save(url)}
        onCancel={cancel}
      />
    </div>
  )
}
