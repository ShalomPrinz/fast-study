import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useCourseUrlCheck } from '@/features/downloads/hooks/useCourseUrlCheck'
import { needsCheck } from '@/features/downloads/utils/coursePicker'
import CourseCheckFailure from './CourseCheckFailure'
import '@/styles/source-row.css'
import '@/styles/button.css'
import './CourseUrlPaste.css'

interface Props {
  initial: string
  onSave: (url: string) => void
  onCancel: () => void
}

// A pasted course URL, checked before it is saved; an empty one saves at once, which clears the source.
export default function CourseUrlPaste({ initial, onSave, onCancel }: Props) {
  const { t } = useLingui()
  const [value, setValue] = useState(initial)
  const { checking, failure, check, clear } = useCourseUrlCheck()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  async function commit() {
    const url = value.trim()
    if (!needsCheck(url, false) || (await check(url))) onSave(url)
  }

  function edit() {
    clear()
    input.current?.focus()
  }

  return (
    <div className="course-url-paste">
      <div className="course-url-paste-line">
        <input
          ref={input}
          className="source-row-input course-url-paste-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            clear()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !checking) void commit()
            if (e.key === 'Escape') onCancel()
          }}
          placeholder={t`Paste the course page's address (…/course/view.php?id=…)`}
          aria-label={t`Course URL`}
          dir="auto"
        />
        <button className="btn btn--ghost" onClick={() => void commit()} disabled={checking}>
          {checking ? t`Checking…` : t`Save`}
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </button>
      </div>
      {failure && (
        <CourseCheckFailure
          failure={failure}
          onSaveAnyway={() => onSave(value.trim())}
          onEdit={edit}
        />
      )}
    </div>
  )
}
