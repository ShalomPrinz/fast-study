import { Fragment, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import type { Step, FileName, MaterialInfo } from '@/types'
import { deleteFile, deleteMaterial, fileUrl, materialUrl } from '@/services/database'
import { runStep, runPipeline } from '@/services/backend'
import { useRemoteInflightState } from '@/features/lectures/hooks/useRemoteInflightState'
import { useLectureRoute } from '@/features/lectures/hooks/useLectureRoute'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useDriveEnabled } from '@/shared/contexts/SettingsContext'
import {
  visiblePipeline,
  STEP_FILE,
  STEP_ERROR_LABEL,
} from '@/features/lectures/constants/pipeline'
import { kindQuery } from '@/shared/utils/url'
import { formatBytes, formatDuration } from '@/shared/utils/format'
import { toastInitResult } from '@/services/toaster'
import PdfWarningBadge from '@/shared/components/PdfWarningBadge'
import { pdfBadge } from '@/features/lectures/utils/pdfBadge'
import { materialIndicator } from '@/features/lectures/utils/materialIndicator'
import { lectureNotFound } from '@/shared/utils/notFound'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import ConfirmModal from '@/shared/components/ConfirmModal'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import ProgressBar from '@/shared/components/ProgressBar'
import StatusNode from '@/shared/components/StatusNode'
import Icon from '@/shared/components/Icon'
import LectureActionsMenu from './components/LectureActionsMenu'
import type { LectureAction } from './components/LectureActionsMenu'
import '@/styles/spinner.css'
import '@/styles/panel.css'
import '@/styles/modal.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/pipeline-card.css'
import './MainView.css'

interface RotateTarget {
  file: FileName
  step: Step
  toDelete: FileName[]
}

// The chip on the Summary row: how the lecture's materials relate to the summary it will produce.
function MaterialIndicator({
  materials,
  summaryExists,
  summaryMtime,
}: {
  materials: MaterialInfo[]
  summaryExists: boolean
  summaryMtime: number | null
}) {
  const { text, cls } = materialIndicator(materials, summaryExists, summaryMtime)

  return <span className={`chip material-indicator ${cls}`}>{text}</span>
}

function RateLimitPanel({
  sleepingUntil,
  progress,
}: {
  sleepingUntil: string
  progress: { completed: number; total: number } | null
}) {
  const { t } = useLingui()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const remaining = Math.max((new Date(sleepingUntil).getTime() - now) / 1000, 0)

  return (
    <div className="rate-limit-panel">
      <h4 className="rate-limit-title">
        <Trans>Groq rate limit reached</Trans>
      </h4>
      {progress && (
        <p className="rate-limit-progress">
          <Trans>
            {progress.completed}/{progress.total} chunks transcribed so far
          </Trans>
        </p>
      )}
      <p className="rate-limit-countdown">
        {remaining > 0 ? t`Retry in ${formatDuration(remaining)}` : t`Ready to retry`}
      </p>
    </div>
  )
}

