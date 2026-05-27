import { useNavigate } from 'react-router-dom'
import { useRunnerStatus } from '@/contexts/RunnerStatusContext'
import { lectureRoute } from '@/utils/route'
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

  // done is 0-indexed but we want to show 1-indexed progress, so add 1 - but cap at total.
  const runnerCurrent = Math.min(status!.runner.done + 1, status!.runner.total)
  const runnerCurrentDisplay = `(${runnerCurrent}/${status!.runner.total})`

  return (
    <div className="runner-panel">
      {running && (
        <div className="runner-panel-header">
          Running pipelines… {runnerCurrentDisplay}
        </div>
      )}
      {inFlight.map((entry) => (
        <InFlightRow key={`${entry.course}||${entry.lecture}||${entry.kind}`} entry={entry} />
      ))}
    </div>
  )
}
