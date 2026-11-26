import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { Course, MergedPart } from '@/types'
import { createMergedPdf } from '@/services/backend'
import { routeParam } from '@/shared/utils/routes'
import { courseNotFound, routeMiss } from '@/shared/utils/notFound'
import { mergedRoute } from '@/shared/utils/url'
import { toastFailure } from '@/shared/utils/failure'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import Tooltip from '@/shared/components/Tooltip'
import PageHeader from '@/shared/components/PageHeader'
import MergedOrder from './components/MergedOrder'
import MergedPicker from './components/MergedPicker'
import {
  applyPrefill,
  canCreate,
  createBlocker,
  existingTitle,
  mergeable,
  movePart,
  pickGroups,
  pruneVanished,
  readPrefill,
  submitAction,
  toggleInOrder,
  toggleSection,
  type SubmitOutcome,
} from './utils/mergedSelection'
import '@/styles/spinner.css'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/settings-form.css'
import './MergedNewView.css'

function MergedNewBody({ course, node }: { course: string; node: Course }) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const location = useLocation()
  const groups = useMemo(() => pickGroups(node), [node])
  const [seed] = useState(() => {
    const prefill = readPrefill(location.state)
    if (!prefill) return { title: '', order: [] as MergedPart[], dropped: [] as MergedPart[] }
    const all = [...mergeable(groups.lectures), ...mergeable(groups.recitations)]
    return { title: prefill.title, ...applyPrefill(prefill, all) }
  })
  const [title, setTitle] = useState(seed.title)
  const [order, setOrder] = useState(seed.order)
  const [dropped, setDropped] = useState(seed.dropped)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState<string | null>(null)

  // A tree refresh can remove a ticked part for good; it leaves the order and is named like a prefill drop.
  useEffect(() => {
    const pruned = pruneVanished(order, [...groups.lectures, ...groups.recitations])
    if (pruned.dropped.length === 0) return
    setOrder(pruned.order)
    setDropped((d) => [...d, ...pruned.dropped])
  }, [groups, order])

  const blocker = createBlocker(title, order, submitting)
  const blockerText = {
    title: t`Enter a title to create the merged summary.`,
    selection: t`Tick at least one summary to merge.`,
    both: t`Enter a title and tick at least one summary.`,
    submitting: t`Creating the merged summary...`,
  }
  const overwriteTitle = confirmOverwrite ?? ''

  async function submit(overwrite: boolean) {
    setSubmitting(true)
    let outcome: SubmitOutcome
    try {
      const { status } = await createMergedPdf(course, title.trim(), order, overwrite)
      outcome = { status }
    } catch (error) {
      outcome = { error }
    }
    setSubmitting(false)
    const action = submitAction(outcome, overwrite)
    if (action === 'navigate') navigate(mergedRoute(course))
    else if (action === 'confirm-overwrite')
      setConfirmOverwrite(existingTitle(outcome, title.trim()))
    else if ('error' in outcome) toastFailure(outcome.error)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (canCreate(title, order) && !submitting) void submit(false)
  }

  return (
    <main className="main-view main-view--page">
      <PageHeader eyebrow={course} title={t`Create merged summary`} />
      <div className="page-body">
        <form className="merged-new" onSubmit={onSubmit}>
          <div className="merged-new-title">
            <label className="merged-new-label" htmlFor="merged-title">
              <Trans>Title</Trans>
            </label>
            <input
              id="merged-title"
              className="settings-input"
              dir="auto"
              value={title}
              placeholder={t`Merged summary title`}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          {dropped.length > 0 && (
            <p className="merged-note merged-note--dropped">
              <Trans>Left out, no longer in the course or without a summary PDF:</Trans>{' '}
              {dropped.map((p, i) => (
                <span key={`${p.kind}:${p.name}`}>
                  {i > 0 && ', '}
                  <bdi>{p.name}</bdi>
                </span>
              ))}
            </p>
          )}
          <div className="merged-cols">
            <MergedPicker
              course={course}
              groups={groups}
              single={!!node.lectures_only}
              order={order}
              onToggle={(part, on) => setOrder((o) => toggleInOrder(o, part, on))}
              onToggleSection={(items) => setOrder((o) => toggleSection(o, items))}
            />
            <div className="merged-order-stack">
              <section
                className="merged-col merged-col--order"
                aria-labelledby="merged-order-title"
              >
                <h2 className="merged-col-title" id="merged-order-title">
                  <Trans>Merge order</Trans>
                </h2>
                <div className="merged-col-body">
                  {order.length === 0 ? (
                    <p className="merged-hint merged-order-empty">
                      <Trans>Tick summaries to add them here, then drag to set their order.</Trans>
                    </p>
                  ) : (
                    <MergedOrder
                      order={order}
                      showKind={!node.lectures_only}
                      onMove={(from, to) => setOrder((o) => movePart(o, from, to))}
                    />
                  )}
                </div>
              </section>
              <div className="merged-new-actions">
                <Tooltip content={blocker ? blockerText[blocker] : undefined}>
                  <button
                    type="submit"
                    className="btn btn--primary merged-create"
                    disabled={!canCreate(title, order) || submitting}
                  >
                    <Trans>Create merged summary</Trans>
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </form>
      </div>
      {confirmOverwrite !== null && (
        <ConfirmModal
          message={t`A merged PDF titled "${overwriteTitle}" already exists. Create it anyway and replace it?`}
          confirmLabel={t`Replace`}
          cancelLabel={t`Cancel`}
          onCancel={() => setConfirmOverwrite(null)}
          onConfirm={() => {
            setConfirmOverwrite(null)
            void submit(true)
          }}
        />
      )}
    </main>
  )
}

// The create page: a title, the course's summaries to pick from, and the order they merge in.
export default function MergedNewView() {
  const course = routeParam(useParams().course)
  const { courses, loaded, loadFailed } = useCourseTreeContext()

  if (!course) return null
  if (!loaded) {
    return (
      <main className="main-view">
        <div className="spinner" />
      </main>
    )
  }
  const miss = routeMiss(courseNotFound(courses, course), loadFailed)
  if (miss) return <NotFoundPanel {...miss} />
  const node = courses.find((c) => c.name === course)
  return node ? <MergedNewBody course={course} node={node} /> : null
}
