import { memo, useId, useState } from 'react'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import type { Item, ResolvedMedia } from '@/features/downloads/services/autoDownloader'
import PasscodePrompt from './PasscodePrompt'
import RecordingJobList from './RecordingJobList'
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'
import { rowStatus, useRowJobs } from '@/features/downloads/contexts/DownloadJobsContext'
import type { RowEdit } from '@/features/downloads/contexts/RowEditsContext'
import { useRowEdit, useRowEdits } from '@/features/downloads/contexts/RowEditsContext'
import {
  existingNames,
  hasResource,
  materialsOf,
  splitSiblings,
} from '@/features/downloads/utils/existingItems'
import { useRecordingDownload } from '@/features/downloads/hooks/useRecordingDownload'
import '@/styles/source-row.css'
import '@/features/downloads/DownloadsView.css'
import './RecordingRow.css'

// Driven by SectionGroup — the bulk queue needs the same children cache.
export interface ExpandControl {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
  onToggle: () => void
}

interface Props {
  item: Item
  edit: RowEdit | undefined
  course: string
  onReconnect: () => void
  expand?: ExpandControl
}

// The resolved-type column's copy; an unresolved 'unknown' row shows '?'.
const RESOLVED_LABEL: Record<ResolvedMedia, string> = {
  video: 'Video',
  material: 'Material',
  unsupported: 'Unsupported',
}

// One discovered recording; an expandable one renders each child as a recursive RecordingRow.
// Memoized on its own `edit` slice, so typing in one row leaves its siblings untouched.
const RecordingRow = memo(function RecordingRow({
  item,
  edit,
  course,
  onReconnect,
  expand,
}: Props) {
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
  // Live tree, so a completed download's SSE refresh flips the row green.
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
        message: `${effectiveName} already exists in ${course}. Download again and overwrite?`,
        run: download,
      })
      return
    }
    const siblings = splitSiblings(effectiveName, kind, courses, course)
    if (siblings.length)
      setConfirm({
        message: `${effectiveName} may split into parts that overwrite existing ${siblings.join(', ')} in ${course}. Download anyway?`,
        run: download,
      })
    else download()
  }

  // A per-clip button in a split row: a done clip overwrites, so confirm naming that clip; an
  // errored clip downloaded nothing to overwrite, so retry straight away (mirrors the main button).
  const onClipAction = (job: JobProgress) =>
    job.status === 'done'
      ? setConfirm({
          message: `${job.title} already exists in ${course}. Download again and overwrite?`,
          run: () => retryClip(job),
        })
      : retryClip(job)

  if (item.expandable && expand) {
    return (
      <div className="recording-expandable">
        <div className="recording-row recording-row--expandable">
          <button
            className="recording-caret"
            aria-label={expand.expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expand.expanded}
            onClick={expand.onToggle}
            disabled={expand.expanding}
          >
            {expand.expanding ? (
              <span className="recording-spinner recording-spinner--dark" />
            ) : expand.expanded ? (
              '▾'
            ) : (
              '▸'
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
    <div className="recording-entry">
      <div
        className={[
          'recording-row',
          alreadyDownloaded && 'recording-row--downloaded',
          unsupported && 'recording-row--unsupported',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="recording-title" dir="auto" title={item.title}>
          {item.title}
        </span>

        {unknown && (
          <span className="recording-media" title="File type">
            {resolved ? RESOLVED_LABEL[resolved] : '?'}
          </span>
        )}

        <div className="kind-toggle">
          <button
            className={
              kind === 'lecture' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'
            }
            onClick={() => setKind('lecture')}
          >
            Lecture
          </button>
          <button
            className={
              kind === 'recitation' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'
            }
            onClick={() => setKind('recitation')}
          >
            Recitation
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
          aria-label={material ? 'Attach material to' : 'Lecture name'}
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
            {materialCount} material{materialCount > 1 ? 's' : ''}
          </span>
        )}

        {split ? (
          // Per-clip buttons own re-download/retry, so the main button is just a status label here.
          <span className="source-row-btn recording-download-btn recording-download-btn--label">
            {downloading ? 'Downloading…' : status === 'error' ? 'Failed ✗' : 'Downloaded ✓'}
          </span>
        ) : (
          <button
            className="source-row-btn recording-download-btn"
            onClick={onDownloadClick}
            disabled={pending || downloading || unsupported}
            title={unsupported ? 'Not a file the downloader can fetch' : undefined}
          >
            {pending ? (
              <span className="recording-spinner" />
            ) : downloading ? (
              'Downloading…'
            ) : queueFailed || status === 'error' ? (
              'Retry ✗'
            ) : status === 'done' ? (
              'Downloaded ✓'
            ) : (
              'Download'
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
