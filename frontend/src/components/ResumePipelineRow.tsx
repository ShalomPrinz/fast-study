import { useNavigate } from 'react-router-dom'
import { useResumeStatus } from '../contexts/ResumeStatusContext'

function RunnerInactive({ onClick }: { onClick: () => void }) {
  return (
    <div className="new-course-row">
      <button className="new-course-btn" onClick={onClick}>
        ⟳ Run incomplete pipelines
      </button>
    </div>
  )
}

export default function ResumePipelineRow() {
  const { status: resumeStatus, trigger: handleResumeClick } = useResumeStatus()
  const navigate = useNavigate()

  if (!resumeStatus?.resume.running) {
    return <RunnerInactive onClick={handleResumeClick} />
  }

  // TODO: if multiple pipelines are in-flight, show a list of them instead of just the first
  const current = resumeStatus.inFlight[0] ?? null
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
            ? `Running: ${current.course} / ${current.lecture} — ${current.step} (${resumeStatus.resume.done}/${resumeStatus.resume.total})`
            : `Resuming pipelines… (${resumeStatus.resume.done}/${resumeStatus.resume.total})`}
      </button>
    </div>
  )
}
