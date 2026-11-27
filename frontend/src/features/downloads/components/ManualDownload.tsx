import Tooltip from '@/shared/components/Tooltip'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import ServiceError from '@/shared/components/ServiceError'
import { createCourse } from '@/services/database'
import { runtimeBridge } from '@/services/runtime'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import { jobState, useJobById } from '@/features/downloads/contexts/DownloadJobsContext'
import type { ManualEntry } from '@/features/downloads/contexts/ManualDownloadsContext'
import {
  addManualEntry,
  retargetManualEntry,
  updateManualDraft,
  useManualDraft,
  useManualEntries,
} from '@/features/downloads/contexts/ManualDownloadsContext'
import {
  claimedByImports,
  startImport,
  useImportEntries,
} from '@/features/downloads/contexts/ManualImportsContext'
import {
  classifyDrop,
  importBlocker,
  importRoute,
  importsInto,
  pathOf,
  type ImportBlocker,
  type ImportMode,
} from '@/features/downloads/utils/fileImport'
import ManualFileSource, { useRejectedDrop } from './ManualFileSource'
import ManualImportList from './ManualImportList'
import ManualImportAnnouncer from './ManualImportAnnouncer'
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
import { useNewCoursesLecturesOnly } from '@/shared/hooks/useNewCoursesLecturesOnly'
import { lecturesOnly, lecturesOnlyKind } from '@/features/lectures/utils/courseTree'
import { JobProgressBar } from './RecordingJobList'
import Combobox from '@/shared/components/Combobox'
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
  const { source } = useManualDraft()
  const rejected = useRejectedDrop()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  // Electron would otherwise navigate to a file dropped anywhere; the real drop handling stays on
  // the section, so the sidebar's lecture rows keep their own.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault()
    document.addEventListener('dragover', stop)
    document.addEventListener('drop', stop)
    return () => {
      document.removeEventListener('dragover', stop)
      document.removeEventListener('drop', stop)
    }
  }, [])

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    const verdict = classifyDrop(Array.from(e.dataTransfer.files))
    if (verdict.kind === 'file') updateManualDraft({ source: 'file', file: verdict.file })
    else rejected(verdict)
  }

  return (
    <section
      className="manual-download"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        depth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {source === 'link' && (
        <p className="manual-download-warning">
          <Trans>Works only for video links, and only if they open without signing in.</Trans>
        </p>
      )}
      <ManualForm />
      <ManualImportList />
      <ManualJobList />
      <ManualImportAnnouncer />
      {dragging && (
        <div className="manual-download-dropveil">
          <Trans>Drop the .mp4 to upload it</Trans>
        </div>
      )}
    </section>
  )
}

