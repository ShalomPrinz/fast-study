import { useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import type { Kind } from '@/types'
import type { TrackItem } from '@/features/lectures/utils/courseTree'
import { trackProgress } from '@/features/lectures/utils/studyProgress'
import { lectureRoute } from '@/shared/utils/url'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import './CurrentStudy.css'

// One nav tile per track opening its current item — its first lecture or recitation not marked done —
// over one line of green notes for the tracks with none (all done, or the track is empty). A
// lectures-only course has one track (`recitations` null), whose current item may be a recitation.
export default function CurrentStudy({
  course,
  lectures,
  recitations,
}: {
  course: string
  lectures: TrackItem[]
  recitations: TrackItem[] | null
}) {
  const { t } = useLingui()
  const lecture = trackProgress(lectures)
  const recitation = recitations && trackProgress(recitations)

  const lectureNote = lecture.current
    ? null
    : lecture.total === 0
      ? t`No lectures yet`
      : t`All lectures done`
  const recitationNote =
    !recitation || recitation.current
      ? null
      : recitation.total === 0
        ? t`No recitations yet`
        : t`All recitations done`
  const notes = [lectureNote, recitationNote].filter((note) => note !== null)

  return (
    <div className="current-study">
      <div className="current-study-tiles">
        <StudyTile
          course={course}
          current={lecture.current}
          label={t`Current lecture`}
          hint={t`Open the first lecture you haven't finished yet`}
          emptyHint={lectureNote}
        />
        {recitation && (
          <StudyTile
            course={course}
            current={recitation.current}
            label={t`Current recitation`}
            hint={t`Open the first recitation you haven't finished yet`}
            emptyHint={recitationNote}
          />
        )}
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
  current,
  label,
  hint,
  emptyHint,
}: {
  course: string
  current: { name: string; kind: Kind } | null
  label: string
  hint: string
  emptyHint: string | null
}) {
  const navigate = useNavigate()
  return (
    <Tooltip content={current ? hint : (emptyHint ?? undefined)}>
      <button
        className="study-tile"
        disabled={!current}
        onClick={() => current && navigate(lectureRoute(course, current.name, current.kind))}
      >
        <span className="study-tile-text">
          <span className="study-tile-label">{label}</span>
          {current ? (
            <span className="study-tile-name">
              <bdi>{current.name}</bdi>
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
