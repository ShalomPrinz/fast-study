import { jobState } from '@/features/downloads/contexts/DownloadJobsContext'
import type { DownloadJob } from '@/features/downloads/services/downloadServer'
import { JobProgressBar } from '@/features/downloads/components/RecordingJobList'
import '@/styles/sidebar-tree.css'

// A not-yet-existing lecture: its download's name and ETA bar. Not clickable, as its page would 404.
export default function PlaceholderLectureItem({
  job,
  timeline = '',
}: {
  job: DownloadJob
  timeline?: string
}) {
  return (
    <li className={timeline}>
      <div
        className="lecture-btn lecture-placeholder"
        data-testid="lecture-placeholder"
        data-course={job.course}
        data-lecture={job.lecture}
        data-kind={job.kind}
      >
        <span className="lecture-mark lecture-mark--download" />
        <span className="lecture-placeholder-body">
          <span className="lecture-name" dir="auto">
            {job.lecture}
          </span>
          <JobProgressBar job={jobState(job)} showTitle={false} stallNote={false} />
        </span>
      </div>
    </li>
  )
}
