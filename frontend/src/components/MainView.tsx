import { FileStatus, FileName, Step } from '../api'
import { Selected, ReqState } from '../App'

const PIPELINE: Array<{ file: FileName; step?: Step; actionLabel?: string }> = [
  { file: 'video.mp4' },
  { file: 'audio.mp3', step: 'audio', actionLabel: 'Extract Audio' },
  { file: 'transcript.txt', step: 'transcribe', actionLabel: 'Transcribe' },
  { file: 'summary.md', step: 'summarize', actionLabel: 'Summarize' },
  { file: 'summary.pdf', step: 'pdf', actionLabel: 'Export PDF' },
]

const STEP_FILE: Partial<Record<Step, FileName>> = {
  audio: 'audio.mp3',
  transcribe: 'transcript.txt',
  summarize: 'summary.md',
  pdf: 'summary.pdf',
}

interface Props {
  selected: Selected | null
  files: FileStatus | null
  reqState: ReqState | null
  onRun: (step: Step) => void
  inflight: boolean
}

export default function MainView({ selected, files, reqState, onRun, inflight }: Props) {
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

  const hasActions = PIPELINE.some(({ file, step }) => step && !files[file])
  const runningFile =
    inflight && reqState!.step !== 'all' ? STEP_FILE[reqState!.step] : null
  const runningAll = inflight && reqState!.step === 'all'

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">{selected.lecture}</h2>

        <div className="file-list">
          {PIPELINE.map(({ file, step, actionLabel }) => {
            const exists = files[file]
            const isRunning = runningFile === file || (runningAll && !!step)

            return (
              <div key={file} className={`file-row${exists ? ' file-row--present' : ''}`}>
                <span className="file-name">{file}</span>
                {exists ? (
                  <span className="file-check">✓</span>
                ) : isRunning ? (
                  <div className="spinner spinner--sm" />
                ) : step ? (
                  <button
                    className="file-action-btn"
                    onClick={() => onRun(step)}
                    disabled={inflight}
                  >
                    {actionLabel}
                  </button>
                ) : (
                  <span className="file-missing">not provided</span>
                )}
              </div>
            )
          })}
        </div>

        {hasActions && !runningAll && (
          <button className="run-all-btn" onClick={() => onRun('all')} disabled={inflight}>
            Run All
          </button>
        )}

        {runningAll && (
          <div className="file-running-all">
            <div className="spinner spinner--sm" />
            <span>Running pipeline…</span>
          </div>
        )}

        {reqState?.status === 'error' && (
          <p className="file-error">Error: {reqState.message}</p>
        )}
      </div>
    </main>
  )
}
