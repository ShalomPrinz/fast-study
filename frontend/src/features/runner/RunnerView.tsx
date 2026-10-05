import { Fragment, type ReactNode } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import type { InFlightEntry, Kind, Lecture } from '@/types'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useAutoRun, useDriveEnabled, useNightlyRun } from '@/shared/contexts/SettingsContext'
import { useRemoteInflightState } from '@/features/lectures/hooks/useRemoteInflightState'
import { PIPELINE, visiblePipeline } from '@/features/lectures/constants/pipeline'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import ProgressBar from '@/shared/components/ProgressBar'
import StatusNode, { type StatusNodeState } from '@/shared/components/StatusNode'
import Icon from '@/shared/components/Icon'
import { moveToFront, runPipeline } from '@/services/backend'
import { toast, toastInitResult } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { formatClockTime } from '@/shared/utils/format'
import { lectureRoute } from '@/shared/utils/url'
import { notQueued } from './utils/notQueued'
import { canMoveToFront, headerState, nightlyPicksUp } from './utils/runnerState'
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

interface RowProps {
  course: string
  lecture: string
  kind: Kind
  state: StatusNodeState
  chip?: ReactNode
}

// The status node, title, course and chip every row here shows, whatever acts on it.
function RowContent({ course, lecture, kind, state, chip }: RowProps) {
  return (
    <>
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
    </>
  )
}

/** An in-flight lecture as a compact row; the whole row is the link to it. */
function LectureRow(props: RowProps) {
  return (
    <Link
      className="pipeline-row runner-row"
      to={lectureRoute(props.course, props.lecture, props.kind)}
    >
      <RowContent {...props} />
    </Link>
  )
}

/** A waiting lecture: its text runs `onActivate` (inert when absent), and only the trailing icon
 *  opens the lecture, so acting on a row never navigates by accident. */
