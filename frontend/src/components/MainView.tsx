import { useState, useEffect } from 'react'
import { FileStatus, FileName, Step, TimingStats } from '../api'
import { Selected, ReqState, RunAllState } from '../App'

const PIPELINE: Array<{ file: FileName; step?: Step; actionLabel?: string; prereq?: FileName }> = [
  { file: 'video.mp4' },
  { file: 'audio.mp3',      step: 'audio',      actionLabel: 'Extract Audio', prereq: 'video.mp4'      },
  { file: 'transcript.txt', step: 'transcribe',  actionLabel: 'Transcribe',    prereq: 'audio.mp3'      },
  { file: 'summary.md',     step: 'summarize',   actionLabel: 'Summarize',     prereq: 'transcript.txt' },
  { file: 'summary.pdf',    step: 'pdf',         actionLabel: 'Export PDF',    prereq: 'summary.md'     },
]

const STEP_FILE: Partial<Record<Step, FileName>> = {
  audio: 'audio.mp3',
  transcribe: 'transcript.txt',
  summarize: 'summary.md',
  pdf: 'summary.pdf',
}

const STEP_LABEL: Partial<Record<Step, string>> = {
  audio: 'Extract Audio',
  transcribe: 'Transcribe',
  summarize: 'Summarize',
  pdf: 'Export PDF',
}

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

interface Props {
  selected: Selected | null
  files: FileStatus | null
  reqState: ReqState | null
  runAllState: RunAllState | null
  onRun: (step: Step) => void
  onRunRemaining: () => void
  inflight: boolean
}

export default function MainView({ selected, files, reqState, runAllState, onRun, onRunRemaining, inflight }: Props) {
  if (!selected) {
    return (
      <main className="main-view main-view--empty">
        <p className="empty-state">Select a lecture to get started</p>
      </main>
    )
  }

  if (!files) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }

  const hasActions = PIPELINE.some(({ file, step }) => step && !files[file].exists)
  const runningFile = inflight ? STEP_FILE[reqState!.step] : null

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">{selected.lecture}</h2>

        <div className="file-list">
          {PIPELINE.map(({ file, step, actionLabel, prereq }) => {
            const exists = files[file].exists
            const isRunning = runningFile === file
            const prereqMet = !prereq || files[prereq].exists

            return (
              <div key={file} className={`file-row${exists ? ' file-row--present' : ''}${isRunning ? ' file-row--running' : ''}`}>
                <div className="file-row-header">
                  <span className="file-name">{file}</span>
                  {exists ? (
                    <span className="file-check">✓</span>
                  ) : isRunning ? (
                    <div className="spinner spinner--sm" />
                  ) : step ? (
                    <button
                      className="file-action-btn"
                      onClick={() => onRun(step)}
                      disabled={inflight || !prereqMet}
                    >
                      {actionLabel}
                    </button>
                  ) : (
                    <span className="file-missing">not provided</span>
                  )}
                </div>
                {isRunning && (
                  <ProgressBar stats={reqState!.timingStats} startedAt={reqState!.startedAt!} />
                )}
              </div>
            )
          })}
        </div>

        {hasActions && (
          <button className="run-all-btn" onClick={onRunRemaining} disabled={inflight}>
            Run Remaining
          </button>
        )}

        {runAllState && (
          <div className="run-all-overall-progress">
            <p className="run-all-overall-label">
              {runAllState.currentIndex + 1}/{runAllState.steps.length} — {STEP_LABEL[runAllState.steps[runAllState.currentIndex]]}
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
    </main>
  )
}
