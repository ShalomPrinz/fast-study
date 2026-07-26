import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Step, FileName } from '@/types'
import { deleteFile, fileUrl } from '@/services/database'
import { runStep, runPipeline } from '@/services/backend'
import { useRemoteInflightState } from '@/features/lectures/hooks/useRemoteInflightState'
import { useLectureRoute } from '@/features/lectures/hooks/useLectureRoute'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { PIPELINE, STEP_FILE, STEP_ERROR_LABEL } from '@/features/lectures/constants/pipeline'
import { kindQuery } from '@/shared/utils/url'
import { formatDuration } from '@/shared/utils/format'
import { toastInitResult } from '@/services/toaster'
import ConfirmModal from '@/shared/components/ConfirmModal'
import ProgressBar from '@/shared/components/ProgressBar'
import Icon from '@/shared/components/Icon'

interface RotateTarget {
  file: FileName
  step: Step
  toDelete: FileName[]
}

type MaterialIndicatorProps = {
  summaryExists: boolean
  materialExists: boolean
  summaryMtime: number | null
  materialMtime: number | null
}

function MaterialIndicator({
  summaryExists,
  materialExists,
  summaryMtime,
  materialMtime,
}: MaterialIndicatorProps) {
  const materialWasUsed =
    summaryExists &&
    materialExists &&
    materialMtime !== null &&
    summaryMtime !== null &&
    materialMtime <= summaryMtime

  const { symbol, text, cls } = summaryExists
    ? materialWasUsed
      ? { symbol: '📎', text: 'material.pdf was used', cls: 'material-indicator--used' }
      : {
          symbol: '⊘',
          text: 'summary did not use material.pdf',
          cls: 'material-indicator--was-missing',
        }
    : materialExists
      ? { symbol: '📎', text: 'material.pdf will be used', cls: 'material-indicator--will-use' }
      : { symbol: '⚠', text: 'material.pdf not found', cls: 'material-indicator--missing' }

  return (
    <span className={`material-indicator ${cls}`}>
      <span className="material-indicator-symbol">{symbol}</span>
      <span className="material-indicator-text">{text}</span>
    </span>
  )
}

