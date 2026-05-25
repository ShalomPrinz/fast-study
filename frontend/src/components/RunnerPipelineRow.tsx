import { useNavigate } from 'react-router-dom'
import { useRunnerStatus } from '../contexts/RunnerStatusContext'
import type { InFlightEntry } from '../types'

function RunnerInactive({ onClick }: { onClick: () => void }) {
  return (
    <div className="new-course-row">
      <button className="new-course-btn" onClick={onClick}>
        ⟳ Run incomplete pipelines
      </button>
    </div>
  )
}

function InFlightRow({ entry }: { entry: InFlightEntry }) {
  const navigate = useNavigate()
  const sleeping = entry.sleepingUntil
  const onClick = () => navigate(
    `/${encodeURIComponent(entry.course)}/${encodeURIComponent(entry.lecture)}${entry.kind === 'recitation' ? '?kind=recitation' : ''}`
  )
  return (
    <button className="runner-inflight-row" onClick={onClick} dir="auto">
      <span className="runner-inflight-lecture">{entry.course} / {entry.lecture}</span>
      <span className="runner-inflight-step">
        {sleeping
          ? `rate-limited until ${new Date(sleeping).toLocaleTimeString()}`
          : entry.step}
      </span>
    </button>
  )
}

export default function RunnerPipelineRow() {
  const { status, trigger: handleRunClick } = useRunnerStatus()
  const running = status?.runner.running ?? false
  const inFlight = status?.inFlight ?? []

  // Nothing running and nothing in-flight — show the CTA to kick off a sweep.
  if (!running && inFlight.length === 0) {
    return <RunnerInactive onClick={handleRunClick} />
  }

  return (
    <div className="runner-panel">
      {running && (
        <div className="runner-panel-header">
          Running pipelines… ({status!.runner.done}/{status!.runner.total})
        </div>
      )}
      {inFlight.map((entry) => (
        <InFlightRow key={`${entry.course}||${entry.lecture}||${entry.kind}`} entry={entry} />
      ))}
    </div>
  )
}
