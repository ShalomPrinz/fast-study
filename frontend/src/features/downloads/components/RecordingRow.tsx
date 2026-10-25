import Tooltip from '@/shared/components/Tooltip'
import { memo, useId, useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import { lectureTrack, lecturesOnly } from '@/features/lectures/utils/courseTree'
import ConfirmModal from '@/shared/components/ConfirmModal'
import type { Item, ProbedMedia } from '@/features/downloads/services/autoDownloader'
import PasscodePrompt from './PasscodePrompt'
import RecordingJobList from './RecordingJobList'
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'
import {
  jobsForTarget,
  rowStatus,
  useRowJobs,
} from '@/features/downloads/contexts/DownloadJobsContext'
import type { RowEdit, RowLock } from '@/features/downloads/contexts/RowEditsContext'
import { useRowEdit } from '@/features/downloads/contexts/RowEditsContext'
import {
  assignmentFilesOf,
  existingAssignmentNames,
  existingNames,
  hasResource,
  materialsOf,
  overwritesVideo,
  splitSiblings,
} from '@/features/downloads/utils/existingItems'
import { useRecordingDownload } from '@/features/downloads/hooks/useRecordingDownload'
import { rowAction } from '@/features/downloads/utils/rowAction'
import { useMoodleLockState } from '@/features/downloads/contexts/MoodleLockContext'
import { rowLocked } from '@/features/downloads/utils/moodleLock'
import { moodleBusyMessage } from '@/features/downloads/utils/downloadErrors'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/segmented.css'
import '@/styles/pipeline-card.css'
import '@/features/downloads/DownloadsView.css'
import './RecordingRow.css'
import Icon from '@/shared/components/Icon'

interface Props {
  item: Item
  edit: RowEdit | undefined
  lock: RowLock | undefined
  course: string
  onReconnect: () => void
}

// The resolved-type chip's copy; an unresolved 'unknown' row shows '?'.
const RESOLVED_LABEL: Record<ProbedMedia | 'unsupported', MessageDescriptor> = {
  video: msg`Video`,
  unsupported: msg`Unsupported`,
}

// One recording as a two-line card; a playlist is `PlaylistGroup`. Memoized on its own `edit`
// slice, so typing in one card leaves its siblings untouched.
const RecordingRow = memo(function RecordingRow({ item, edit, lock, course, onReconnect }: Props) {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  // Name/kind live in SectionGroup so this row and the bulk queue agree.
  const {
    kind,
    suggestion,
    value,
    name: effectiveName,
    setName,
    setKind,
  } = useRowEdit(item, edit, course, lock)
  // The actual downloads (one bar each) of this row's `ref` in this course, scoped to its current
  // name and kind; a running download re-attaches after a reload. Subscribed per row, so another
  // row's job change doesn't re-render this one.
  const jobs = jobsForTarget(useRowJobs(course, item.ref), effectiveName, kind)
  // Auto's cached probe answer, updated in place by a download this session (single-row or bulk) —
  // so the type column resolves on the same interaction, with no re-list.
  const resolved = item.resolvedMedia
  // Only an 'unknown' (Google Drive) row has a type worth showing; elsewhere it restates the segment.
  const unknown = item.media === 'unknown'
  const unsupported = unknown && resolved === 'unsupported'
  const verdict = resolved === 'video' || resolved === 'unsupported' ? resolved : undefined
  // A material row attaches a file to an existing lecture instead of creating one from a video.
  const material = item.media === 'material'
  // An assignment row files into a named assignment: no kind, no lecture, so the pipeline never touches it.
  const assignment = item.media === 'assignment'
  // The split siblings on disk a video row could overwrite (a zoom recording lands as `${name}.1`/`.2`),
  // so both the overwrite confirm and the pipeline lock cover them.
  const siblings = material || assignment ? [] : splitSiblings(effectiveName, kind, courses, course)
  const {
    download,
    retryClip,
    pending,
    retryingId,
    failed: queueFailed,
    passcode,
  } = useRecordingDownload({
    item,
    course,
    name: effectiveName,
    kind,
    siblings,
    onReconnect,
  })

  const listId = useId()
  const onlyLectures = lecturesOnly(courses, course, false)
  // A lectures-only course lists its recitations among the lectures, so a material can reach either.
  const node = courses.find((c) => c.name === course)
  const attachable = assignment
    ? existingAssignmentNames(courses, course)
    : onlyLectures && node
      ? lectureTrack(node).map((i) => i.name)
      : existingNames(kind, courses, course)
  // Non-blocking state note: a material download appends, so the count is shown rather than confirmed.
  const materialCount = material ? materialsOf(effectiveName, kind, courses, course).length : 0
  // Every file of one assignment lands in the same node, so the target's file count is shown instead.
  const fileCount = assignment ? assignmentFilesOf(effectiveName, courses, course).length : 0
  // Live tree, so a completed download's SSE refresh flips the card green.
  const alreadyDownloaded = hasResource(
    { ref: item.ref, media: item.media, resolvedMedia: resolved },
    effectiveName,
    kind,
    courses,
    course,
  )
  // A multi-clip recording (jobs.length > 1) turns the main button into a label.
  const status = rowStatus(jobs)
  const split = jobs.length > 1
  const downloading = status === 'running'
  const failed = queueFailed || status === 'error'
  const action = rowAction({ pending, unsupported, failed, done: status === 'done' })
  // The pipeline is running or queued on a lecture this row would write; the hook re-checks on start.
  const { status: runner } = useRunnerStatus()
  const inPipeline =
    !assignment &&
    [effectiveName, ...siblings].some((n) => isLectureRenameLocked(runner, course, n, kind))
  const busyTitle = t`Can't download while this lecture is being processed or waiting in line`
  // Download, Download again and clip retry wait out the lock only on a row auto flagged `moodle`.
  const locked = rowLocked(item.moodle, useMoodleLockState())
  const lockedTitle = locked ? moodleBusyMessage() : undefined

  // Pending overwrite confirm: `message` is what the modal shows, `run` is what a Yes replays
  // (the whole-row download or one clip's retry). Null means no modal.
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null)

  // A material appends as the next material.N.<ext> and an assignment file lands beside its siblings;
  // lazy zoom splits are a video-only hazard, so neither row confirms — the row's count is the signal.
  const onDownloadClick = () => {
    if (material || assignment) {
      download()
      return
    }
    // Re-downloading overwrites an existing video, so confirm first — an unprobed 'unknown' too, since
    // it may be a video. Exact match takes precedence; only otherwise warn if a zoom split
    // ('${name}.1'/'.2') exists — this row might split onto it.
    const overwrites = overwritesVideo(
      { media: item.media, resolvedMedia: resolved },
      effectiveName,
      kind,
      courses,
      course,
    )
    if (overwrites) {
      setConfirm({
        message: t`${effectiveName} already exists in ${course}. Download again and overwrite?`,
        run: download,
      })
      return
    }
    if (siblings.length) {
      const existing = siblings.join(', ')
      setConfirm({
        message: t`${effectiveName} may split into parts that overwrite existing ${existing} in ${course}. Download anyway?`,
        run: download,
      })
    } else download()
  }

  // A per-clip button in a split row: a done clip overwrites, so confirm naming that clip; an
  // errored or cancelled clip left nothing to overwrite, so start it straight away (mirrors the main button).
  const onClipAction = (job: JobProgress) =>
    job.status === 'done'
      ? setConfirm({
          message: t`${job.title} already exists in ${course}. Download again and overwrite?`,
          run: () => retryClip(job),
        })
      : retryClip(job)

  return (
    <div
      className={[
        'recording-card',
        downloading && 'recording-card--downloading',
        alreadyDownloaded && 'recording-card--downloaded',
        unsupported && 'recording-card--unsupported',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="recording-card-line">
        <Tooltip content={item.title}>
          <span className="recording-title" dir="auto">
            {item.title}
          </span>
        </Tooltip>
        {unknown && (
          <Tooltip content={t`File type`}>
            <span className="chip chip--neutral">{verdict ? t(RESOLVED_LABEL[verdict]) : '?'}</span>
          </Tooltip>
        )}
      </div>

      <div className="recording-card-line">
        <span className="recording-save-label">
          <Trans>Save as</Trans>
        </span>

        {/* A lectures-only course saves every new recording as a lecture. */}
        {!onlyLectures && !assignment && (
          <div className="mode-toggle mode-toggle--light">
            <button
              className={kind === 'lecture' ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
              onClick={() => setKind('lecture')}
            >
              <Trans>Lecture</Trans>
            </button>
            <button
              className={kind === 'recitation' ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
              onClick={() => setKind('recitation')}
            >
              <Trans>Recitation</Trans>
            </button>
          </div>
        )}

        {/* Material and assignment rows pick an existing lecture or assignment, so the input offers
            them — while staying free text, since the target may not exist yet. */}
        <input
          className="source-row-input recording-name-input"
          value={value}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestion}
          list={material || assignment ? listId : undefined}
          aria-label={
            assignment ? t`Assignment` : material ? t`Attach material to` : t`Lecture name`
          }
          // A suggestion input follows the UI direction so its text aligns with the list (I18N.md).
          dir={material || assignment ? undefined : 'auto'}
        />
        {(material || assignment) && (
          <datalist id={listId}>
            {attachable.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        )}
        {fileCount > 0 && (
          <span className="recording-material-count">
            <Plural value={fileCount} one="# file" other="# files" />
          </span>
        )}
        {materialCount > 0 && (
          <span className="recording-material-count">
            <Plural value={materialCount} one="# material" other="# materials" />
          </span>
        )}

        {split ? (
          // Per-clip buttons own re-download/retry, so the main button is just a status label here.
          <span className="btn recording-download-btn recording-download-btn--label">
            {downloading
              ? t`Downloading…`
              : status === 'error'
                ? t`Failed ✗`
                : status === 'cancelled'
                  ? t`Cancelled`
                  : t`Downloaded ✓`}
          </span>
        ) : downloading ? (
          // The bars below say how far along it is, so the action reduces to naming the state.
          <span className="chip chip--accent">
            <Trans>Downloading</Trans>
          </span>
        ) : alreadyDownloaded && !failed ? (
          // Settled: an always-visible icon (keyboard- and touch-reachable) through the same handler,
          // which turns a settled row into the overwrite confirm.
          <span className="recording-settled">
            <span className="chip chip--ok">
              <Icon icon="check" />
              <Trans>In course</Trans>
            </span>
            <Tooltip content={inPipeline ? busyTitle : (lockedTitle ?? t`Download again`)}>
              <button
                className="pipeline-icon-btn"
                onClick={onDownloadClick}
                disabled={pending || inPipeline || locked}
                aria-label={t`Download again`}
              >
                <Icon icon="rotate" />
              </button>
            </Tooltip>
          </span>
        ) : (
          <>
            {/* A cancelled download is a neutral outcome: a chip naming it, with the plain Download. */}
            {status === 'cancelled' && !failed && (
              <span className="chip chip--neutral recording-cancelled">
                <Trans>Cancelled</Trans>
              </span>
            )}
            <Tooltip
              content={
                unsupported
                  ? t`The downloader can't fetch this file`
                  : inPipeline
                    ? busyTitle
                    : lockedTitle
              }
            >
              <button
                className="btn btn--ghost recording-download-btn"
                onClick={onDownloadClick}
                disabled={pending || unsupported || inPipeline || locked}
              >
                {action === 'pending' ? (
                  <span className="recording-spinner" />
                ) : action === 'retry' ? (
                  t`Retry ✗`
                ) : action === 'done' ? (
                  t`Downloaded ✓`
                ) : (
                  t`Download`
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <RecordingJobList
        jobs={jobs}
        split={split}
        retryingId={retryingId}
        lockedTitle={lockedTitle}
        onClipAction={onClipAction}
      />

      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={() => {
            const run = confirm.run
            setConfirm(null)
            run()
          }}
          onCancel={() => setConfirm(null)}
          // A Yes replays a Moodle download, so it waits out the lock like the button that opened it.
          confirmLocked={lockedTitle}
        />
      )}

      {passcode && <PasscodePrompt {...passcode} submitLocked={lockedTitle} />}
    </div>
  )
})

export default RecordingRow