export default function MainView() {
  const { t } = useLingui()
  const { course, lecture, kind, files, materials, transcribePartial } = useLectureRoute()
  const { courses, loaded, refreshCourses } = useCourseTreeContext()
  const driveEnabled = useDriveEnabled()
  const navigate = useNavigate()
  const [rotateTarget, setRotateTarget] = useState<RotateTarget | null>(null)
  const [materialToDelete, setMaterialToDelete] = useState<string | null>(null)

  const { isInFlight, getError } = useRunnerStatus()
  const inflight = isInFlight(course, lecture, kind)
  const lectureError = getError(course, lecture, kind)
  const remote = useRemoteInflightState({ course, lecture, kind, files, transcribePartial })

  if (!course || !lecture) return null

  if (!loaded) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }

  const missing = lectureNotFound(courses, course, lecture, kind)
  if (missing) return <NotFoundPanel message={missing} />

  // The tree has this lecture, so files is set; the guard is for the type only.
  if (!files) return null

  const stages = visiblePipeline(driveEnabled, files)
  const runningFile = remote ? STEP_FILE[remote.step] : null
  const hasAnyStepFile = stages.some(({ file, step }) => step && files[file].exists)
  const pdfExists = files['summary.pdf'].exists
  const pdfUploaded = files['drive_url.txt'].exists
  const summaryExists = files['summary.md'].exists
  const hasActions = stages.some(({ file, step }) => step && !files[file].exists)

  const summaryMtime = files['summary.md'].mtime
  const stageCount = stages.length
  const doneCount = stages.filter(({ file }) => files[file].exists).length
  const videoSize = files['video.mp4'].exists ? files['video.mp4'].size : null

  async function handleStep(step: Step) {
    const initResult = await runStep(course, lecture, step, kind)
    toastInitResult(initResult, {
      busy: t`Step already running`,
      error: t(STEP_ERROR_LABEL[step]),
    })
    refreshCourses()
  }

  async function handleRotate(step: Step, filesToDelete: FileName[]) {
    await Promise.all(filesToDelete.map((file) => deleteFile(course, lecture, file, kind)))
    refreshCourses()
    handleStep(step)
  }

  async function handleRunRemaining() {
    const result = await runPipeline(course, lecture, kind)
    toastInitResult(result, {
      busy: t`Pipeline already running`,
      error: t`Pipeline failed to start`,
    })
    refreshCourses()
  }

  function openRotateModal(file: FileName, step: Step) {
    const idx = stages.findIndex((p) => p.file === file)
    const toDelete = stages
      .slice(idx)
      .map((p) => p.file)
      .filter((f) => files![f].exists)
    setRotateTarget({ file, step, toDelete })
  }

  async function confirmDeleteMaterial(name: string) {
    setMaterialToDelete(null)
    await deleteMaterial(course, lecture, name, kind)
    refreshCourses()
  }

  function confirmRotate() {
    if (!rotateTarget) return
    const { step, toDelete } = rotateTarget
    setRotateTarget(null)
    handleRotate(step, toDelete)
  }

  function runningStateText(entry: (typeof stages)[number]): string {
    const stage = t(entry.runningLabel ?? entry.stageLabel)
    const stepNumber = stages.indexOf(entry) + 1
    return t`${stage} · step ${stepNumber} of ${stageCount}`
  }

  // The header's state line covers the two states worth calling out — running, and finished. An
  // idle half-done lecture says nothing here; the card's own caption already counts its stages.
  const runningEntry = remote ? stages.find((p) => p.step === remote.step) : undefined
  const stateItem = runningEntry ? (
    <span className="page-header-state page-header-state--running">
      <span className="page-header-state-dot" />
      {runningStateText(runningEntry)}
    </span>
  ) : doneCount === stageCount ? (
    <span className="page-header-state page-header-state--done">
      <span className="page-header-state-dot" />
      <Trans>Complete</Trans>
    </span>
  ) : null

  const metaItems: ReactNode[] = [
    stateItem,
    videoSize !== null ? <span>{t`${formatBytes(videoSize)} video`}</span> : null,
    materials.length > 0 ? (
      <span>
        <Plural value={materials.length} one="# material" other="# materials" />
      </span>
    ) : null,
  ].filter((item) => item !== null)

  const overflowActions: LectureAction[] = [
    summaryExists && {
      label: t`Edit summary`,
      onClick: () => navigate({ pathname: 'edit', search: kindQuery(kind) }),
    },
    pdfExists && {
      label: t`Open PDF in new tab`,
      onClick: () => window.open(fileUrl(course, lecture, 'summary.pdf', kind), '_blank'),
    },
    pdfUploaded && {
      label: t`Open in Drive`,
      onClick: () => window.open(files!['drive_url.txt'].url, '_blank'),
    },
  ].filter(Boolean) as LectureAction[]

  return (
    <main className="main-view main-view--page">
      <PageHeader
        eyebrow={course}
        title={lecture}
        meta={metaItems.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <PageHeaderDot />}
            {item}
          </Fragment>
        ))}
        actions={
          <>
            <LectureActionsMenu actions={overflowActions} />
            {hasActions && (
              <button className="btn btn--primary" onClick={handleRunRemaining} disabled={inflight}>
                <Trans>Run Remaining</Trans>
              </button>
            )}
          </>
        }
      />

      <div className="page-body">
        <div className="page-column">
          <div className="section-head">
            <h2 className="section-title">
              <Trans>Pipeline</Trans>
            </h2>
            <span className="section-count">{t`${doneCount} of ${stageCount} complete`}</span>
          </div>

          <div className="pipeline-card">
            {stages.map(({ file, step, stageLabel, runningLabel, actionLabel, prereq }) => {
              const exists = files[file].exists
              const isRunning = runningFile === file
              const prereqMet = !prereq || files[prereq].exists
              const isResumeTranscribe =
                file === 'transcript.txt' && !exists && files['transcript.partial.txt'].exists
              const buttonLabel = isResumeTranscribe
                ? t`Continue transcription`
                : actionLabel && t(actionLabel)

              const chunks = remote?.progress
              const size = files[file].size
              const subtitle =
                isRunning && chunks
                  ? t`${chunks.completed} of ${chunks.total} chunks`
                  : exists && size !== null
                    ? formatBytes(size)
                    : null

              return (
                <div
                  key={file}
                  className={`pipeline-row${isRunning ? ' pipeline-row--running' : ''}`}
                >
                  <StatusNode state={exists ? 'done' : isRunning ? 'running' : 'pending'} />
                  <div className="pipeline-row-body">
                    <div className="pipeline-stage-line">
                      <span
                        className={`pipeline-stage${exists || isRunning ? '' : ' pipeline-stage--pending'}`}
                      >
                        {isRunning && runningLabel ? t(runningLabel) : t(stageLabel)}
                      </span>
                      {file === 'summary.md' && (
                        <MaterialIndicator
                          materials={materials}
                          summaryExists={summaryExists}
                          summaryMtime={summaryMtime}
                        />
                      )}
                      {file === 'summary.pdf' && <PdfWarningBadge badge={pdfBadge(files)} />}
                    </div>
                    <p className="pipeline-file">
                      {file}
                      {subtitle && ` · ${subtitle}`}
                    </p>
                    {isRunning && remote && (
                      <ProgressBar
                        stats={remote.timingStats}
                        startedAt={remote.startedAt}
                        completedFraction={remote.completedFraction}
                        className="pipeline-progress"
                      />
                    )}
                  </div>
                  {exists && step && hasAnyStepFile && (
                    <button
                      className="pipeline-icon-btn"
                      title={t`Rotate ${file}`}
                      onClick={() => openRotateModal(file, step)}
                      disabled={inflight}
                    >
                      <Icon icon="rotate" />
                    </button>
                  )}
                  {!exists && !isRunning && step && (
                    <button
                      className="btn btn--ghost"
                      onClick={() => handleStep(step)}
                      disabled={inflight || !prereqMet}
                    >
                      {buttonLabel}
                    </button>
                  )}
                  {!exists && !step && (
                    <span className="pipeline-missing">
                      <Trans>not provided</Trans>
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {materials.length > 0 && (
            <>
              <div className="section-head section-head--materials">
                <h2 className="section-title">
                  <Trans>Materials</Trans>
                </h2>
              </div>
              <div className="material-chips">
                {materials.map((m) => (
                  <span key={m.name} className="chip material-chip">
                    <Icon icon="file" />
                    <button
                      className="material-chip-name"
                      title={t`Open material in new tab`}
                      onClick={() =>
                        window.open(materialUrl(course, lecture, m.name, kind), '_blank')
                      }
                      dir="auto"
                    >
                      {m.name}
                    </button>
                    <button
                      className="material-chip-delete"
                      title={t`Delete ${m.name}`}
                      onClick={() => setMaterialToDelete(m.name)}
                      disabled={inflight}
                    >
                      <Icon icon="trash" />
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}

          {lectureError && (
            <div className="lecture-error" role="alert">
              <strong>
                <Trans>Last error:</Trans>
              </strong>{' '}
              {lectureError}
            </div>
          )}

          {remote?.sleepingUntil != null && (
            <RateLimitPanel sleepingUntil={remote.sleepingUntil} progress={remote.progress} />
          )}
        </div>
      </div>

      {rotateTarget && (
        <ConfirmModal
          message={t`The following files will be deleted:`}
          postMessage={t`Then ${rotateTarget.file} will be regenerated.`}
          detail={
            <ul className="modal-file-list">
              {rotateTarget.toDelete.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={confirmRotate}
          onCancel={() => setRotateTarget(null)}
        />
      )}

      {materialToDelete && (
        <ConfirmModal
          message={t`${materialToDelete} will be deleted.`}
          postMessage={t`The other materials keep their names.`}
          onConfirm={() => confirmDeleteMaterial(materialToDelete)}
          onCancel={() => setMaterialToDelete(null)}
        />
      )}
    </main>
  )
}
