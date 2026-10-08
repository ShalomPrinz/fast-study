import { useLingui } from '@lingui/react/macro'
import type { TimingStats } from '@/types'
import { useTimingStats } from '@/shared/hooks/useTimingStats'
import ProgressBar from '@/shared/components/ProgressBar'
import type { JobProgress, JobState } from '@/features/downloads/contexts/DownloadJobsContext'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/shared/components/ProgressBar.css'
import './RecordingRow.css'
import './RecordingJobList.css'

const NO_ESTIMATE: TimingStats = { message: 'not-enough-data' }

// One job's row: an ETA bar while running, else (only when `retry` is supplied) a per-clip
// retry/re-download button. Owns its own `useTimingStats` call; the manual form renders it too.
export function JobProgressBar({
  job,
  showTitle,
  retry,
}: {
  job: JobState
  showTitle: boolean
  // `locked` is why the button is disabled while the Moodle lock is busy, undefined when it is free.
  retry?: { onRetry: () => void; busy: boolean; locked?: string }
}) {
  const { t } = useLingui()
  const sized = job.expectedBytes != null
  const stats = useTimingStats(sized ? job.operation : null, job.expectedBytes ?? 0)
  const title = showTitle && (
    <span className="recording-progress-title" dir="auto" title={job.title}>
      {job.title}
    </span>
  )
  // Terminal: offer a per-clip retry when the row wants one (a multi-clip recording); a lone job's
  // retry lives on the main row button instead, so it renders nothing here.
  if (job.status !== 'running') {
    if (!retry) return null
    return (
      <div className="recording-progress-job recording-progress-job--action">
        {title}
        <button
          className="btn btn--ghost recording-job-btn"
          onClick={retry.onRetry}
          disabled={retry.busy || retry.locked !== undefined}
          title={retry.locked}
        >
          {retry.busy ? (
            <span className="recording-spinner" />
          ) : job.status === 'error' ? (
            t`Retry ✗`
          ) : (
            t`Re-download ↻`
          )}
        </button>
      </div>
    )
  }
  // Queued (no start time, no size) → null → "Estimating…"; running without a size → "Not enough data".
  return (
    <div className="recording-progress-job">
      {title}
      <ProgressBar
        className="recording-progress"
        stats={job.startedAt == null ? null : sized ? stats : NO_ESTIMATE}
        startedAt={job.startedAt ?? 0}
      />
    </div>
  )
}

// One bar or per-clip button per job; nothing unless a job runs or the row is split. A lone job
// retries from the main row button.
export default function RecordingJobList({
  jobs,
  split,
  retryingId,
  lockedTitle,
  onClipAction,
}: {
  jobs: readonly JobProgress[]
  split: boolean
  retryingId: string | null
  lockedTitle?: string
  onClipAction: (job: JobProgress) => void
}) {
  if (!(jobs.length > 1 || jobs.some((j) => j.status === 'running'))) return null
  return (
    <div className="recording-progress-list">
      {jobs.map((job) => (
        <JobProgressBar
          key={job.id}
          job={job}
          showTitle={jobs.length > 1}
          retry={
            split
              ? {
                  onRetry: () => onClipAction(job),
                  busy: retryingId === job.id,
                  locked: lockedTitle,
                }
              : undefined
          }
        />
      ))}
    </div>
  )
}
