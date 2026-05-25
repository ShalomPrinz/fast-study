import { useNavigate } from 'react-router-dom'
import { useRunnerStatus } from '../contexts/RunnerStatusContext'

function RunnerInactive({ onClick }: { onClick: () => void }) {
  return (
    <div className="new-course-row">
      <button className="new-course-btn" onClick={onClick}>
        ⟳ Run incomplete pipelines
      </button>
    </div>
  )
}

export default function RunnerPipelineRow() {
  const { status: runnerStatus, trigger: handleRunClick } = useRunnerStatus()
  const navigate = useNavigate()

  if (!runnerStatus?.runner.running) {
    return <RunnerInactive onClick={handleRunClick} />
  }

  // TODO: if multiple pipelines are in-flight, show a list of them instead of just the first
  const current = runnerStatus.inFlight[0] ?? null
  const sleeping = current?.sleepingUntil ?? null
  const clickable = !!current && !sleeping
  return (
    <div className="new-course-row">
      <button
        className="new-course-btn"
        style={{ cursor: clickable ? 'pointer' : 'default' }}
        disabled={!clickable}
        onClick={clickable ? () => navigate(
          `/${encodeURIComponent(current!.course)}/${encodeURIComponent(current!.lecture)}${current!.kind === 'recitation' ? '?kind=recitation' : ''}`
        ) : undefined}
        dir="auto"
      >
        {sleeping
          ? `Rate-limited, resuming at ${new Date(sleeping).toLocaleTimeString()}`
          : current
            ? `Running: ${current.course} / ${current.lecture} — ${current.step} (${runnerStatus.runner.done}/${runnerStatus.runner.total})`
            : `Running pipelines… (${runnerStatus.runner.done}/${runnerStatus.runner.total})`}
      </button>
    </div>
  )
}
