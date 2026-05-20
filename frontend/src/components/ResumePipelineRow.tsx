import { useNavigate } from 'react-router-dom'
import { useResumeStatus } from '../contexts/ResumeStatusContext'

export default function ResumePipelineRow() {
  const { status: resumeStatus, trigger: handleResumeClick } = useResumeStatus()
  const navigate = useNavigate()

  if (!resumeStatus?.running) {
    return (
      <div className="new-course-row">
        <button className="new-course-btn" onClick={handleResumeClick}>
          ⟳ Run incomplete pipelines
        </button>
      </div>
    )
  }

  const current = resumeStatus.current
  const clickable = !!current && !resumeStatus.sleepingUntil
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
        {resumeStatus.sleepingUntil
          ? `Rate-limited, resuming at ${new Date(resumeStatus.sleepingUntil).toLocaleTimeString()}`
          : current
            ? `Running: ${current.course} / ${current.lecture} — ${current.step} (${resumeStatus.done}/${resumeStatus.total})`
            : `Resuming pipelines… (${resumeStatus.done}/${resumeStatus.total})`}
      </button>
    </div>
  )
}
