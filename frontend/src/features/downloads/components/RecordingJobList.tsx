import Tooltip from '@/shared/components/Tooltip'
import { Trans, useLingui } from '@lingui/react/macro'
import type { TimingStats } from '@/types'
import { useState } from 'react'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { toast } from '@/services/toaster'
import { useSettingsContext } from '@/shared/contexts/SettingsContext'
import { restartJob } from '@/features/downloads/services/downloadServer'
import { followRestartedJob } from '@/features/downloads/contexts/ManualDownloadsContext'
import { restartFailure } from '@/features/downloads/utils/downloadErrors'
import { stallLatched, stallWho } from '@/features/downloads/utils/stallNote'
import { useTimingStats } from '@/shared/hooks/useTimingStats'
import ProgressBar from '@/shared/components/ProgressBar'
import type { JobProgress, JobState } from '@/features/downloads/contexts/DownloadJobsContext'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/shared/components/ProgressBar.css'
import './RecordingRow.css'
import '@/styles/chip.css'
import './RecordingJobList.css'

const NO_ESTIMATE: TimingStats = { message: 'not-enough-data' }

// One job's row: an ETA bar while running, else (only when `retry` is supplied) a per-clip
// retry/re-download button. Owns its own `useTimingStats` call; the manual form renders it too.
export function JobProgressBar({
  job,
  showTitle,
  retry,
  stallNote = true,
}: {
  // Only what a bar shows, so a folder job — no course, no kind — renders one too.
  job: Pick<
    JobState,
    'id' | 'title' | 'status' | 'startedAt' | 'expectedBytes' | 'operation' | 'stalled' | 'source'
  >
  showTitle: boolean
  // `locked` is why the button is disabled while the Moodle lock is busy, undefined when it is free.
  retry?: { onRetry: () => void; busy: boolean; locked?: string }
  // False where the bar is too narrow for the note (the sidebar placeholder).
  stallNote?: boolean
}) {
  const { t } = useLingui()
  const sized = job.expectedBytes != null
  const stats = useTimingStats(sized ? job.operation : null, job.expectedBytes ?? 0)
  const title = showTitle && (
    <Tooltip content={job.title}>
      <span className="recording-progress-title" dir="auto">
        {job.title}
      </span>
    </Tooltip>
  )
  // Terminal: offer a per-clip retry when the row wants one (a multi-clip recording); a lone job's
  // retry lives on the main row button instead, so it renders nothing here. A cancelled clip is
  // neutral: a chip naming it and a plain Download, never a Retry.
  if (job.status !== 'running') {
    if (!retry) return null
    return (
      <div className="recording-progress-job recording-progress-job--action">
        {title}
        {job.status === 'cancelled' && (
          <span className="chip chip--neutral recording-cancelled">
            <Trans>Cancelled</Trans>
          </span>
        )}
        <Tooltip content={retry.locked}>
          <button
            className="btn btn--ghost recording-job-btn"
            onClick={retry.onRetry}
            disabled={retry.busy || retry.locked !== undefined}
          >
            {retry.busy ? (
              <span className="recording-spinner" />
            ) : job.status === 'error' ? (
              t`Retry ✗`
            ) : job.status === 'cancelled' ? (
              t`Download`
            ) : (
              t`Re-download ↻`
            )}
          </button>
        </Tooltip>
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
      {stallNote && stallLatched(job) && (
        <StallNote id={job.id} title={job.title} source={job.source} />
      )}
    </div>
  )
}

// A single running download that stopped receiving bytes: who is slow, and a Restart that starts it
// over. The new id supersedes this one, so a manual card is pointed at it; rows follow by target.
function StallNote({
  id,
  title,
  source,
}: {
  id: string
  title: string
  source: JobState['source']
}) {
  const { t } = useLingui()
  const { settings } = useSettingsContext()
  const [busy, setBusy] = useState(false)
  const who = stallWho(source, settings?.moodleSite)
  const text =
    who === 'lemida'
      ? t`Lemida is responding slowly. Restart could help.`
      : who === 'university'
        ? t`University is responding slowly. Restart could help.`
        : t`Server is responding slowly. Restart could help.`
  async function restart() {
    setBusy(true)
    try {
      followRestartedJob(id, await restartJob(id))
    } catch (err) {
      const failure = restartFailure(err)
      if (failure) toast('error', serviceErrorNode(failure, title))
    }
    setBusy(false)
  }
  return (
    <div className="recording-stall-note">
      <span>{text}</span>
      <button
        className="btn btn--ghost recording-job-btn"
        onClick={() => void restart()}
        disabled={busy}
      >
        {busy ? (
          <span className="recording-spinner" />
        ) : (
          t({ message: 'Restart', context: 'download' })
        )}
      </button>
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
