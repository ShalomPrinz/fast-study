import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import Tooltip from '@/shared/components/Tooltip'
import Icon from '@/shared/components/Icon'
import CourseCombobox from './CourseCombobox'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/styles/pipeline-card.css'
import './CourseSourceBar.css'

interface Props {
  // The picked course's name, or '' for none.
  chosen: string
  names: readonly string[]
  onPick: (name: string) => void
  onEdit: () => void
  onAdd: () => void
  editing: boolean
  adding: boolean
}

// The frozen University row: pick a course (loads it), edit its source URL, add a course. The box
// shows typed text while filtering and falls back to the picked name on blur, so it never creates.
export default function CourseSourceBar({
  chosen,
  names,
  onPick,
  onEdit,
  onAdd,
  editing,
  adding,
}: Props) {
  const { t } = useLingui()
  const [text, setText] = useState(chosen)
  useEffect(() => setText(chosen), [chosen])

  return (
    <div className="course-source-bar">
      <CourseCombobox
        id="course-source"
        className="course-source-select"
        value={text}
        options={names}
        placeholder={t`Choose a course…`}
        onChange={setText}
        onPick={onPick}
        onBlur={() => setText(chosen)}
      />
      <Tooltip content={chosen ? t`Edit source URL` : t`Choose a course first`}>
        <button
          className="pipeline-icon-btn"
          onClick={onEdit}
          disabled={!chosen || editing}
          aria-label={t`Edit source URL`}
        >
          <Icon icon="edit" />
        </button>
      </Tooltip>
      <button className="btn btn--ghost" onClick={onAdd} disabled={adding}>
        {t`+ Add course`}
      </button>
    </div>
  )
}
