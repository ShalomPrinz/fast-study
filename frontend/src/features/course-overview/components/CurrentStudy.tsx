import { useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import type { Kind, Lecture } from '@/types'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { lectureRoute } from '@/shared/utils/url'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import './CurrentStudy.css'

// One nav tile per track opening its current item — its first lecture or recitation not marked done —
// over one line of green notes for the tracks with none (all done, or the track is empty).
export default function CurrentStudy({
  course,
  lectures,
  recitations,
}: {
  course: string
  lectures: Lecture[]
  recitations: Lecture[]
}) {
  const { t } = useLingui()
  const lecture = trackProgress(lectures)
  const recitation = trackProgress(recitations)

  const notes = [
    lecture.current ? null : lecture.total === 0 ? t`No lectures yet` : t`All lectures done`,
    recitation.current
      ? null
      : recitation.total === 0
        ? t`No recitations yet`
        : t`All recitations done`,
  ].filter((note) => note !== null)

  return (
    <div className="current-study">
      <div className="current-study-tiles">
        <StudyTile
          course={course}
          kind="lecture"
          current={lecture.current}
          label={t`Current lecture`}
          hint={t`Open the first lecture you haven't finished yet`}
        />
        <StudyTile
          course={course}
          kind="recitation"
          current={recitation.current}
          label={t`Current recitation`}
          hint={t`Open the first recitation you haven't finished yet`}
        />
      </div>
      {notes.length > 0 && (
        <p className="current-study-notes">
          {notes.map((note, i) => (
            <span key={note} className="current-study-note">
              {i > 0 && <span className="current-study-sep">·</span>}
              <Icon icon="check" />
              {note}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

// With no current item the tile disables and holds a muted dash where the name goes, keeping its height.
function StudyTile({
  course,
  kind,
  current,
  label,
  hint,
}: {
  course: string
  kind: Kind
  current: string | null
  label: string
  hint: string
}) {
  const navigate = useNavigate()
  return (
    <Tooltip content={current ? hint : undefined}>
      <button
        className="study-tile"
        disabled={!current}
        onClick={() => current && navigate(lectureRoute(course, current, kind))}
      >
        <span className="study-tile-text">
          <span className="study-tile-label">{label}</span>
          {current ? (
            <span className="study-tile-name">
              <bdi>{current}</bdi>
            </span>
          ) : (
            <span className="study-tile-name study-tile-name--empty" aria-hidden="true">
              —
            </span>
          )}
        </span>
        <span className="study-tile-arrow" aria-hidden="true">
          <Icon icon="arrow-end" />
        </span>
      </button>
    </Tooltip>
  )
}
