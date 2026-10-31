import Tooltip from '@/shared/components/Tooltip'
import { useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createCourse } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useCourseUrlCheck } from '@/features/downloads/hooks/useCourseUrlCheck'
import { addFormDraft, needsCheck } from '@/features/downloads/utils/coursePicker'
import CoursePicker from './CoursePicker'
import CourseCheckFailure from './CourseCheckFailure'
import '@/styles/source-row.css'
import '@/styles/button.css'
import './AddCoursePanel.css'

type Mode = 'picking' | 'form'

// A new course, picked from Moodle (name prefilled, URL fixed) or from a pasted URL. Plain inputs, not
// InlineEditInput: moving between the name and URL fields must not blur-cancel.
interface Props {
  onDone: () => void
}

export default function AddCoursePanel({ onDone }: Props) {
  const { t } = useLingui()
  const { refreshCourses } = useCourseTreeContext()
  const [mode, setMode] = useState<Mode>('picking')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  // The URL came from the picker (Moodle's list, or a paste it checked or saved anyway), so it is shown, not edited.
  const [urlFixed, setUrlFixed] = useState(false)
  const [saving, setSaving] = useState(false)
  const { checking, failure, check, clear } = useCourseUrlCheck()
  const urlInput = useRef<HTMLInputElement>(null)
  // A ref, not `checking`/`saving`: a second Enter can land before the render that disables Create.
  const inFlight = useRef(false)

  function reset() {
    clear()
    onDone()
  }

  function openForm(courseName: string, courseUrl: string) {
    const draft = addFormDraft(courseName, courseUrl)
    setName(draft.name)
    setUrl(draft.url)
    setUrlFixed(draft.urlFixed)
    setMode('form')
  }

  async function create(checked: boolean) {
    const trimmed = name.trim()
    if (!trimmed || inFlight.current) return
    inFlight.current = true
    try {
      const source = url.trim()
      if (!checked && needsCheck(source, urlFixed) && !(await check(source))) return
      setSaving(true)
      await createCourse(trimmed, source)
      await refreshCourses()
      reset()
    } catch (e) {
      toastFailure(e)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  if (mode === 'picking') {
    return (
      <CoursePicker
        currentUrl=""
        onChoose={(c) => openForm(c.name, c.url)}
        onPaste={(pasted) => openForm('', pasted)}
        onCancel={reset}
      />
    )
  }

  return (
    <div className="source-add">
      <div className="source-add-row">
        <input
          className="source-row-input source-add-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create(false)
            if (e.key === 'Escape') reset()
          }}
          placeholder={t`Course name…`}
          dir="auto"
          autoFocus
        />
        <Tooltip content={urlFixed ? url : undefined}>
          <input
            ref={urlInput}
            className="source-row-input source-add-url"
            value={url}
            readOnly={urlFixed}
            onChange={(e) => {
              setUrl(e.target.value)
              clear()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create(false)
              if (e.key === 'Escape') reset()
            }}
            placeholder={t`Source URL (optional)…`}
            dir="auto"
          />
        </Tooltip>
        <Tooltip content={name.trim() ? undefined : t`Enter a course name first`}>
          <button
            className="btn btn--primary"
            onClick={() => void create(false)}
            disabled={saving || checking || !name.trim()}
          >
            {checking ? t`Checking…` : t`Create`}
          </button>
        </Tooltip>
        <button className="btn btn--ghost" onClick={reset}>
          <Trans>Cancel</Trans>
        </button>
      </div>
      {failure && (
        <CourseCheckFailure
          failure={failure}
          onSaveAnyway={() => void create(true)}
          onEdit={() => {
            clear()
            urlInput.current?.focus()
          }}
        />
      )}
    </div>
  )
}
