import { useState, useEffect } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import { fetchTimingStats, runStep, deleteFile, Step, FileName, TimingStats } from '../api'
import { LayoutContext } from './Layout'

interface ReqState {
  step: Step
  status: 'inflight' | 'error'
  message?: string
  startedAt?: number
  timingStats?: TimingStats | null
}

interface RunAllState {
  steps: Step[]
  currentIndex: number
}

interface RotateTarget {
  file: FileName
  step: Step
  toDelete: FileName[]
}

const PIPELINE: Array<{ file: FileName; step?: Step; actionLabel?: string; prereq?: FileName }> = [
  { file: 'video.mp4' },
  { file: 'audio.mp3',      step: 'audio',      actionLabel: 'Extract Audio',   prereq: 'video.mp4'      },
  { file: 'transcript.txt', step: 'transcribe',  actionLabel: 'Transcribe',      prereq: 'audio.mp3'      },
  { file: 'summary.md',     step: 'summarize',   actionLabel: 'Summarize',       prereq: 'transcript.txt' },
  { file: 'summary.pdf',    step: 'pdf',         actionLabel: 'Export PDF',      prereq: 'summary.md'     },
  { file: 'drive_url.txt',  step: 'drive',       actionLabel: 'Upload to Drive', prereq: 'summary.pdf'    },
]

const STEP_FILE = Object.fromEntries(
  PIPELINE.flatMap(p => p.step ? [[p.step, p.file]] : [])
) as Partial<Record<Step, FileName>>

const STEP_INPUT_FILE = Object.fromEntries(
  PIPELINE.flatMap(p => p.step && p.prereq ? [[p.step, p.prereq]] : [])
) as Partial<Record<Step, FileName>>