function RateLimitPanel({
  sleepingUntil,
  progress,
}: {
  sleepingUntil: string
  progress: { completed: number; total: number } | null
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const remaining = Math.max((new Date(sleepingUntil).getTime() - now) / 1000, 0)

  return (
    <div className="rate-limit-panel">
      <h4 className="rate-limit-title">Groq rate limit reached</h4>
      {progress && (
        <p className="rate-limit-progress">
          {progress.completed}/{progress.total} chunks transcribed so far
        </p>
      )}
      <p className="rate-limit-countdown">
        {remaining > 0 ? `Retry in ${formatDuration(remaining)}` : 'Ready to retry'}
      </p>
    </div>
  )
}

export default function MainView() {
  const { course, lecture, kind, files, transcribePartial } = useLectureRoute()
  const { refreshCourses } = useCourseTreeContext()
  const navigate = useNavigate()
  const [rotateTarget, setRotateTarget] = useState<RotateTarget | null>(null)

  const { isInFlight, getError } = useRunnerStatus()
  const inflight = isInFlight(course, lecture, kind)
  const lectureError = getError(course, lecture, kind)
  const remote = useRemoteInflightState({ course, lecture, kind, files, transcribePartial })

  if (!course || !lecture) return null

  if (!files) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }

  const runningFile = remote ? STEP_FILE[remote.step] : null
  const hasAnyStepFile = PIPELINE.some(({ file, step }) => step && files[file].exists)
  const pdfExists = files['summary.pdf'].exists
  const pdfUploaded = files['drive_url.txt'].exists
  const summaryExists = files['summary.md'].exists
  const materialExists = files['material.pdf'].exists
  const hasActions = PIPELINE.some(({ file, step }) => step && !files[file].exists)

  const summaryMtime = files['summary.md'].mtime
  const materialMtime = files['material.pdf'].mtime

  async function handleStep(step: Step) {
    const initResult = await runStep(course, lecture, step, kind)
    toastInitResult(initResult, { busy: 'Step already running', error: STEP_ERROR_LABEL[step] })
    refreshCourses()
  }

  async function handleRotate(step: Step, filesToDelete: FileName[]) {
    await Promise.all(filesToDelete.map((file) => deleteFile(course, lecture, file, kind)))
    refreshCourses()
    handleStep(step)
  }

  async function handleRunRemaining() {
    const result = await runPipeline(course, lecture, kind)
    toastInitResult(result, { busy: 'Pipeline already running', error: 'Pipeline failed to start' })
    refreshCourses()
  }

  function openRotateModal(file: FileName, step: Step) {
    const idx = PIPELINE.findIndex((p) => p.file === file)
    const toDelete = PIPELINE.slice(idx)
      .map((p) => p.file)
      .filter((f) => files![f].exists)
    setRotateTarget({ file, step, toDelete })
  }

  function confirmRotate() {
    if (!rotateTarget) return
    const { step, toDelete } = rotateTarget
    setRotateTarget(null)
    handleRotate(step, toDelete)
  }

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">
          {lecture}
        </h2>

        <div className="file-list">
          {PIPELINE.map(({ file, step, actionLabel, prereq }) => {
            const exists = files[file].exists
            const isRunning = runningFile === file
            const prereqMet = !prereq || files[prereq].exists
            const isResumeTranscribe =
              file === 'transcript.txt' && !exists && files['transcript.partial.txt'].exists
            const buttonLabel = isResumeTranscribe ? 'Continue transcription' : actionLabel

            return (
              <div
                key={file}
                className={`file-row${exists ? ' file-row--present' : ''}${isRunning ? ' file-row--running' : ''}`}
              >
                <div className="file-row-header">
                  <span className="file-name-wrap">
                    <span className="file-name">{file}</span>
                    {file === 'summary.md' && (
                      <MaterialIndicator
                        summaryExists={summaryExists}
                        materialExists={materialExists}
                        summaryMtime={summaryMtime}
                        materialMtime={materialMtime}
                      />
                    )}
                  </span>
                  <span className="file-row-right">
                    <span className="file-slot file-slot--status">
                      {exists ? (
                        <span className="file-check">✓</span>
                      ) : isRunning ? (
                        <div className="spinner spinner--sm" />
                      ) : step ? (
                        <button
                          className="file-action-btn"
                          onClick={() => handleStep(step)}
                          disabled={inflight || !prereqMet}
                        >
                          {buttonLabel}
                        </button>
                      ) : (
                        <span className="file-missing">not provided</span>
                      )}
                    </span>
                    {hasAnyStepFile && exists && step && (
                      <span className="file-slot file-slot--rotate">
                        <button
                          className="file-rotate-btn"
                          title={`Rotate ${file}`}
                          onClick={() => openRotateModal(file, step)}
                          disabled={inflight}
                        >
                          ↺
                        </button>
                      </span>
                    )}
                    {((file === 'summary.pdf' && pdfExists) ||
                      (file === 'summary.md' && summaryExists) ||
                      (file === 'drive_url.txt' && pdfUploaded)) && (
                      <span className="file-slot file-slot--open">
                        {file === 'summary.pdf' && pdfExists && (
                          <button
                            className="file-open-btn"
                            title="Open PDF in new tab"
                            onClick={() =>
                              window.open(fileUrl(course, lecture, 'summary.pdf', kind), '_blank')
                            }
                          >
                            <Icon icon="external-link" />
                          </button>
                        )}
                        {file === 'summary.md' && summaryExists && (
                          <button
                            className="file-open-btn"
                            title="Edit summary"
                            onClick={() => navigate({ pathname: 'edit', search: kindQuery(kind) })}
                          >
                            <Icon icon="edit" />
                          </button>
                        )}
                        {file === 'drive_url.txt' && exists && (
                          <button
                            className="file-open-btn"
                            title="Open in Drive"
                            onClick={() => window.open(files['drive_url.txt'].url, '_blank')}
                          >
                            <Icon icon="external-link" />
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                </div>
                {isRunning && remote && (
                  <ProgressBar
                    stats={remote.timingStats}
                    startedAt={remote.startedAt}
                    completedFraction={remote.completedFraction}
                  />
                )}
              </div>
            )
          })}
        </div>

        {hasActions && (
          <button className="run-all-btn" onClick={handleRunRemaining} disabled={inflight}>
            Run Remaining
          </button>
        )}

        {lectureError && (
          <div className="lecture-error" role="alert">
            <strong>Last error:</strong> {lectureError}
          </div>
        )}

        {remote?.sleepingUntil != null && (
          <RateLimitPanel sleepingUntil={remote.sleepingUntil} progress={remote.progress} />
        )}
      </div>

      {rotateTarget && (
        <ConfirmModal
          message="The following files will be deleted:"
          postMessage={`Then ${rotateTarget.file} will be regenerated.`}
          detail={
            <ul className="modal-file-list">
              {rotateTarget.toDelete.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={confirmRotate}
          onCancel={() => setRotateTarget(null)}
        />
      )}
    </main>
  )
}
