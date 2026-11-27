import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import Tooltip from '@/shared/components/Tooltip'
import ServiceError from '@/shared/components/ServiceError'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import {
  cancelImport,
  retryImport,
  useImportEntries,
  type ImportEntry,
} from '@/features/downloads/contexts/ManualImportsContext'
import { canCancelImport, formatBytes, percentOf } from '@/features/downloads/utils/fileImport'
import '@/styles/pipeline-card.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/shared/components/ProgressBar.css'
import './RecordingRow.css'
import './RecordingJobList.css'
import './ManualDownload.css'

// The session's local-file imports, newest first, above the link cards.
export default function ManualImportList() {
  const entries = useImportEntries()
  if (!entries.length) return null
  return (
    <div className="manual-download-jobs">
      {entries.map((entry) => (
        <ImportRow key={entry.key} entry={entry} />
      ))}
    </div>
  )
}

// A determinate bar: the ETA `ProgressBar` has no notion of bytes done.
function ImportProgress({ copied, total }: { copied: number; total: number }) {
  const { t } = useLingui()
  const pct = percentOf(copied, total)
  const started = copied > 0
  return (
    <div className="progress-wrap recording-progress">
      <div
        className={`progress-track${started ? '' : ' progress-track--pulse'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {started && <div className="progress-fill" style={{ width: `${pct}%` }} />}
      </div>
      <p className="progress-label">
        {started
          ? t`${pct}% · ${ltr(formatBytes(copied))} of ${ltr(formatBytes(total))}`
          : t`Starting…`}
      </p>
    </div>
  )
}

// A size keeps its "12 MB" order inside a Hebrew sentence (LRI … PDI).
const ltr = (value: string) => `\u2066${value}\u2069`

function ImportRow({ entry }: { entry: ImportEntry }) {
  const { t } = useLingui()
  const { status: runner } = useRunnerStatus()
  const [cancelling, setCancelling] = useState(false)
  const { lecture, course, kind, mode, status, file } = entry
  const cancellable = canCancelImport(entry.copied, entry.total)
  const busy = isLectureRenameLocked(runner, course, lecture, kind)
  return (
    <div
      className={[
        'recording-card',
        status === 'running' && 'recording-card--downloading',
        status === 'done' && 'recording-card--downloaded',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="recording-card-line">
        <Tooltip content={lecture}>
          <span className="recording-title" dir="auto">
            {lecture}
          </span>
        </Tooltip>
        <span className="manual-download-meta" dir="auto">
          · {course}
        </span>
        {status === 'running' && (
          <>
            <span className="chip chip--accent">
              {mode === 'move' ? <Trans>Moving</Trans> : <Trans>Copying</Trans>}
            </span>
            <Tooltip
              content={
                cancelling
                  ? t`Cancelling...`
                  : cancellable
                    ? undefined
                    : t`Can't cancel: the file is already copied, finishing up`
              }
            >
              <button
                className="btn btn--ghost"
                disabled={cancelling || !cancellable}
                onClick={() => {
                  setCancelling(true)
                  cancelImport(entry.key)
                }}
              >
                <Trans>Cancel</Trans>
              </button>
            </Tooltip>
          </>
        )}
        {status === 'done' && (
          <span className="chip chip--ok">
            <Trans>Imported ✓</Trans>
          </span>
        )}
        {status === 'cancelled' && (
          <span className="chip chip--neutral recording-cancelled">
            <Trans>Cancelled</Trans>
          </span>
        )}
        {status === 'error' && (
          <Tooltip
            content={
              busy
                ? t`Can't replace the video while it's being processed or waiting in line`
                : undefined
            }
          >
            <button
              className="btn btn--ghost recording-download-btn"
              disabled={busy}
              onClick={() => {
                setCancelling(false)
                retryImport(entry.key)
              }}
            >
              {t`Retry ✗`}
            </button>
          </Tooltip>
        )}
      </div>
      <div className="manual-download-url-line" dir="auto">
        {file.name}
      </div>
      {status === 'running' && <ImportProgress copied={entry.copied} total={entry.total} />}
      {status === 'done' && entry.originalKept && (
        <div className="manual-download-note">
          <Trans>Couldn't remove the original file. It's still in its folder.</Trans>
        </div>
      )}
      {status === 'error' && entry.failure && (
        <div className="manual-download-error">
          <ServiceError failure={entry.failure} />
        </div>
      )}
    </div>
  )
}