const STEP_LABEL = Object.fromEntries(
  PIPELINE.flatMap(p => p.step && p.actionLabel ? [[p.step, p.actionLabel]] : [])
) as Partial<Record<Step, string>>

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function ProgressBar({ stats, startedAt }: { stats: TimingStats | null | undefined; startedAt: number }) {
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
  const progress = Math.min((elapsed / estimated) * 100, 100)
  const overflowing = elapsed >= estimated

  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div
          className={`progress-fill${overflowing ? ' progress-fill--overflow' : ''}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className={`progress-label${overflowing ? ' progress-label--overflow' : ''}`}>
        {overflowing
          ? `Taking longer than expected · longest recorded: ${formatDuration(longest)}`
          : `${formatDuration(Math.max(estimated - elapsed, 0))} remaining`}
      </p>
    </div>
  )
}

export default function MainView() {
  const params = useParams<{ course: string; lecture: string }>()
  const { files, refreshCourses } = useOutletContext<LayoutContext>()
  const navigate = useNavigate()

  const [reqState, setReqState] = useState<ReqState | null>(null)
  const [runAllState, setRunAllState] = useState<RunAllState | null>(null)
  const [rotateTarget, setRotateTarget] = useState<RotateTarget | null>(null)

  useEffect(() => {
    setReqState(null)
    setRunAllState(null)
  }, [params.course, params.lecture])

  if (!params.course || !params.lecture) return null
  const course = params.course
  const lecture = params.lecture
  if (!files) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }

  const inflight = reqState?.status === 'inflight'
  const runningFile = inflight ? STEP_FILE[reqState!.step] : null
  const hasAnyStepFile = PIPELINE.some(({ file, step }) => step && files[file].exists)
  const pdfExists = files['summary.pdf'].exists
  const pdfUploaded = files['drive_url.txt'].exists
  const summaryExists = files['summary.md'].exists
  const hasActions = PIPELINE.some(({ file, step }) => step && !files[file].exists)

  async function executeStep(step: Step): Promise<boolean> {
    const startedAt = Date.now()
    const inputFile = STEP_INPUT_FILE[step]
    const fileSizeBytes = inputFile ? (files?.[inputFile]?.size ?? 0) : 0

    setReqState({ step, status: 'inflight', startedAt, timingStats: null })
    if (fileSizeBytes > 0) {
      fetchTimingStats(step, fileSizeBytes).then((stats) =>
        setReqState((prev) =>
          prev?.status === 'inflight' && prev.step === step ? { ...prev, timingStats: stats } : prev
        )
      )
    }

    const result = await runStep(course, lecture, step)
    if (result.status === 'done') {
      setReqState(null)
      refreshCourses()
      return true
    } else {
      setReqState({ step, status: 'error', message: result.message })
      return false
    }
  }

  async function handleRun(step: Step) {
    await executeStep(step)
  }

  async function handleRotate(step: Step, filesToDelete: FileName[]) {
    await Promise.all(filesToDelete.map((file) => deleteFile(course, lecture, file)))
    refreshCourses()
    await handleRun(step)
  }

  async function handleRunRemaining() {
    if (!files || !hasActions) return

    const remainingSteps = PIPELINE
      .filter(({ file }) => !files[file].exists)
      .flatMap(({ step }) => step ? [step] : [])

    setRunAllState({ steps: remainingSteps, currentIndex: 0 })

    for (let i = 0; i < remainingSteps.length; i++) {
      setRunAllState((prev) => prev ? { ...prev, currentIndex: i } : null)
      const success = await executeStep(remainingSteps[i])
      if (!success) {
        break
      }
    }

    setRunAllState(null)
  }

  function openRotateModal(file: FileName, step: Step) {
    const idx = PIPELINE.findIndex((p) => p.file === file)
    const toDelete = PIPELINE.slice(idx).map((p) => p.file)
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

            return (
              <div key={file} className={`file-row${exists ? ' file-row--present' : ''}${isRunning ? ' file-row--running' : ''}`}>
                <div className="file-row-header">
                  <span className="file-name">{file}</span>
                  <span className="file-row-right">
                    <span className="file-slot file-slot--status">
                      {exists ? (
                        <span className="file-check">✓</span>
                      ) : isRunning ? (
                        <div className="spinner spinner--sm" />
                      ) : step ? (
                        <button
                          className="file-action-btn"
                          onClick={() => handleRun(step)}
                          disabled={inflight || !prereqMet}
                        >
                          {actionLabel}
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
                            onClick={() => window.open(
                              `/api/files/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/summary.pdf`,
                              '_blank'
                            )}
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                              <path d="M8 1h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 1L6.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}
                        {file === 'summary.md' && summaryExists && (
                          <button
                            className="file-open-btn"
                            title="Edit summary"
                            onClick={() => navigate('edit')}
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M9.5 2L11 3.5L4.5 10H3V8.5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M8 3.5L9.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}
                        {file === 'drive_url.txt' && exists && (
                          <button
                            className="file-open-btn"
                            title="Open in Drive"
                            onClick={() => window.open(files['drive_url.txt'].url, '_blank')}
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                              <path d="M8 1h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 1L6.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                </div>
                {isRunning && (
                  <ProgressBar stats={reqState!.timingStats} startedAt={reqState!.startedAt!} />
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

        {runAllState && (
          <div className="run-all-overall-progress">
            <p className="run-all-overall-label">
              {runAllState.currentIndex + 1}/{runAllState.steps.length} - {STEP_LABEL[runAllState.steps[runAllState.currentIndex]]}
            </p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${(runAllState.currentIndex / runAllState.steps.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {reqState?.status === 'error' && (
          <p className="file-error">Error: {reqState.message}</p>
        )}
      </div>

      {rotateTarget && (
        <div className="modal-overlay" onClick={() => setRotateTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-message">
              The following files will be <strong>deleted</strong>, then <strong>{rotateTarget.file}</strong> will be regenerated:
            </p>
            <ul className="modal-file-list">
              {rotateTarget.toDelete.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setRotateTarget(null)}>Cancel</button>
              <button className="modal-btn modal-btn--danger" onClick={confirmRotate}>Rotate</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
