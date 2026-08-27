import { memo, useId, useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import type { Item, ResolvedMedia } from '@/features/downloads/services/autoDownloader'
import PasscodePrompt from './PasscodePrompt'
import RecordingJobList from './RecordingJobList'
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'
import { rowStatus, useRowJobs } from '@/features/downloads/contexts/DownloadJobsContext'
import type { RowEdit } from '@/features/downloads/contexts/RowEditsContext'
import { useRowEdit, useRowEdits } from '@/features/downloads/contexts/RowEditsContext'
import { useRowExpansion } from '@/features/downloads/contexts/RowExpansionsContext'
import {
  existingNames,
  hasResource,
  materialsOf,
  splitSiblings,
} from '@/features/downloads/utils/existingItems'
import { useRecordingDownload } from '@/features/downloads/hooks/useRecordingDownload'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/segmented.css'
import '@/features/downloads/DownloadsView.css'
import './RecordingRow.css'
import Chevron from '@/shared/components/Chevron'
import Icon from '@/shared/components/Icon'

interface Props {
  item: Item
  edit: RowEdit | undefined
  course: string
  onReconnect: () => void
  // Absent for a playlist's children, which are never expandable themselves.
  onToggle?: (item: Item) => void
}

// The resolved-type chip's copy; an unresolved 'unknown' row shows '?'.
const RESOLVED_LABEL: Record<ResolvedMedia, MessageDescriptor> = {
  video: msg`Video`,
  material: msg`Material`,
  unsupported: msg`Unsupported`,
}

// One discovered recording as a two-line card — what it is, then where it is going; an expandable
// one renders each child as a recursive RecordingRow instead.
// Memoized on its own `edit` slice, so typing in one card leaves its siblings untouched.
const RecordingRow = memo(function RecordingRow({
  item,
  edit,
  course,
  onReconnect,
  onToggle,
}: Props) {
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
  } = useRowEdit(item, edit, course)
  // The actual downloads (one bar each) grouped by this row's `ref`; a running download re-attaches
  // for free after a reload. Subscribed per ref, so another row's job change doesn't re-render this one.
  const jobs = useRowJobs(item.ref)
  // Subscribed per ref, so expanding one playlist leaves every other row alone. The state itself is
  // SectionGroup's — the bulk queue needs the same children cache.
  const expand = useRowExpansion(item.ref)
  // Auto's cached probe answer, updated in place by a download this session (single-row or bulk) —
  // so the type column resolves on the same interaction, with no re-list.
  const resolved = item.resolvedMedia
  // Only an 'unknown' (Google Drive) row has a type worth showing; elsewhere it restates the segment.
  const unknown = item.media === 'unknown'
  const unsupported = unknown && resolved === 'unsupported'
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
    onReconnect,
  })

  // A material row attaches a PDF to an existing lecture instead of creating one from a video —
  // including an 'unknown' row the probe resolved to a PDF.
  const material = item.media === 'material' || (unknown && resolved === 'material')
  const listId = useId()
  // Non-blocking state note: a material download appends, so the count is shown rather than confirmed.
  const materialCount = material ? materialsOf(effectiveName, kind, courses, course).length : 0
  // Live tree, so a completed download's SSE refresh flips the card green.
  const alreadyDownloaded = hasResource(
    { media: item.media, resolvedMedia: resolved },
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

  // Pending overwrite confirm: `message` is what the modal shows, `run` is what a Yes replays
  // (the whole-row download or one clip's retry). Null means no modal.
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null)

  // A material appends as the next material.N.pdf and lazy zoom splits are a video-only hazard, so a
  // material row never confirms — the row's material count is the whole signal.
  const onDownloadClick = () => {
    if (material) {
      download()
      return
    }
    // Re-downloading overwrites an existing video, so confirm first. Exact match takes precedence;
    // only otherwise warn if a zoom split ('${name}.1'/'.2') exists — this row might split onto it.
    if (alreadyDownloaded || status === 'done') {
      setConfirm({
        message: t`${effectiveName} already exists in ${course}. Download again and overwrite?`,
        run: download,
      })
      return
    }
    const siblings = splitSiblings(effectiveName, kind, courses, course)
    if (siblings.length) {
      const existing = siblings.join(', ')
      setConfirm({
        message: t`${effectiveName} may split into parts that overwrite existing ${existing} in ${course}. Download anyway?`,
        run: download,
      })
    } else download()
  }

  // A per-clip button in a split row: a done clip overwrites, so confirm naming that clip; an
  // errored clip downloaded nothing to overwrite, so retry straight away (mirrors the main button).
  const onClipAction = (job: JobProgress) =>
    job.status === 'done'
      ? setConfirm({
          message: t`${job.title} already exists in ${course}. Download again and overwrite?`,
          run: () => retryClip(job),
        })
      : retryClip(job)

  if (item.expandable && onToggle) {
    return (
      <div className="recording-playlist">
        <div className="recording-playlist-head">
          <button
            className="recording-caret"
            aria-label={expand.expanded ? t`Collapse` : t`Expand`}
            aria-expanded={expand.expanded}
            onClick={() => onToggle(item)}
            disabled={expand.expanding}
          >
            {expand.expanding ? (
              <span className="recording-spinner" />
            ) : (
              <Chevron open={expand.expanded} />
            )}
          </button>
          <span className="recording-title" dir="auto" title={item.title}>
            {item.title}
          </span>
        </div>
        {expand.error && (
          <div className="recordings-status recordings-status--error">{expand.error}</div>
        )}
        {expand.expanded && expand.children && (
          <div className="recording-children">
            <ChildRows items={expand.children} course={course} onReconnect={onReconnect} />
          </div>
        )}
      </div>
    )
  }

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
        <span className="recording-title" dir="auto" title={item.title}>
          {item.title}
        </span>
        {unknown && (
          <span className="chip chip--neutral" title={t`File type`}>
            {resolved ? t(RESOLVED_LABEL[resolved]) : '?'}
          </span>
        )}
      </div>

      <div className="recording-card-line">
        <span className="recording-save-label">
          <Trans>Save as</Trans>
        </span>

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

        {/* Material picks an existing lecture to attach to, so the input offers them — while
            staying free text, since the lecture may not exist yet. */}
        <input
          className="source-row-input recording-name-input"
          value={value}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestion}
          list={material ? listId : undefined}
          aria-label={material ? t`Attach material to` : t`Lecture name`}
          dir="auto"
        />
        {material && (
          <datalist id={listId}>
            {existingNames(kind, courses, course).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        )}
        {materialCount > 0 && (
          <span className="recording-material-count">
            <Plural value={materialCount} one="# material" other="# materials" />
          </span>
        )}

        {split ? (
          // Per-clip buttons own re-download/retry, so the main button is just a status label here.
          <span className="btn recording-download-btn recording-download-btn--label">
            {downloading ? t`Downloading…` : status === 'error' ? t`Failed ✗` : t`Downloaded ✓`}
          </span>
        ) : downloading ? (
          // The bars below say how far along it is, so the action reduces to naming the state.
          <span className="chip chip--accent">
            <Trans>Downloading</Trans>
          </span>
        ) : alreadyDownloaded && !failed ? (
          // Settled: the target exists, so there is nothing left to do here. Renaming the target, or
          // a failure the retry button has to stay reachable for, brings the button back.
          <span className="chip chip--ok">
            <Icon icon="check" />
            <Trans>In course</Trans>
          </span>
        ) : (
          <button
            className="btn btn--ghost recording-download-btn"
            onClick={onDownloadClick}
            disabled={pending || unsupported}
            title={unsupported ? t`Not a file the downloader can fetch` : undefined}
          >
            {pending ? (
              <span className="recording-spinner" />
            ) : failed ? (
              t`Retry ✗`
            ) : status === 'done' ? (
              t`Downloaded ✓`
            ) : (
              t`Download`
            )}
          </button>
        )}
      </div>

      <RecordingJobList
        jobs={jobs}
        split={split}
        retryingId={retryingId}
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
        />
      )}

      {passcode && <PasscodePrompt {...passcode} />}
    </div>
  )
})

export default RecordingRow

// Slices the edits map for an expanded playlist's children. Split out of RecordingRow so only
// non-leaf rows subscribe to the map — a leaf that subscribed would re-render on every keystroke
// in the section, memo or not.
function ChildRows({
  items,
  course,
  onReconnect,
}: {
  items: Item[]
  course: string
  onReconnect: () => void
}) {
  const edits = useRowEdits()
  return (
    <>
      {items.map((child) => (
        <RecordingRow
          key={child.ref}
          item={child}
          edit={edits[child.ref]}
          course={course}
          onReconnect={onReconnect}
        />
      ))}
    </>
  )
}
