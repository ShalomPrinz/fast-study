import Tooltip from '@/shared/components/Tooltip'
import { useId, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import ServiceError from '@/shared/components/ServiceError'
import { createCourse } from '@/services/database'
import { jobState, useJobById } from '@/features/downloads/contexts/DownloadJobsContext'
import type { ManualEntry } from '@/features/downloads/contexts/ManualDownloadsContext'
import {
  addManualEntry,
  retargetManualEntry,
  updateManualDraft,
  useManualDraft,
  useManualEntries,
} from '@/features/downloads/contexts/ManualDownloadsContext'
import { hasResource, overwritesVideo } from '@/features/downloads/utils/existingItems'
import {
  manualStatus,
  matchCourse,
  suggestManualName,
} from '@/features/downloads/utils/manualDownload'
import {
  manualFailureHeadline,
  moodleBusyMessage,
  toastDownloadError,
} from '@/features/downloads/utils/downloadErrors'
import { useManualStart } from '@/features/downloads/hooks/useManualStart'
import { JobProgressBar } from './RecordingJobList'
import CourseCombobox from './CourseCombobox'
import '@/styles/pipeline-card.css'
import '@/styles/source-row.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/segmented.css'
import './RecordingRow.css'
import './RecordingJobList.css'
import './ManualDownload.css'

// The Downloads page's Manual tab: a "paste a link" form for any video that opens without signing in.
// auto routes it (Moodle-site links under the Moodle lock, others through yt-dlp); see docs/DOWNLOADS.md.
export default function ManualDownload() {
  return (
    <section className="manual-download">
      <p className="manual-download-warning">
        <Trans>Works only for video links, and only if they open without signing in.</Trans>
      </p>
      <ManualForm />
      <ManualJobList />
    </section>
  )
}

function ManualForm() {
  const { t } = useLingui()
  const id = useId()
  const { courses } = useCourseTreeContext()
  const entries = useManualEntries()
  const active = courses.filter((c) => !c.archived)
  // In the module store, so a trip to another page keeps what was typed; null fields follow defaults.
  const { url, course: typed, kind, name } = useManualDraft()
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const { locked: lockedFor, start } = useManualStart()

  const courseText = typed ?? active[0]?.name ?? ''
  const existing = matchCourse(active, courseText)
  const course = existing ?? courseText.trim()
  const claimed = entries.map((e) => ({ ...e.target, kind: e.request.kind }))
  const lecture = name ?? (course ? suggestManualName(courses, course, kind, claimed) : '')
  const locked = lockedFor(url)
  const ready = !!url.trim() && !!course && !!lecture.trim() && !pending && !locked

  async function submit() {
    const request = { url: url.trim(), course, lecture: lecture.trim(), kind }
    setPending(true)
    // A name no active course has is a new course; an archived one answers `name_taken`.
    if (!existing) {
      try {
        await createCourse(course)
      } catch (err) {
        toastDownloadError(course, err)
        setPending(false)
        return
      }
    }
    try {
      const { jobId, target } = await start(request)
      addManualEntry(request, jobId, target)
      // The link stays whatever happens: it is cleared only by the user.
      updateManualDraft({ name: null })
    } catch (err) {
      toastDownloadError(request.lecture, err)
    }
    setPending(false)
  }

  // A video PUT wipes the lecture's transcript and summary, so replacing one confirms first.
  function onDownload() {
    if (!ready) return
    if (overwritesVideo({ media: 'video' }, lecture.trim(), kind, courses, course)) setConfirm(true)
    else void submit()
  }

  return (
    <div className="manual-download-form">
      <div className="manual-download-field manual-download-url">
        <label className="manual-download-label" htmlFor={`${id}-url`}>
          <Trans>Video link</Trans>
        </label>
        <input
          id={`${id}-url`}
          className="source-row-input"
          value={url}
          onChange={(e) => updateManualDraft({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onDownload()
          }}
          dir="auto"
        />
      </div>
      <div className="manual-download-field manual-download-course">
        <label className="manual-download-label" htmlFor={`${id}-course`}>
          <Trans>Course</Trans>
        </label>
        {/* Free text with the active courses as suggestions: a name none of them has is a new course. */}
        <CourseCombobox
          id={`${id}-course`}
          value={courseText}
          options={active.map((c) => c.name)}
          onChange={(course) => updateManualDraft({ course })}
        />
      </div>
      {/* Buttons, not an input, so the caption names the group rather than a control. */}
      <div className="manual-download-field" role="group" aria-labelledby={`${id}-kind`}>
        <span className="manual-download-label" id={`${id}-kind`}>
          <Trans>Type</Trans>
        </span>
        <div className="mode-toggle mode-toggle--light">
          <button
            className={kind === 'lecture' ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
            onClick={() => updateManualDraft({ kind: 'lecture' })}
          >
            <Trans>Lecture</Trans>
          </button>
          <button
            className={kind === 'recitation' ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
            onClick={() => updateManualDraft({ kind: 'recitation' })}
          >
            <Trans>Recitation</Trans>
          </button>
        </div>
      </div>
      <div className="manual-download-field manual-download-name">
        <label className="manual-download-label" htmlFor={`${id}-name`}>
          <Trans>Name in the course</Trans>
        </label>
        <input
          id={`${id}-name`}
          className="source-row-input"
          value={lecture}
          onChange={(e) => updateManualDraft({ name: e.target.value })}
          dir="auto"
        />
      </div>
      <Tooltip content={locked ? moodleBusyMessage() : undefined}>
        <button className="btn btn--primary" onClick={onDownload} disabled={!ready}>
          {pending ? <span className="recording-spinner" /> : t`Download`}
        </button>
      </Tooltip>

      {confirm && (
        <ConfirmModal
          message={t`${lecture} already exists in ${course}. Download again and overwrite?`}
          onConfirm={() => {
            setConfirm(false)
            void submit()
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

function ManualJobList() {
  const entries = useManualEntries()
  if (!entries.length) return null
  return (
    <div className="manual-download-jobs">
      {entries.map((entry) => (
        <ManualJobRow key={entry.key} entry={entry} />
      ))}
    </div>
  )
}

// One manual download, rendered like a discovery card: a bar while running, the outcome after.
function ManualJobRow({ entry }: { entry: ManualEntry }) {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const job = useJobById(entry.jobId)
  const [retrying, setRetrying] = useState(false)
  const { locked: lockedFor, start } = useManualStart()
  const locked = lockedFor(entry.request.url)
  const { course, lecture } = entry.target
  const kind = entry.request.kind
  const landed = hasResource({ media: 'video' }, lecture, kind, courses, course)
  const status = manualStatus(job, landed)
  const failure =
    job?.status === 'error' && job.message
      ? { message: job.message, code: job.code, params: job.params }
      : null

  // Re-posts the same body; the server supersedes the failed job with a new one.
  async function retry() {
    setRetrying(true)
    try {
      const next = await start(entry.request)
      retargetManualEntry(entry.key, next.jobId, next.target)
    } catch (err) {
      toastDownloadError(lecture, err)
    }
    setRetrying(false)
  }

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
          {course}
        </span>
        {status === 'queued' && (
          <span className="chip chip--neutral">
            <Trans>Queued</Trans>
          </span>
        )}
        {status === 'running' && (
          <span className="chip chip--accent">
            <Trans>Downloading</Trans>
          </span>
        )}
        {status === 'done' && (
          <span className="chip chip--ok">
            <Trans>Downloaded ✓</Trans>
          </span>
        )}
        {status === 'cancelled' && (
          <span className="chip chip--neutral recording-cancelled">
            <Trans>Cancelled</Trans>
          </span>
        )}
        {status === 'error' && (
          <Tooltip content={locked ? moodleBusyMessage() : undefined}>
            <button
              className="btn btn--ghost recording-download-btn"
              onClick={() => void retry()}
              disabled={retrying || locked}
            >
              {retrying ? <span className="recording-spinner" /> : t`Retry ✗`}
            </button>
          </Tooltip>
        )}
      </div>
      <Tooltip content={entry.request.url}>
        <div className="manual-download-url-line" dir="ltr">
          {entry.request.url}
        </div>
      </Tooltip>

      {status === 'running' && job && (
        <div className="recording-progress-list">
          <JobProgressBar job={jobState(job)} showTitle={false} />
        </div>
      )}

      {status === 'error' && (
        <div className="manual-download-error">
          {failure ? (
            <ServiceError failure={failure} headline={manualFailureHeadline(failure)} />
          ) : (
            t`Couldn't download "${lecture}". Try again.`
          )}
        </div>
      )}
    </div>
  )
}
