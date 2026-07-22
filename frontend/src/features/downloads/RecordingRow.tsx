import { useState } from 'react'
import type { TimingStats } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useTimingStats } from '@/shared/hooks/useTimingStats'
import ConfirmModal from '@/shared/components/ConfirmModal'
import ProgressBar from '@/shared/components/ProgressBar'
import type { Item, PasscodeError } from './services/autoDownloader'
import {
  downloadItem,
  isPasscodeError,
  isReconnectError,
  saveZoomPasscode,
} from './services/autoDownloader'
import PasscodePrompt from './PasscodePrompt'
import type { JobProgress } from './contexts/DownloadJobsContext'
import { rowStatus, useDownloadJobs } from './contexts/DownloadJobsContext'
import { useRowEdit } from './contexts/RowEditsContext'
import { isDownloaded } from './utils/nameSuggestion'
import { toastDownloadError } from './utils/downloadErrors'

type Result = 'fail' | null

const NO_ESTIMATE: TimingStats = { message: 'not-enough-data' }

// One job's ETA bar with its own `useTimingStats` call
function JobProgressBar({ job, showTitle }: { job: JobProgress; showTitle: boolean }) {
  const sized = job.expectedBytes != null
  const stats = useTimingStats(sized ? job.operation : null, job.expectedBytes ?? 0)
  // Per-job visibility so bar vanishes the instant its own clip is done/errored, independent of siblings
  if (job.status !== 'running') return null
  // Queued (no start time, no size) → null → "Estimating…"; running without a size → "Not enough data".
  return (
    <div className="recording-progress-job">
      {showTitle && <span className="recording-progress-title" dir="auto" title={job.title}>{job.title}</span>}
      <ProgressBar
        className="recording-progress"
        stats={job.startedAt == null ? null : sized ? stats : NO_ESTIMATE}
        startedAt={job.startedAt ?? 0}
      />
    </div>
  )
}

// Owned by SectionGroup — the bulk queue needs the same children cache.
export interface ExpandControl {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
  onToggle: () => void
}

interface Props {
  item: Item
  course: string
  onReconnect: () => void
  expand?: ExpandControl
}

// One discovered recording; an expandable one renders each child as a recursive RecordingRow.
export default function RecordingRow({ item, course, onReconnect, expand }: Props) {
  const { courses } = useCourseTreeContext()
  // Name/kind live in SectionGroup so this row and the bulk queue agree.
  const { kind, suggestion, value, name: effectiveName, setName, setKind } = useRowEdit(item, course)
  const { progressOf } = useDownloadJobs()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [confirming, setConfirming] = useState(false)

  // Opened on a 409 passcode gate. Never co-renders with the overwrite confirm, which is
  // already dismissed by the time download() can hit the 409.
  const [passcodePrompt, setPasscodePrompt] = useState(false)
  const [passcodeReason, setPasscodeReason] = useState<PasscodeError['reason']>('missing')

  // Live tree, so a completed download's SSE refresh flips the row green.
  const alreadyDownloaded = isDownloaded(effectiveName, kind, courses, course)

  // The 200 from /download-item only queued the work; these are the actual downloads (one bar each),
  // grouped by this row's `ref` — so a download still running after a page reload re-attaches for free.
  const jobs = progressOf(item.ref)
  const status = rowStatus(jobs)
  const downloading = status === 'running'
  const failed = result === 'fail' || status === 'error'

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
            ) : expand.expanded ? '▾' : '▸'}
          </button>
          <span className="recording-title" dir="auto" title={item.title}>{item.title}</span>
        </div>
        {expand.error && (
          <div className="recordings-status recordings-status--error">{expand.error}</div>
        )}
        {expand.expanded && expand.children && (
          <div className="recording-children">
            {expand.children.map((child) => (
              <RecordingRow key={child.ref} item={child} course={course} onReconnect={onReconnect} />
            ))}
          </div>
        )}
      </div>
    )
  }

  async function download() {
    setConfirming(false)
    setPending(true)
    setResult(null)
    try {
      const started = await downloadItem({ ref: item.ref, course, name: effectiveName, kind })
      // Success is the jobs' to report — the snapshot ping drives the row into flight. Only a
      // failure to queue is the trigger's to surface.
      if (!started) {
        setResult('fail')
        toastDownloadError(effectiveName)
      }
    } catch (err) {
      // Reconnect and passcode steer the UI elsewhere, so only the fallthrough toasts.
      if (isReconnectError(err)) onReconnect()
      else if (isPasscodeError(err)) {
        // Prompt instead of failing; the finally clears the spinner while the user types.
        setPasscodeReason(err.reason)
        setPasscodePrompt(true)
      } else {
        setResult('fail')
        toastDownloadError(effectiveName, err)
      }
    } finally {
      setPending(false)
    }
  }

  // pending stays true across save→retry so the spinner never flashes off.
  async function submitPasscode(passcode: string, scope: 'course' | 'lecture') {
    if (!passcode) return
    setPending(true)
    try {
      await saveZoomPasscode({ course, name: effectiveName, passcode, scope })
    } catch (err) {
      setResult('fail')
      toastDownloadError(effectiveName, err)
      setPasscodePrompt(false)
      setPending(false)
      return
    }
    setPasscodePrompt(false)
    await download()
  }

  function cancelPasscode() {
    setPasscodePrompt(false)
    setResult('fail')
  }

  // Re-downloading overwrites existing videos, so confirm first.
  function onDownloadClick() {
    if (alreadyDownloaded || status === 'done') setConfirming(true)
    else download()
  }

  return (
    <div className="recording-entry">
      <div className={alreadyDownloaded ? 'recording-row recording-row--downloaded' : 'recording-row'}>
      <span className="recording-title" dir="auto" title={item.title}>{item.title}</span>

      <div className="kind-toggle">
        <button
          className={kind === 'lecture' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'}
          onClick={() => setKind('lecture')}
        >
          Lecture
        </button>
        <button
          className={kind === 'recitation' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'}
          onClick={() => setKind('recitation')}
        >
          Recitation
        </button>
      </div>

      <input
        className="source-row-input recording-name-input"
        value={value}
        onChange={(e) => setName(e.target.value)}
        placeholder={suggestion}
        dir="auto"
      />

      <button
        className="source-row-btn recording-download-btn"
        onClick={onDownloadClick}
        disabled={pending || downloading}
      >
        {pending ? (
          <span className="recording-spinner" />
        ) : downloading ? (
          'Downloading…'
        ) : failed ? (
          'Retry ✗'
        ) : status === 'done' ? (
          'Downloaded ✓'
        ) : (
          'Download'
        )}
      </button>
      </div>

      {jobs.some((j) => j.status === 'running') && (
        <div className="recording-progress-list">
          {jobs.map((job) => (
            <JobProgressBar key={job.id} job={job} showTitle={jobs.length > 1} />
          ))}
        </div>
      )}

      {confirming && (
        <ConfirmModal
          message={`${effectiveName} already exists in ${course}. Download again and overwrite?`}
          onConfirm={download}
          onCancel={() => setConfirming(false)}
        />
      )}

      {passcodePrompt && (
        <PasscodePrompt
          reason={passcodeReason}
          busy={pending}
          onSubmit={submitPasscode}
          onCancel={cancelPasscode}
        />
      )}
    </div>
  )
}
