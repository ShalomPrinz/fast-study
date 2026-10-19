import { useState } from 'react'
import Tooltip from '@/shared/components/Tooltip'
import { Trans, useLingui } from '@lingui/react/macro'
import ServiceError, { serviceErrorNode } from '@/shared/components/ServiceError'
import { toast } from '@/services/toaster'
import { useFolderJobs } from '@/features/downloads/contexts/DownloadJobsContext'
import { cancelJob } from '@/features/downloads/services/downloadServer'
import type { FolderJob } from '@/features/downloads/services/downloadServer'
import { cancelFailure } from '@/features/downloads/utils/downloadErrors'
import { JobProgressBar } from './RecordingJobList'
import '@/styles/pipeline-card.css'
import '@/styles/source-row.css'
import '@/styles/chip.css'
import '@/styles/button.css'
import './RecordingRow.css'
import './RecordingJobList.css'
import './ManualDownload.css'
import './FolderJobList.css'

// The Extension tab's "General video" downloads into a computer folder, carded like the manual form's
// jobs; a done one leaves with the server's bridge. See docs/JOBS.md §Folder jobs.
export default function FolderJobList() {
  const jobs = useFolderJobs()
  if (!jobs.length) return null
  return (
    <section className="folder-jobs">
      <h2 className="section-title">
        <Trans>Downloads to a folder</Trans>
      </h2>
      <div className="manual-download-jobs">
        {jobs.map((job) => (
          <FolderJobRow key={job.id} job={job} />
        ))}
      </div>
    </section>
  )
}

function FolderJobRow({ job }: { job: FolderJob }) {
  const { t } = useLingui()
  const name = job.fileName
  const running = job.status === 'queued' || job.status === 'running'
  const [cancelling, setCancelling] = useState(false)

  // The row turns `cancelled` through the usual job ping; only a real refusal toasts.
  async function cancel() {
    setCancelling(true)
    try {
      await cancelJob(job.id)
    } catch (err) {
      const failure = cancelFailure(err)
      if (failure) toast('error', serviceErrorNode(failure, name))
    }
    setCancelling(false)
  }
  const failure =
    job.status === 'error' && job.message
      ? { message: job.message, code: job.code, params: job.params }
      : null
  return (
    <div
      className={[
        'recording-card',
        running && 'recording-card--downloading',
        job.status === 'done' && 'recording-card--downloaded',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="recording-card-line">
        <Tooltip content={job.fileName}>
          <span className="recording-title" dir="auto">
            {job.fileName}
          </span>
        </Tooltip>
        {job.status === 'queued' && (
          <span className="chip chip--neutral">
            <Trans>Queued</Trans>
          </span>
        )}
        {job.status === 'running' && (
          <span className="chip chip--accent">
            <Trans>Downloading</Trans>
          </span>
        )}
        {job.status === 'done' && (
          <span className="chip chip--ok">
            <Trans>Downloaded ✓</Trans>
          </span>
        )}
        {job.status === 'cancelled' && (
          <span className="chip chip--neutral recording-cancelled">
            <Trans>Cancelled</Trans>
          </span>
        )}
        {running && (
          <button
            className="btn btn--ghost recording-download-btn"
            onClick={() => void cancel()}
            disabled={cancelling}
          >
            {cancelling ? <span className="recording-spinner" /> : t`Cancel`}
          </button>
        )}
      </div>
      <Tooltip content={job.folder}>
        <div className="manual-download-url-line" dir="ltr">
          {job.folder}
        </div>
      </Tooltip>

      {running && (
        <div className="recording-progress-list">
          <JobProgressBar
            job={{
              title: job.fileName,
              status: 'running',
              startedAt: job.startedAt,
              expectedBytes: job.expectedBytes,
              operation: job.operation,
            }}
            showTitle={false}
          />
        </div>
      )}

      {job.status === 'error' && (
        <div className="manual-download-error">
          {failure ? (
            <ServiceError failure={failure} />
          ) : (
            t`Couldn't download "${name}". Try again.`
          )}
        </div>
      )}
    </div>
  )
}
