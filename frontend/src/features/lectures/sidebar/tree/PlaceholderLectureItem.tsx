import { jobState } from '@/features/downloads/contexts/DownloadJobsContext'
import type { DownloadJob } from '@/features/downloads/services/downloadServer'
import { JobProgressBar } from '@/features/downloads/components/RecordingJobList'
import '@/styles/spinner.css'
import '@/styles/sidebar-tree.css'

// A not-yet-existing lecture: its download's name and ETA bar. Not clickable, as its page would 404.
export default function PlaceholderLectureItem({ job }: { job: DownloadJob }) {
  const state = jobState(job)
  return (
    <li>
      <div
        className="lecture-btn lecture-placeholder"
        data-testid="lecture-placeholder"
        data-course={job.course}
        data-lecture={job.lecture}
        data-kind={job.kind}
      >
        <span className="lecture-mark lecture-mark--busy">
          <span className="spinner lecture-mark-spinner" />
        </span>
        <span className="lecture-placeholder-body">
          <span className="lecture-name" dir="auto">
            {job.lecture}
          </span>
          <JobProgressBar job={state} showTitle={false} />
        </span>
      </div>
    </li>
  )
}
