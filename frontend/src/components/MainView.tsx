import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import type { Step, FileName, TimingStats } from '../types'
import { deleteFile, fileUrl } from '../services/database'
import { runStep, runPipeline } from '../services/backend'
import { useRemoteInflightState } from '../hooks/useRemoteInflightState'
import { useLectureRoute } from '../hooks/useLectureRoute'
import { useRunnerStatus } from '../contexts/RunnerStatusContext'
import { PIPELINE, STEP_FILE, STEP_ERROR_LABEL } from '../constants/pipeline'
import { inFlightKey } from '../utils/inFlightKey'
import { kindSearch } from '../utils/route'
import ConfirmModal from './ConfirmModal'
import Icon from './Icon'

interface RotateTarget {
  file: FileName
  step: Step
  toDelete: FileName[]
}


function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function ProgressBar({
  stats,
  startedAt,
  completedFraction = 0,
}: {
  stats: TimingStats | null | undefined
  startedAt: number
  completedFraction?: number
}) {
  const [elapsed, setElapsed] = useState(() => (Date.now() - startedAt) / 1000)

  useEffect(() => {
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500)
    return () => clearInterval(id)
  }, [startedAt])

  if (stats === null || stats === undefined) {
    return <p className="progress-label progress-label--muted">Estimating…</p>
  }

  if ('message' in stats) {
    return <p className="progress-label progress-label--muted">Not enough data to estimate</p>
  }

  const { estimated, longest } = stats
  const effectiveElapsed = completedFraction * estimated + elapsed
  const fillPct = Math.min((effectiveElapsed / estimated) * 100, 100)
  const remaining = Math.max(estimated - effectiveElapsed, 0)
  const overflowing = effectiveElapsed >= estimated

  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div
          className={`progress-fill${overflowing ? ' progress-fill--overflow' : ''}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <p className={`progress-label${overflowing ? ' progress-label--overflow' : ''}`}>
        {overflowing
          ? `Taking longer than expected · ${formatDuration(elapsed)} · longest recorded: ${formatDuration(longest)}`
          : `${formatDuration(remaining)} remaining`}
      </p>
    </div>
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
  const { course, lecture, kind, files, transcribePartial, refreshCourses } = useLectureRoute()
  const navigate = useNavigate()
  const [rotateTarget, setRotateTarget] = useState<RotateTarget | null>(null)

  // Derive inflight state from backend context
  const { isInFlight, status: runnerStatus } = useRunnerStatus()
  const inflight = isInFlight(course, lecture, kind)
  const lectureError = runnerStatus?.errors[inFlightKey(course, lecture, kind)] ?? null
  const remote = useRemoteInflightState({ course, lecture, kind, files, transcribePartial })

  // MainView shows course and lecture details. No course or lecture in URL -> show nothing
  if (!course || !lecture) return null

  // Still loading course details (files, etc.) -> show spinner
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
  const materialWasUsed =
    summaryExists && materialExists &&
    materialMtime !== null && summaryMtime !== null &&
    materialMtime <= summaryMtime

  const materialIndicator = summaryExists
    ? materialWasUsed
      ? { symbol: '📎', text: 'material.pdf was used', cls: 'material-indicator--used' }
      : { symbol: '⊘', text: 'summary did not use material.pdf', cls: 'material-indicator--was-missing' }
    : materialExists
      ? { symbol: '📎', text: 'material.pdf will be used', cls: 'material-indicator--will-use' }
      : { symbol: '⚠', text: 'material.pdf not found', cls: 'material-indicator--missing' }

  async function handleStep(step: Step) {
    const initResult = await runStep(course, lecture, step, kind)
    refreshCourses()
    if (initResult.status === 'busy') toast.error('Step already running')
    else if (initResult.status === 'error') toast.error(initResult.message ?? STEP_ERROR_LABEL[step])
    // 'started': no action — SSE fires when done, tree refreshes
  }

  async function handleRotate(step: Step, filesToDelete: FileName[]) {
    await Promise.all(filesToDelete.map((file) => deleteFile(course, lecture, file, kind)))
    refreshCourses()
    handleStep(step)
  }

  async function handleRunRemaining() {
    const result = await runPipeline(course, lecture, kind)
    refreshCourses()
    if (result.status === 'busy') toast.error('Pipeline already running')
    else if (result.status === 'error') toast.error(result.message ?? 'Pipeline failed to start')
    // 'started': no action — SSE fires each step run updates, tree refreshes
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
        <h2 className="lecture-panel-title" dir="auto">{lecture}</h2>

        <div className="file-list">
          {PIPELINE.map(({ file, step, actionLabel, prereq }) => {
            const exists = files[file].exists
            const isRunning = runningFile === file
            const prereqMet = !prereq || files[prereq].exists
            const isResumeTranscribe =
              file === 'transcript.txt' &&
              !exists &&
              files['transcript.partial.txt'].exists
            const buttonLabel = isResumeTranscribe ? 'Continue transcription' : actionLabel

            return (
              <div key={file} className={`file-row${exists ? ' file-row--present' : ''}${isRunning ? ' file-row--running' : ''}`}>
                <div className="file-row-header">
                  <span className="file-name-wrap">
                    <span className="file-name">{file}</span>
                    {file === 'summary.md' && (
                      <span className={`material-indicator ${materialIndicator.cls}`}>
                        <span className="material-indicator-symbol">{materialIndicator.symbol}</span>
                        <span className="material-indicator-text">{materialIndicator.text}</span>
                      </span>
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
                        >↺</button>
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
                            onClick={() => window.open(fileUrl(course, lecture, 'summary.pdf', kind), '_blank')}
                          >
                            <Icon icon="external-link" />
                          </button>
                        )}
                        {file === 'summary.md' && summaryExists && (
                          <button
                            className="file-open-btn"
                            title="Edit summary"
                            onClick={() => navigate({ pathname: 'edit', search: kindSearch(kind) })}
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
          <RateLimitPanel
            sleepingUntil={remote.sleepingUntil}
            progress={remote.progress}
          />
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
