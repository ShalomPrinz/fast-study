import { Fragment, type ReactNode } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import type { InFlightEntry, Kind, Lecture } from '@/types'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useAutoRun, useDriveEnabled } from '@/shared/contexts/SettingsContext'
import { useRemoteInflightState } from '@/features/lectures/hooks/useRemoteInflightState'
import { visiblePipeline } from '@/features/lectures/constants/pipeline'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import ProgressBar from '@/shared/components/ProgressBar'
import StatusNode, { type StatusNodeState } from '@/shared/components/StatusNode'
import { formatClockTime } from '@/shared/utils/format'
import { lectureRoute } from '@/shared/utils/url'
import { notQueued } from './utils/notQueued'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/pipeline-card.css'
import './RunnerView.css'

function findLecture(
  courses: ReturnType<typeof useCourseTreeContext>['courses'],
  course: string,
  lecture: string,
  kind: Kind,
): Lecture | null {
  const node = courses.find((c) => c.name === course)
  if (!node) return null
  const list = kind === 'recitation' ? node.recitations : node.lectures
  return list.find((l) => l.name === lecture) ?? null
}

/** One lecture as a compact row. The whole row is the link to it, so every listing here reaches
 *  the lecture the same way. */
function LectureRow({
  course,
  lecture,
  kind,
  state,
  chip,
}: {
  course: string
  lecture: string
  kind: Kind
  state: StatusNodeState
  chip?: ReactNode
}) {
  return (
    <Link className="pipeline-row runner-row" to={lectureRoute(course, lecture, kind)}>
      <StatusNode state={state} />
      <div className="pipeline-row-body">
        <div className="row-title" dir="auto">
          {lecture}
        </div>
        <div className="row-course">
          <span dir="auto">{course}</span>
          {kind === 'recitation' && (
            <>
              {' · '}
              <Trans>recitation</Trans>
            </>
          )}
        </div>
      </div>
      {chip}
    </Link>
  )
}

/** The lecture the runner is actually on: its stage rail and its ETA, the one place on this page
 *  that shows more than a line. */
function FocusCard({ entry }: { entry: InFlightEntry }) {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const driveEnabled = useDriveEnabled()
  const node = findLecture(courses, entry.course, entry.lecture, entry.kind)
  const files = node?.files ?? null
  const remote = useRemoteInflightState({
    course: entry.course,
    lecture: entry.lecture,
    kind: entry.kind,
    files,
    transcribePartial: node?.transcribePartial ?? null,
  })

  // The rail is the steps only — `video.mp4` is the input, not a stage the runner walks.
  const steps = (files ? visiblePipeline(driveEnabled, files) : []).filter((p) => p.step)
  const currentIndex = steps.findIndex((p) => p.step === entry.step)

  return (
    <div className="focus-card">
      <div className="focus-head">
        <div>
          <div className="row-course" dir="auto">
            {entry.course}
          </div>
          <div className="focus-title" dir="auto">
            {entry.lecture}
          </div>
        </div>
        {currentIndex >= 0 && (
          <span className="chip chip--accent">
            {t`Step ${currentIndex + 1} of ${steps.length}`}
          </span>
        )}
      </div>

      {steps.length > 0 && (
        <div className="stage-rail">
          {steps.map(({ file, step, stageLabel }, i) => {
            const done = files?.[file].exists ?? false
            const running = step === entry.step
            return (
              <Fragment key={file}>
                {i > 0 && <span className="stage-sep" />}
                <span className={`stage${running ? ' stage--current' : ''}`}>
                  <StatusNode state={done ? 'done' : running ? 'running' : 'pending'} />
                  {t(stageLabel)}
                </span>
              </Fragment>
            )
          })}
        </div>
      )}

      <div>
        {remote?.progress && (
          <p className="row-sub">
            {t`${remote.progress.completed} of ${remote.progress.total} chunks`}
          </p>
        )}
        {entry.sleepingUntil ? (
          <p className="row-sub row-sub--warn">
            {t`Rate limited — resumes at ${formatClockTime(entry.sleepingUntil)}`}
          </p>
        ) : (
          remote && (
            <ProgressBar
              stats={remote.timingStats}
              startedAt={remote.startedAt}
              completedFraction={remote.completedFraction}
            />
          )
        )}
      </div>
    </div>
  )
}

