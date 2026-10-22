import { useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import type { Kind, Lecture } from '@/types'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { lectureRoute } from '@/shared/utils/url'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import '@/styles/button.css'
import './CurrentStudyButton.css'

// Opens one track's current item — its first lecture or recitation not marked done. With none
// (all done, or the track is empty) the button disables and a green note says why.
export default function CurrentStudyButton({
  course,
  kind,
  items,
}: {
  course: string
  kind: Kind
  items: Lecture[]
}) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { current, total } = trackProgress(items)
  const isRecitation = kind === 'recitation'

  const label = isRecitation ? t`Current recitation` : t`Current lecture`
  const hint = isRecitation
    ? t`Open the first recitation you haven't finished yet`
    : t`Open the first lecture you haven't finished yet`
  const note =
    total === 0
      ? isRecitation
        ? t`No recitations yet`
        : t`No lectures yet`
      : isRecitation
        ? t`All recitations done`
        : t`All lectures done`

  return (
    <span className="current-study">
      <Tooltip content={current ? hint : undefined}>
        <button
          className="btn btn--info"
          disabled={!current}
          onClick={() => current && navigate(lectureRoute(course, current, kind))}
        >
          {label}
        </button>
      </Tooltip>
      {!current && (
        <span className="current-study-note">
          <Icon icon="check" />
          {note}
        </span>
      )}
    </span>
  )
}
