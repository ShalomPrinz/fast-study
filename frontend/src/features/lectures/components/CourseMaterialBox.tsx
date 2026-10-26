import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { AssignmentLecture, Course } from '@/types'
import { setAssignmentLectures } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { summarizedLectures } from '@/features/lectures/utils/assignmentDocs'
import Icon from '@/shared/components/Icon'
import '@/styles/button.css'
import '@/styles/chip.css'
import './CourseMaterialBox.css'

interface Props {
  course: Course
  assignment: string
  chosen: AssignmentLecture[]
  // A doc is being generated: the selection is read by that run, so it waits.
  locked: boolean
}

const same = (a: AssignmentLecture, b: AssignmentLecture) => a.name === b.name && a.kind === b.kind

// The lectures and recitations whose summaries go with the assignment: chips of the chosen ones and a
// checklist popover of every summarized entry. Writes go to the database; the tree refresh shows them.
export default function CourseMaterialBox({ course, assignment, chosen, locked }: Props) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const options = summarizedLectures(course)

  // Pointerdown, not click: a click on another control would otherwise fire before the popover closes.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // PUTs replace the whole list, so each toggle builds on the last list sent (`sent`) until the tree shows
  // it, and the PUTs run in order on one chain: rapid toggles never drop an entry.
  const sent = useRef<AssignmentLecture[] | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const s = sent.current
    if (s && s.length === chosen.length && s.every((e) => chosen.some((c) => same(c, e)))) {
      sent.current = null
    }
  }, [chosen])

  function save(next: AssignmentLecture[]) {
    queue.current = queue.current.then(async () => {
      try {
        await setAssignmentLectures(course.name, assignment, next)
      } catch (e) {
        sent.current = null
        toastFailure(e)
      }
    })
  }

  function toggle(entry: AssignmentLecture) {
    const base = sent.current ?? chosen
    const on = base.some((c) => same(c, entry))
    const next = on ? base.filter((c) => !same(c, entry)) : [...base, entry]
    sent.current = next
    save(next)
  }

  const kindLabel = (kind: AssignmentLecture['kind']) =>
    kind === 'recitation' ? t`Recitation` : t`Lecture`

  return (
    <div className="course-material">
      <div className="course-material-text">
        <div className="course-material-head">
          <h3 className="course-material-title">
            <Trans>Course material</Trans>
          </h3>
          <div className="course-material-picker" ref={ref}>
            <button
              className="btn"
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={locked}
              onClick={() => setOpen((v) => !v)}
            >
              <Trans>Add a lecture or recitation</Trans>
              <Icon icon="chevron-down" />
            </button>
            {open && (
              <div
                className="course-material-popover"
                role="dialog"
                aria-label={t`Add a lecture or recitation`}
              >
                {options.length === 0 ? (
                  <p className="course-material-empty">
                    <Trans>No lecture in this course has a summary yet.</Trans>
                  </p>
                ) : (
                  options.map((o) => (
                    <label key={`${o.kind}:${o.name}`} className="course-material-option">
                      <input
                        type="checkbox"
                        checked={chosen.some((c) => same(c, o))}
                        disabled={locked}
                        onChange={() => toggle(o)}
                      />
                      <span className="course-material-option-name" dir="auto">
                        {o.name}
                      </span>
                      <span className="course-material-option-kind">{kindLabel(o.kind)}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <p className="course-material-sub">
          <Trans>Lecture and recitation summaries to include with this assignment</Trans>
        </p>
      </div>
      {chosen.length === 0 ? (
        <p className="course-material-none">
          <Trans>None chosen — only the assignment files will be used.</Trans>
        </p>
      ) : (
        <ul className="course-material-chips">
          {chosen.map((c) => {
            const name = c.name
            return (
              <li key={`${c.kind}:${c.name}`} className="chip chip--accent course-material-chip">
                <span dir="auto">{c.name}</span>
                <button
                  className="course-material-remove"
                  aria-label={t`Remove ${name}`}
                  disabled={locked}
                  onClick={() => toggle(c)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