function ActionRow({ onActivate, ...props }: RowProps & { onActivate?: () => void }) {
  const { t } = useLingui()
  return (
    <div className="pipeline-row runner-row runner-row--split">
      {onActivate ? (
        <button type="button" className="runner-row-main" onClick={onActivate}>
          <RowContent {...props} />
        </button>
      ) : (
        <div className="runner-row-main">
          <RowContent {...props} />
        </div>
      )}
      <span className="runner-row-sep" aria-hidden="true" />
      <Link
        className="pipeline-icon-btn"
        to={lectureRoute(props.course, props.lecture, props.kind)}
        title={t`Open lecture`}
        aria-label={t`Open lecture`}
      >
        <Icon icon="external-link" />
      </Link>
    </div>
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
            {t`${remote.progress.completed} of ${remote.progress.total} parts`}
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
  const nightlyRun = useNightlyRun()

  const header = headerState(status)
  const inFlight = status?.inFlight ?? []
  const queue = status?.queue ?? []
  const pending = notQueued(courses, queue, inFlight, driveEnabled)

  const [focus, ...alsoRunning] = inFlight
  // One line for a page with nothing in any section; a lone empty section keeps only its title.
  const allEmpty = inFlight.length === 0 && queue.length === 0 && pending.length === 0
  const none = t`None`

  // Runs beside the runner, not through its queue — the same call as a lecture's "run remaining".
  async function runNow(course: string, lecture: string, kind: Kind) {
    try {
      toastInitResult(await runPipeline(course, lecture, kind), {
        busy: t`Pipeline already running`,
      })
    } catch (e) {
      toastFailure(e)
    }
  }

  // A real move reorders the list over SSE; `not_queued` means it started or left meanwhile.
  async function bumpToFront(course: string, lecture: string, kind: Kind) {
    try {
      const result = await moveToFront(course, lecture, kind)
      if (result.status === 'not_queued') toast('info', t`That lecture is no longer queued`)
    } catch (e) {
      toastFailure(e)
    }
  }

  const autoRunLabel = {
    full: t`Auto-run: the whole pipeline`,
    audio: t`Auto-run: audio only`,
    off: t`Auto-run: off`,
  }[autoRun]

  const meta: ReactNode[] = [
    header.kind !== 'idle' ? (
      <span className="page-header-state page-header-state--running">
        <span className="page-header-state-dot" />
        {header.kind === 'sweep' ? (
          t`Running · lecture ${header.current} of ${header.total}`
        ) : (
          <Plural value={header.count} one="# lecture running" other="# lectures running" />
        )}
      </span>
    ) : (
      <span>
        <Trans>Nothing running</Trans>
      </span>
    ),
    <span>{autoRunLabel}</span>,
  ]

  return (
    <main className="main-view main-view--page">
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
        <div className="page-column runner-page">
          {allEmpty ? (
            <p className="runner-empty">
              <StatusNode state="done" />
              <Trans>All caught up — every lecture is finished.</Trans>
            </p>
          ) : (
            <div className="runner-grid">
              <div className="stack">
                <section>
                  <div className="section-head">
                    <h2 className="section-title">
                      <Trans>Now running</Trans>
                    </h2>
                    {inFlight.length > 0 && (
                      <span className="section-count">
                        <Plural
                          value={inFlight.length}
                          one="# lecture running"
                          other="# lectures running"
                        />
                      </span>
                    )}
                  </div>

                  {focus ? (
                    <>
                      <FocusCard
                        key={`${focus.course}||${focus.lecture}||${focus.kind}`}
                        entry={focus}
                      />
                      {alsoRunning.length > 0 && (
                        <div className="pipeline-card runner-also">
                          {alsoRunning.map((entry) => {
                            const stage = PIPELINE.find((p) => p.step === entry.step)
                            return (
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
                                    <span className="chip chip--accent">
                                      {stage
                                        ? t(stage.runningLabel ?? stage.stageLabel)
                                        : entry.step}
                                    </span>
                                  )
                                }
                              />
                            )
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="queue-note">{none}</p>
                  )}
                </section>

                <section>
                  <div className="section-head">
                    <h2 className="section-title">
                      <Trans>Queued</Trans>
                    </h2>
                    {queue.length > 0 && (
                      <span className="section-count">
                        {queue.length} · <Trans>the runner takes these in order</Trans>
                      </span>
                    )}
                  </div>

                  {queue.length > 0 ? (
                    <div className="pipeline-card">
                      {queue.map((entry, i) => (
                        <ActionRow
                          key={`${entry.course}||${entry.lecture}||${entry.kind}`}
                          course={entry.course}
                          lecture={entry.lecture}
                          kind={entry.kind}
                          state="pending"
                          onActivate={
                            canMoveToFront(i)
                              ? () => void bumpToFront(entry.course, entry.lecture, entry.kind)
                              : undefined
                          }
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
                    <p className="queue-note">{none}</p>
                  )}
                </section>
              </div>

              <div className="stack">
                <section>
                  <div className="section-head">
                    <h2 className="section-title">
                      <Trans>Not queued</Trans>
                    </h2>
                    {pending.length > 0 && (
                      <span className="head-actions">
                        <span className="section-count">
                          <Plural
                            value={pending.length}
                            one="# lecture has work left"
                            other="# lectures have work left"
                          />
                        </span>
                        <button className="btn btn--primary" onClick={() => void trigger()}>
                          <Trans>Run these now</Trans>
                        </button>
                      </span>
                    )}
                  </div>

                  {pending.length > 0 ? (
                    <>
                      <div className="pipeline-card">
                        {pending.map((item) => (
                          <ActionRow
                            key={`${item.course}||${item.lecture}||${item.kind}`}
                            course={item.course}
                            lecture={item.lecture}
                            kind={item.kind}
                            state="pending"
                            onActivate={() => void runNow(item.course, item.lecture, item.kind)}
                          />
                        ))}
                      </div>
                      <p className="queue-note">
                        {nightlyPicksUp(nightlyRun, autoRun) ? (
                          <Trans>
                            These won't start until you run them, or until the daily run does.
                          </Trans>
                        ) : (
                          <Trans>These won't start until you run them.</Trans>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="queue-note">{none}</p>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
