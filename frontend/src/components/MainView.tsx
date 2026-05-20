import { useState, useEffect } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import { toast } from 'react-toastify'
import type { Step, FileName, TimingStats, LectureContext, RateLimitInfo, RateLimitProgress } from '../types'
import { fetchCourse, deleteFile, fileUrl } from '../services/database'
import { fetchTimingStats, runStep } from '../services/backend'
import { useRemoteInflightState } from '../hooks/useRemoteInflightState'
import ConfirmModal from './ConfirmModal'
import Icon from './Icon'

interface ReqState {
  step: Step
  status: 'inflight' | 'error' | 'rate_limited'
  message?: string
  startedAt?: number
  timingStats?: TimingStats | null
  completedFraction?: number
  rateLimit?: RateLimitInfo
  progress?: RateLimitProgress
  rateLimitReceivedAt?: number
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

const STEP_ERROR_LABEL: Record<Step, string> = {
  audio:      'Audio extraction failed',
  transcribe: 'Transcription failed',
  summarize:  'Summarization failed',
  pdf:        'PDF export failed',
  drive:      'Drive upload failed',
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
  rateLimit,
  progress,
  receivedAt,
}: {
  rateLimit: RateLimitInfo
  progress: RateLimitProgress
  receivedAt: number
}) {
  const initial = rateLimit.retryAfterSeconds
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (initial === null) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [initial])

  const remaining =
    initial === null ? null : Math.max(initial - (now - receivedAt) / 1000, 0)

  return (
    <div className="rate-limit-panel">
      <h4 className="rate-limit-title">Groq rate limit reached</h4>
      <div className="rate-limit-stats">
        <div>
          <span className="rate-limit-stat-label">Limit</span>
          <span className="rate-limit-stat-value">{rateLimit.limit ?? '—'}</span>
        </div>
        <div>
          <span className="rate-limit-stat-label">Used</span>
          <span className="rate-limit-stat-value">{rateLimit.used ?? '—'}</span>
        </div>
        <div>
          <span className="rate-limit-stat-label">Requested</span>
          <span className="rate-limit-stat-value">{rateLimit.requested ?? '—'}</span>
        </div>
      </div>
      <p className="rate-limit-units">seconds of audio per hour</p>
      {(progress.completed !== null && progress.total !== null) && (
        <p className="rate-limit-progress">
          {progress.completed}/{progress.total} chunks transcribed so far
        </p>
      )}
      {remaining !== null && (
        <p className="rate-limit-countdown">
          {remaining > 0 ? `Retry in ${formatDuration(remaining)}` : 'Ready to retry'}
        </p>
      )}
    </div>
  )
}

export default function MainView() {
  const params = useParams<{ course: string; lecture: string }>()
  const { files, transcribePartial, refreshCourses, kind } = useOutletContext<LectureContext>()
  const navigate = useNavigate()

  const [localState, setLocalState] = useState<ReqState | null>(null)
  const [runAllState, setRunAllState] = useState<RunAllState | null>(null)
  const [rotateTarget, setRotateTarget] = useState<RotateTarget | null>(null)

  useEffect(() => {
    setLocalState(null)
    setRunAllState(null)
  }, [params.course, params.lecture, kind])

  const course = params.course ?? ''
  const lecture = params.lecture ?? ''
  const remote = useRemoteInflightState({ course, lecture, kind, files, transcribePartial })

  // Local run wins while active; otherwise fall back to the resume-runner's view.
  const reqState: ReqState | null = localState ?? (remote ? { ...remote, status: 'inflight' } : null)

  if (!params.course || !params.lecture) return null
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

  async function runLocal(step: Step): Promise<boolean> {
    const inputFile = STEP_INPUT_FILE[step]
    let fileSizeBytes = 0
    if (inputFile) {
      const fresh = await fetchCourse(course)
      const list = kind === 'recitation' ? fresh?.recitations : fresh?.lectures
      const lec = list?.find((l) => l.name === lecture)
      fileSizeBytes = lec?.files[inputFile]?.size ?? 0
    }
    const startedAt = Date.now()

    let completedFraction = 0
    if (step === 'transcribe' && files?.['transcript.partial.txt'].exists && transcribePartial && transcribePartial.total > 0) {
      completedFraction = transcribePartial.completed / transcribePartial.total
    }

    setLocalState({ step, status: 'inflight', startedAt, timingStats: null, completedFraction })
    fetchTimingStats(step, fileSizeBytes)
      .then((stats) =>
        setLocalState((prev) =>
          prev?.status === 'inflight' && prev.step === step ? { ...prev, timingStats: stats } : prev
        )
      )
      .catch(() =>
        setLocalState((prev) =>
          prev?.status === 'inflight' && prev.step === step
            ? { ...prev, timingStats: { message: 'not-enough-data' } }
            : prev
        )
      )

    const result = await runStep(course, lecture, step, kind)
    refreshCourses()
    if (result.status === 'done') {
      if (step === 'summarize') {
        toast.info(result.usedMaterial ? 'Summarized with material.pdf' : 'Summarized without material.pdf (not found)')
      }
      setLocalState(null)
      return true
    } else if (result.status === 'rate_limited') {
      toast.error('Groq rate limit reached')
      setLocalState({
        step,
        status: 'rate_limited',
        rateLimit: result.rateLimit,
        progress: result.progress,
        rateLimitReceivedAt: Date.now(),
      })
      return false
    } else {
      toast.error(STEP_ERROR_LABEL[step])
      setLocalState({ step, status: 'error', message: result.message })
      return false
    }
  }

  async function handleRotate(step: Step, filesToDelete: FileName[]) {
    await Promise.all(filesToDelete.map((file) => deleteFile(course, lecture, file, kind)))
    refreshCourses()
    await runLocal(step)
  }

  async function handleRunRemaining() {
    if (!files || !hasActions) return

    const remainingSteps = PIPELINE
      .filter(({ file }) => !files[file].exists)
      .flatMap(({ step }) => step ? [step] : [])

    setRunAllState({ steps: remainingSteps, currentIndex: 0 })

    for (let i = 0; i < remainingSteps.length; i++) {
      setRunAllState((prev) => prev ? { ...prev, currentIndex: i } : null)
      const success = await runLocal(remainingSteps[i])
      if (!success) {
        break
      }
    }

    setRunAllState(null)
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
                          onClick={() => runLocal(step)}
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
                            onClick={() => navigate({ pathname: 'edit', search: kind === 'recitation' ? '?kind=recitation' : '' })}
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
                {isRunning && (
                  <ProgressBar
                    stats={reqState!.timingStats}
                    startedAt={reqState!.startedAt!}
                    completedFraction={reqState!.completedFraction}
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

        {reqState?.status === 'rate_limited' && reqState.rateLimit && reqState.progress && (
          <RateLimitPanel
            rateLimit={reqState.rateLimit}
            progress={reqState.progress}
            receivedAt={reqState.rateLimitReceivedAt!}
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
