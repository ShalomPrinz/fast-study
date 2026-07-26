import { useNavigate } from 'react-router-dom'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { lectureRoute } from '@/shared/utils/url'
import type { InFlightEntry } from '@/types'

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
  const onClick = () => navigate(lectureRoute(entry.course, entry.lecture, entry.kind))
  return (
    <button className="runner-inflight-row" onClick={onClick} dir="auto">
      <span className="runner-inflight-lecture">
        {entry.course} / {entry.lecture}
      </span>
      <span className="runner-inflight-step">
        {sleeping ? `rate-limited until ${new Date(sleeping).toLocaleTimeString()}` : entry.step}
      </span>
    </button>
  )
}

export default function RunnerPipelineRow() {
  const { status, trigger: handleRunClick } = useRunnerStatus()
  const running = status?.runner.running ?? false
  const inFlight = status?.inFlight ?? []

  const inFlightRows = inFlight.map((entry) => (
    <InFlightRow key={`${entry.course}||${entry.lecture}||${entry.kind}`} entry={entry} />
  ))

  if (!running) {
    return (
      <>
        <RunnerInactive onClick={handleRunClick} />
        {inFlight.length > 0 && <div className="runner-panel">{inFlightRows}</div>}
      </>
    )
  }

  // `done` counts finished lectures; display the 1-indexed current one, capped at total.
  const runnerCurrent = Math.min(status!.runner.done + 1, status!.runner.total)
  const runnerCurrentDisplay = `(${runnerCurrent}/${status!.runner.total})`

  return (
    <div className="runner-panel">
      <div className="runner-panel-header">Running pipelines… {runnerCurrentDisplay}</div>
      {inFlightRows}
    </div>
  )
}
