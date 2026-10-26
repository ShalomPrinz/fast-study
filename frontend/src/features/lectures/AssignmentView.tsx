import { Trans, useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { useParams } from 'react-router-dom'
import Tooltip from '@/shared/components/Tooltip'
import Icon from '@/shared/components/Icon'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import PageHeader from '@/shared/components/PageHeader'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { assignmentNotFound, routeMiss } from '@/shared/utils/notFound'
import { FileSize } from '@/shared/components/FileSize'
import { routeParam } from '@/shared/utils/routes'
import {
  fetchAssignmentDoc,
  fetchSummaryContent,
  setAssignmentFileAttach,
} from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useSupportedMaterials } from '@/shared/contexts/SupportedMaterialsContext'
import {
  materialAttached,
  materialSupported,
  materialTooLarge,
} from '@/features/lectures/utils/materials'
import { assignmentClipboardText } from '@/features/lectures/utils/aiChat'
import { chosenSummaries, docInputs, inputsLocked } from '@/features/lectures/utils/assignmentDocs'
import {
  canOpenWith,
  canReveal,
  openAssignmentFile,
  openAssignmentFileWith,
  revealAssignmentFile,
} from '@/services/open'
import StudyDoneButton from './components/StudyDoneButton'
import { MaterialNameButton } from './components/MaterialChip'
import OpenWithMenu from './components/OpenWithMenu'
import StudyWithAiCard, { type StudyWithAiCopy } from './components/StudyWithAiCard'
import AssignmentDocCard from './components/AssignmentDocCard'
import CourseMaterialBox from './components/CourseMaterialBox'
import '@/styles/button.css'
import '@/styles/panel.css'
import './components/MaterialChip.css'
import './AssignmentView.css'