// Live view of the one runner queue: what it is on, what it will take next, and what has work
// left that nothing is scheduled to do.
export default function RunnerView() {
  const { t } = useLingui()
  const { status, trigger } = useRunnerStatus()
  const { courses } = useCourseTreeContext()
  const driveEnabled = useDriveEnabled()
  const autoRun = useAutoRun()

  const running = status?.runner.running ?? false
  const inFlight = status?.inFlight ?? []
  const queue = status?.queue ?? []
  const pending = notQueued(courses, queue, inFlight, driveEnabled)

  const [focus, ...alsoRunning] = inFlight
  // `done` counts finished lectures; display the 1-indexed current one, capped at total.
  const current = status ? Math.min(status.runner.done + 1, status.runner.total) : 0

  const autoRunLabel = {
    full: t`Auto-run: the whole pipeline`,
    audio: t`Auto-run: audio only`,
    off: t`Auto-run: off`,
  }[autoRun]

  const meta: ReactNode[] = [
    running ? (
      <span className="page-header-state page-header-state--running">
        <span className="page-header-state-dot" />
        {t`Running · lecture ${current} of ${status!.runner.total}`}
      </span>
    ) : (
      <span>
        <Trans>Nothing running</Trans>
      </span>
    ),
    <span>{autoRunLabel}</span>,
  ]

  return (
    <main className="main-view main-view--page runner-page">
      <PageHeader
        title={t`Running pipelines`}
        meta={meta.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <PageHeaderDot />}
            {item}
          </Fragment>
        ))}
      />

      <div className="page-body">
        <div className="page-column page-column--centered">
          <div className="stack">
            <section>
              <div className="section-head">
                <h2 className="section-title">
                  <Trans>Now running</Trans>
                </h2>
                <span className="section-count">
                  <Plural
                    value={inFlight.length}
                    one="# lecture in flight"
                    other="# lectures in flight"
                  />
                </span>
              </div>

              {focus ? (
                <>
                  <FocusCard
                    key={`${focus.course}||${focus.lecture}||${focus.kind}`}
                    entry={focus}
                  />
                  {alsoRunning.length > 0 && (
                    <div className="pipeline-card runner-also">
                      {alsoRunning.map((entry) => (
                        <LectureRow
                          key={`${entry.course}||${entry.lecture}||${entry.kind}`}
                          course={entry.course}
                          lecture={entry.lecture}
                          kind={entry.kind}
                          state={entry.sleepingUntil ? 'paused' : 'running'}
                          chip={
                            entry.sleepingUntil ? (
                              <span className="chip chip--warn">
                                {t`Quota · resumes ${formatClockTime(entry.sleepingUntil)}`}
                              </span>
                            ) : (
                              <span className="chip chip--accent">{entry.step}</span>
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="queue-note">
                  <Trans>No step is running right now.</Trans>
                </p>
              )}
            </section>

            <section>
              <div className="section-head">
                <h2 className="section-title">
                  <Trans>Queued</Trans>
                </h2>
                <span className="section-count">
                  {queue.length} · <Trans>the runner takes these in order</Trans>
                </span>
              </div>

              {queue.length > 0 ? (
                <div className="pipeline-card">
                  {queue.map((entry, i) => (
                    <LectureRow
                      key={`${entry.course}||${entry.lecture}||${entry.kind}`}
                      course={entry.course}
                      lecture={entry.lecture}
                      kind={entry.kind}
                      state="pending"
                      chip={
                        i === 0 ? (
                          <span className="chip">
                            <Trans>Next</Trans>
                          </span>
                        ) : entry.depth === 'audio' ? (
                          <span className="chip">
                            <Trans>Audio only</Trans>
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="queue-note">
                  <Trans>Nothing is waiting for the runner.</Trans>
                </p>
              )}
            </section>

            <section>
              <div className="section-head">
                <h2 className="section-title">
                  <Trans>Not queued</Trans>
                </h2>
                <span className="head-actions">
                  <span className="section-count">
                    <Plural
                      value={pending.length}
                      one="# lecture has work left"
                      other="# lectures have work left"
                    />
                  </span>
                  <button
                    className="btn btn--primary"
                    onClick={() => void trigger()}
                    disabled={pending.length === 0}
                  >
                    <Trans>Run these now</Trans>
                  </button>
                </span>
              </div>

              {pending.length > 0 ? (
                <>
                  <div className="pipeline-card">
                    {pending.map((item) => (
                      <LectureRow
                        key={`${item.course}||${item.lecture}||${item.kind}`}
                        course={item.course}
                        lecture={item.lecture}
                        kind={item.kind}
                        state="pending"
                      />
                    ))}
                  </div>
                  <p className="queue-note">
                    <Trans>
                      Nothing is coming for these until you run them, or the nightly 03:00 pass
                      does.
                    </Trans>
                  </p>
                </>
              ) : (
                <p className="queue-note">
                  <Trans>Every lecture with a video is finished or already spoken for.</Trans>
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
