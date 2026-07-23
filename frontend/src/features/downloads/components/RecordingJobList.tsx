import type { TimingStats } from '@/types'
import { useTimingStats } from '@/shared/hooks/useTimingStats'
import ProgressBar from '@/shared/components/ProgressBar'
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'

const NO_ESTIMATE: TimingStats = { message: 'not-enough-data' }

// One job's row: an ETA bar while running, else (only when `retry` is supplied) a per-clip
// retry/re-download button. Owns its own `useTimingStats` call.
function JobProgressBar({
  job,
  showTitle,
  retry,
}: {
  job: JobProgress
  showTitle: boolean
  retry?: { onRetry: () => void; busy: boolean }
}) {
  const sized = job.expectedBytes != null
  const stats = useTimingStats(sized ? job.operation : null, job.expectedBytes ?? 0)
  const title = showTitle && (
    <span className="recording-progress-title" dir="auto" title={job.title}>{job.title}</span>
  )
  // Terminal: offer a per-clip retry when the row wants one (a multi-clip recording); a lone job's
  // retry lives on the main row button instead, so it renders nothing here.
  if (job.status !== 'running') {
    if (!retry) return null
    return (
      <div className="recording-progress-job recording-progress-job--action">
        {title}
        <button className="source-row-btn recording-job-btn" onClick={retry.onRetry} disabled={retry.busy}>
          {retry.busy ? (
            <span className="recording-spinner" />
          ) : job.status === 'error' ? (
            'Retry ✗'
          ) : (
            'Re-download ↻'
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

// The row's per-job block: one bar (or per-clip button) per download job. Renders nothing unless a
// job is running or the recording fans out to more than one clip. Per-clip retry buttons show only
// when `split`, since a lone job retries via the main row button.
export default function RecordingJobList({
  jobs,
  split,
  retryingId,
  onClipAction,
}: {
  jobs: JobProgress[]
  split: boolean
  retryingId: string | null
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
          retry={split ? { onRetry: () => onClipAction(job), busy: retryingId === job.id } : undefined}
        />
      ))}
    </div>
  )
}