// A course assignment: its files (each opens in the OS default app, with a "send to Gemini" switch), the
// course material chosen with it, and the study cards built from both. See docs/LECTURES.md.
export default function AssignmentView() {
  const { t } = useLingui()
  const params = useParams<{ course: string; assignment: string }>()
  const course = routeParam(params.course)
  const assignment = routeParam(params.assignment)
  const { courses, loadFailed } = useCourseTreeContext()
  const supported = useSupportedMaterials()
  const { getAssignmentRun, getAssignmentError } = useRunnerStatus()

  const miss = routeMiss(assignmentNotFound(courses, course, assignment), loadFailed)
  if (miss) return <NotFoundPanel {...miss} />
  const courseNode = courses.find((c) => c.name === course)
  const node = courseNode?.assignments.find((a) => a.name === assignment)
  if (!courseNode || !node) return null
  const { files: fileRows, done, lectures: chosen, docs } = node

  const reveal = canReveal()
  const run = getAssignmentRun(course, assignment)
  const error = getAssignmentError(course, assignment)
  const locked = inputsLocked(run)
  const inputs = docInputs(node, courseNode, supported)
  const files = fileRows.length
  const lectures = chosen.length
  const aiReady = inputs.summaries > 0 || docs.intuition !== null || docs.solution !== null

  async function toggleAttach(name: string, attach: boolean) {
    try {
      await setAssignmentFileAttach(course, assignment, name, attach)
    } catch (e) {
      toastFailure(e)
    }
  }

  const aiCopy: StudyWithAiCopy = {
    subtitle: (provider) =>
      t`Copies the chosen summaries and the generated guides, then opens ${provider}.`,
    emptySubtitle: t`Available once you choose course material or generate a guide.`,
    hint: t`Available once you choose course material or generate a guide.`,
    info: t`Paste the assignment material with Ctrl+V, we already copied it for you.`,
    copied: t`Assignment material copied — paste it in the chat with Ctrl+V.`,
    copyFailed: t`Couldn't copy the assignment material. Try again.`,
  }

  async function collectAiText(): Promise<string> {
    const summaries = chosenSummaries(courseNode!, chosen)
    const [texts, intuition, solution] = await Promise.all([
      Promise.all(summaries.map((s) => fetchSummaryContent(course, s.entry.name, s.entry.kind))),
      docs.intuition ? fetchAssignmentDoc(course, assignment, 'intuition') : null,
      docs.solution ? fetchAssignmentDoc(course, assignment, 'solution') : null,
    ])
    const prompt = t`I'm working on this assignment and want to understand it in depth, not just get answers. Below are the course material I chose and any guides I already have.

To start, reply with a single sentence — "Which question do you want to work on first?" — followed by a numbered list of the assignment's questions, each with a one-line description.`
    return assignmentClipboardText({
      prompt,
      course,
      assignment,
      lectures: summaries.map((s, i) => ({
        kind: s.entry.kind,
        title: s.entry.name,
        summary: texts[i].content,
      })),
      intuition: intuition?.content ?? null,
      solution: solution?.content ?? null,
    })
  }

  return (
    <main
      className="main-view main-view--page"
      data-testid="assignment-view"
      data-course={course}
      data-assignment={assignment}
    >
      <PageHeader
        eyebrow={course}
        title={assignment}
        meta={
          <span>
            {t`${plural(files, { one: '# file', other: '# files' })} · ${plural(lectures, { 0: 'no course material', one: '# lecture attached', other: '# lectures attached' })}`}
          </span>
        }
        actions={
          <StudyDoneButton course={course} lecture={assignment} kind="assignment" done={done} />
        }
      />
      <div className="page-body">
        <div className="page-column assignment-page">
          <section className="assignment-section">
            <div className="assignment-section-head">
              <h2 className="assignment-section-title">
                <Trans>Materials</Trans>
              </h2>
              <span className="assignment-section-hint">
                <Trans>Files that are switched on are sent to Gemini.</Trans>
              </span>
            </div>
            <ul className="assignment-files">
              {fileRows.map((f) => {
                const name = f.name
                const canSupport = supported !== null && materialSupported(f, supported)
                const attached = materialAttached(f, supported)
                const switchHint =
                  !canSupport && supported !== null
                    ? t`Gemini can't read this file type`
                    : attached
                      ? t`Sent to Gemini`
                      : t`Not sent to Gemini`
                return (
                  <li key={f.name} className="assignment-file" data-testid="assignment-file">
                    <Icon icon="file" />
                    <MaterialNameButton
                      label={f.name}
                      hint={t`Open file`}
                      onOpen={() => openAssignmentFile(course, assignment, f.name)}
                    />
                    <span className="assignment-file-size">
                      <FileSize bytes={f.size} />
                    </span>
                    {materialTooLarge(f, supported) && (
                      <Tooltip
                        content={t`Over 10 MB — generating might fail while this is attached`}
                      >
                        <span
                          className="material-chip-large"
                          role="img"
                          aria-label={t`Over 10 MB — generating might fail while this is attached`}
                        >
                          <Icon icon="warning" />
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip content={switchHint}>
                      <label className="material-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={attached}
                          disabled={!canSupport || locked}
                          aria-label={t`Send ${name} to Gemini`}
                          onChange={(e) => void toggleAttach(f.name, e.target.checked)}
                        />
                        <span className="material-switch-track" />
                      </label>
                    </Tooltip>
                    {canOpenWith() && (
                      <OpenWithMenu
                        onOpenWith={() => openAssignmentFileWith(course, assignment, f.name)}
                      />
                    )}
                    <Tooltip content={reveal ? undefined : t`Needs the desktop app`}>
                      <button
                        className="btn btn--ghost assignment-file-reveal"
                        disabled={!reveal}
                        onClick={() => revealAssignmentFile(course, assignment, f.name)}
                      >
                        <Icon icon="folder" />
                        <Trans>Show in folder</Trans>
                      </button>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
            <CourseMaterialBox
              course={courseNode}
              assignment={assignment}
              chosen={chosen}
              locked={locked}
            />
          </section>

          <section className="assignment-section">
            <div className="assignment-section-head">
              <h2 className="assignment-section-title">
                <Trans>Study from the assignment</Trans>
              </h2>
            </div>
            <div className="assignment-cards">
              <StudyWithAiCard ready={aiReady} copy={aiCopy} collect={collectAiText} />
              {(['intuition', 'solution'] as const).map((doc) => (
                <AssignmentDocCard
                  key={doc}
                  course={course}
                  assignment={assignment}
                  doc={doc}
                  info={docs[doc]}
                  run={run}
                  error={error}
                  inputs={inputs}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
