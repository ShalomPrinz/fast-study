import { Step } from '../api'
import { Selected, ReqState } from '../App'

const STEP_LABELS: Record<Step, string> = {
  audio: 'Extracting audio...',
  transcribe: 'Transcribing...',
  summarize: 'Summarizing...',
  pdf: 'Exporting PDF...',
  all: 'Running full pipeline...',
}

interface Props {
  selected: Selected | null
  reqState: ReqState | null
}

export default function MainView({ selected, reqState }: Props) {
  if (!selected) {
    return (
      <main className="main-view main-view--empty">
        <p className="empty-state">Select a lecture to get started</p>
      </main>
    )
  }

  return (
    <main className="main-view">
      {!reqState && (
        <p className="main-idle">Choose an action from the sidebar.</p>
      )}

      {reqState?.status === 'inflight' && (
        <div className="main-status">
          <div className="spinner" />
          <p className="status-label">{STEP_LABELS[reqState.step]}</p>
        </div>
      )}

      {reqState?.status === 'done' && (
        <div className="main-status">
          <p className="status-done">Done ✓</p>
        </div>
      )}

      {reqState?.status === 'error' && (
        <div className="main-status">
          <p className="status-error">Failed — {reqState.message}</p>
        </div>
      )}
    </main>
  )
}