function ManualForm() {
  const { t } = useLingui()
  const id = useId()
  const { courses } = useCourseTreeContext()
  const entries = useManualEntries()
  // In the module store, so a trip to another page keeps what was typed; null fields follow defaults.
  const { source, file, url, course: typed, kind: picked, name } = useManualDraft()
  const imports = useImportEntries()
  const { status: runner } = useRunnerStatus()
  const [importConfirm, setImportConfirm] = useState<{ mode: ImportMode; lecture: string } | null>(
    null,
  )
  const newCoursesLecturesOnly = useNewCoursesLecturesOnly()
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const { locked: lockedFor, start } = useManualStart()

  const courseText = typed ?? courses[0]?.name ?? ''
  const existing = matchCourse(courses, courseText)
  const course = existing ?? courseText.trim()
  const claimed = [
    ...entries.map((e) => ({ ...e.target, kind: e.request.kind })),
    ...claimedByImports(imports),
  ]
  // A lectures-only course hides the toggle: a new item is a lecture, an existing recitation's name its own.
  const onlyLectures = !!course && lecturesOnly(courses, course, newCoursesLecturesOnly)
  const suggestKind = onlyLectures ? 'lecture' : picked
  const lecture = name ?? (course ? suggestManualName(courses, course, suggestKind, claimed) : '')
  const kind = onlyLectures ? lecturesOnlyKind(courses, course, lecture.trim()) : picked
  const locked = source === 'link' && lockedFor(url)
  // The File's absolute path through the desktop bridge; '' in a plain browser.
  const path = useMemo(() => (file ? pathOf(file, runtimeBridge()) : ''), [file])
  // When the tree last changed; a done import older than that is in it or was removed from it.
  const treeAt = useRef(0)
  useEffect(() => {
    treeAt.current = Date.now()
  }, [courses])
  const importBusy = isLectureRenameLocked(runner, course, lecture.trim(), kind)
  const target = { course, lecture, kind }
  const importing = importsInto(imports, target, 'running')
  const blockerFor = (mode: ImportMode) =>
    importBlocker({
      hasFile: !!file,
      course,
      name: lecture,
      busy: importBusy,
      importing,
      route: importRoute(mode, path),
    })
  const blockerText = (b: ImportBlocker | null) =>
    b === 'no-file'
      ? t`Choose an .mp4 file first`
      : b === 'no-course'
        ? t`Choose a course first`
        : b === 'no-name'
          ? t`Enter a name first`
          : b === 'busy'
            ? t`Can't replace the video while it's being processed or waiting in line`
            : b === 'importing'
              ? t`An import into this lecture is already running`
              : b === 'desktop-only'
                ? t`Moving needs the desktop app`
                : undefined
  const ready = !!url.trim() && !!course && !!lecture.trim() && !pending && !locked && !importing
  const downloadBlocker = !url.trim()
    ? t`Paste a video link first`
    : !course
      ? t`Choose a course first`
      : !lecture.trim()
        ? t`Enter a name first`
        : locked
          ? moodleBusyMessage()
          : importing
            ? t`An import into this lecture is already running`
            : pending
              ? t`Starting the download...`
              : undefined

  async function submit() {
    const request = { url: url.trim(), course, lecture: lecture.trim(), kind }
    setPending(true)
    // A name no course has is a new course.
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

  async function submitImport(mode: ImportMode, name: string) {
    if (!file) return
    setPending(true)
    if (!existing) {
      try {
        await createCourse(course)
      } catch (err) {
        toastDownloadError(course, err)
        setPending(false)
        return
      }
    }
    startImport({ file, mode, course, lecture: name, kind })
    // Move spends the file; Copy keeps it for another copy. The entry holds its own File for Retry.
    updateManualDraft(mode === 'move' ? { name: null, file: null } : { name: null })
    setPending(false)
  }

  function onImport(mode: ImportMode) {
    if (pending || blockerFor(mode)) return
    const name = lecture.trim()
    // A finished import counts as holding a video until the tree next refreshes.
    const taken =
      overwritesVideo({ media: 'video' }, name, kind, courses, course) ||
      importsInto(imports, { course, lecture: name, kind }, 'done', treeAt.current)
    if (taken) {
      setImportConfirm({ mode, lecture: name })
    } else void submitImport(mode, name)
  }

  // A video PUT wipes the lecture's transcript and summary, so replacing one confirms first.
  function onDownload() {
    if (!ready) return
    if (overwritesVideo({ media: 'video' }, lecture.trim(), kind, courses, course)) setConfirm(true)
    else void submit()
  }

  return (
    <div className="manual-download-form">
      <div className="manual-download-field manual-download-source" role="group">
        <div className="mode-toggle mode-toggle--light">
          <button
            className={source === 'link' ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
            onClick={() => updateManualDraft({ source: 'link' })}
          >
            <Trans>Link</Trans>
          </button>
          <button
            className={source === 'file' ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
            onClick={() => updateManualDraft({ source: 'file' })}
          >
            <Trans>File from computer</Trans>
          </button>
        </div>
      </div>
      {source === 'file' ? (
        <ManualFileSource file={file} onPick={(f) => updateManualDraft({ file: f })} />
      ) : (
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
      )}
      <div className="manual-download-field manual-download-course">
        <label className="manual-download-label" htmlFor={`${id}-course`}>
          <Trans>Course</Trans>
        </label>
        {/* Free text with the courses as suggestions: a name none of them has is a new course. */}
        <Combobox
          id={`${id}-course`}
          inputClassName="source-row-input"
          value={courseText}
          options={courses.map((c) => c.name)}
          onChange={(course) => updateManualDraft({ course })}
        />
      </div>
      {/* Buttons, not an input, so the caption names the group rather than a control. */}
      {!onlyLectures && (
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
      )}
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
      {source === 'file' ? (
        <div className="manual-download-actions">
          <Tooltip content={pending ? t`Importing the file...` : blockerText(blockerFor('copy'))}>
            <button
              className="btn btn--primary"
              onClick={() => onImport('copy')}
              disabled={pending || !!blockerFor('copy')}
            >
              {pending ? <span className="recording-spinner" /> : t`Copy`}
            </button>
          </Tooltip>
          <Tooltip content={pending ? t`Importing the file...` : blockerText(blockerFor('move'))}>
            <button
              className="btn btn--secondary"
              onClick={() => onImport('move')}
              disabled={pending || !!blockerFor('move')}
            >
              <Trans>Move</Trans>
            </button>
          </Tooltip>
        </div>
      ) : (
        <Tooltip content={downloadBlocker}>
          <button className="btn btn--primary" onClick={onDownload} disabled={!ready}>
            {pending ? <span className="recording-spinner" /> : t`Download`}
          </button>
        </Tooltip>
      )}

      {importConfirm && (
        <ConfirmModal
          message={t`Replace the existing video in "${importConfirm.lecture}"?`}
          warning={t`Note: This deletes the lecture's audio, transcript, summary and PDF. Materials are kept.`}
          onConfirm={() => {
            const { mode, lecture: name } = importConfirm
            setImportConfirm(null)
            void submitImport(mode, name)
          }}
          onCancel={() => setImportConfirm(null)}
        />
      )}

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
          <Tooltip
            content={
              locked ? moodleBusyMessage() : retrying ? t`Retrying the download...` : undefined
            }
          >
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
