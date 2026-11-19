import { useLingui } from '@lingui/react/macro'
import type { Kind } from '@/types'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import { useLectureRename } from '@/features/lectures/hooks/useLectureRename'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import './RenamableTitle.css'

// The lecture page's title: a click or the pencil beside it swaps it for an input, like the sidebar's rename.
export default function RenamableTitle({
  course,
  lecture,
  kind,
}: {
  course: string
  lecture: string
  kind: Kind
}) {
  const { t } = useLingui()
  const rename = useLectureRename(course, lecture, kind, true)

  if (rename.renaming) {
    return (
      <span className="renamable-title-edit">
        <InlineEditInput
          edit={rename.edit}
          onCommit={rename.actions.commit}
          onCancel={rename.actions.cancel}
          className="renamable-title-input"
        />
        {/* mousedown's default would blur the input first, and a blur cancels. */}
        <button
          type="button"
          className="btn btn--primary renamable-title-approve"
          onMouseDown={(e) => e.preventDefault()}
          onClick={rename.actions.commit}
        >
          {t`Approve`}
        </button>
      </span>
    )
  }

  return (
    <Tooltip
      content={
        rename.locked ? t`Can't rename while it's being processed or waiting in line` : undefined
      }
    >
      <span className="renamable-title">
        <span
          className="renamable-title-text"
          onClick={rename.actions.start}
          aria-disabled={rename.locked}
        >
          {rename.pendingName ?? lecture}
        </span>
        <button
          type="button"
          className="renamable-title-pencil"
          aria-label={t`Rename`}
          aria-disabled={rename.locked}
          onClick={rename.actions.start}
        >
          <Icon icon="edit" />
        </button>
      </span>
    </Tooltip>
  )
}
