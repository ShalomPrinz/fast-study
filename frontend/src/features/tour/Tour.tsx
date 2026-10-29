import { useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { useLocation, useNavigate } from 'react-router-dom'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { isRtl } from '@/services/i18n'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useDriveEnabled } from '@/shared/contexts/SettingsContext'
import { useTour } from '@/shared/contexts/TourContext'
import { physicalPlacement } from '@/shared/utils/tooltip'
import { dismissTour } from './tourFlag'
import { foundAfterLookup, tourMode, tourReducer, type Found, type TourAction } from './tourMachine'
import { rememberFocus, tabTarget } from './tourFocus'
import { TOUR_STEPS, tourRoutePath, type TourStep } from './tourSteps'
import '@/styles/button.css'
import '@/styles/modal.css'
import './Tour.css'

// How long a step waits for its anchor after the route opens before it falls back to the card.
const SETTLE_MS = 2500
const SPOT_PAD = 6

// The captured screenshots by language and step id (assets/tour/{he,en}/<id>.jpg); a missing one just hides the image.
const SHOTS = import.meta.glob<string>('../../assets/tour/*/*.jpg', {
  eager: true,
  import: 'default',
})

// Watches for the step's `data-tour` anchor for the step's whole life: it settles to "absent" after
// SETTLE_MS, and a later loss or return of the element flips between the card and the spotlight.
function useAnchor(anchor: string): Found<HTMLElement> {
  const [found, setFound] = useState<Found<HTMLElement>>({ el: null, settled: false })
  useEffect(() => {
    setFound({ el: null, settled: false })
    const look = () => document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
    const update = () => setFound((prev) => foundAfterLookup(prev, look()))
    update()
    const timer = setTimeout(() => setFound((prev) => ({ ...prev, settled: true })), SETTLE_MS)
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [anchor])
  return found
}

interface PanelProps {
  step: TourStep
  index: number
  dontShow: boolean
  onDontShow: (v: boolean) => void
  dispatch: (a: TourAction) => void
  shot?: string
}

// The popover's content, shared by the spotlight and the card.
function Panel({ step, index, dontShow, onDontShow, dispatch, shot }: PanelProps) {
  const { t } = useLingui()
  const next = useRef<HTMLButtonElement>(null)
  useEffect(() => next.current?.focus(), [index])
  const last = index === TOUR_STEPS.length - 1
  const position = index + 1
  const total = TOUR_STEPS.length
  return (
    <>
      {shot && <img className="tour-shot" src={shot} alt="" />}
      <h2 className="tour-title" id="tour-title">
        {t(step.title)}
      </h2>
      <p className="tour-body">{t(step.body)}</p>
      <label className="tour-dismiss">
        <input type="checkbox" checked={dontShow} onChange={(e) => onDontShow(e.target.checked)} />
        <Trans>Don't show again</Trans>
      </label>
      <div className="tour-actions">
        <span className="tour-count">{t`${position} of ${total}`}</span>
        <button className="btn btn--ghost tour-skip" onClick={() => dispatch({ type: 'skip' })}>
          <Trans>Skip</Trans>
        </button>
        <button
          className="btn btn--ghost tour-back"
          disabled={index === 0}
          onClick={() => dispatch({ type: 'back' })}
        >
          <Trans>Back</Trans>
        </button>
        <button
          ref={next}
          className="btn btn--primary tour-next"
          onClick={() => dispatch({ type: 'next' })}
        >
          {last ? <Trans>Done</Trans> : <Trans>Next</Trans>}
        </button>
      </div>
    </>
  )
}

// The popover beside the spotlit element, flipped for RTL and kept inside the window.
function Spotlight(props: PanelProps & { el: HTMLElement }) {
  const { i18n } = useLingui()
  const { el, ...panel } = props
  const [rect, setRect] = useState<DOMRect>(() => el.getBoundingClientRect())
  const { refs, floatingStyles } = useFloating({
    elements: { reference: el },
    strategy: 'fixed',
    placement: physicalPlacement(panel.step.placement, isRtl(i18n.locale)),
    whileElementsMounted: autoUpdate,
    middleware: [offset(SPOT_PAD + 12), flip({ padding: 12 }), shift({ padding: 12 })],
  })
  useEffect(() => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    return autoUpdate(el, el, () => setRect(el.getBoundingClientRect()))
  }, [el])
  return (
    <div className="tour-blocker">
      <div
        className="tour-spot"
        style={{
          top: rect.top - SPOT_PAD,
          left: rect.left - SPOT_PAD,
          width: rect.width + 2 * SPOT_PAD,
          height: rect.height + 2 * SPOT_PAD,
        }}
      />
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="tour-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        <Panel {...panel} />
      </div>
    </div>
  )
}

function Card(props: PanelProps) {
  return (
    <div className="modal-overlay tour-blocker">
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <Panel {...props} />
      </div>
    </div>
  )
}

// One run of the tour, mounted when it starts and gone when it ends, so every run opens at step one.
function TourRun() {
  const { stop } = useTour()
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const location = useLocation()
  const { courses } = useCourseTreeContext()
  const driveEnabled = useDriveEnabled()
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof tourReducer>, a: TourAction) => tourReducer(s, a, TOUR_STEPS.length),
    { active: true, index: 0 },
  )
  const [dontShow, setDontShow] = useState(false)
  const step = TOUR_STEPS[state.index]
  const found = useAnchor(step.anchor)

  // Opens the step's screen; a step with no screen of its own (no such lecture) stays where it is.
  useEffect(() => {
    const to = tourRoutePath(step.route, courses, driveEnabled)
    if (to && to !== location.pathname + location.search) navigate(to)
  }, [step.id])

  useEffect(() => {
    if (state.active) return
    if (dontShow) dismissTour()
    stop()
  }, [state.active])

  // Focus returns to where it was when the tour ends; Tab stays inside the dialog and Esc closes it.
  useEffect(() => {
    const restore = rememberFocus(document as { activeElement: HTMLElement | null })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return dispatch({ type: 'skip' })
      if (e.key !== 'Tab') return
      const dialog = document.querySelector<HTMLElement>('.tour-popover, .tour-card')
      const items = [
        ...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []),
      ]
      const to = tabTarget(items, document.activeElement as HTMLElement | null, e.shiftKey)
      if (!to) return
      e.preventDefault()
      to.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      restore()
    }
  }, [])

  const mode = tourMode(!!found.el, found.settled)
  const panel: PanelProps = {
    step,
    index: state.index,
    dontShow,
    onDontShow: setDontShow,
    dispatch,
  }
  let body
  if (mode === 'spotlight' && found.el) body = <Spotlight {...panel} el={found.el} />
  else if (mode === 'card') {
    const shot = SHOTS[`../../assets/tour/${i18n.locale}/${step.id}.jpg`]
    body = <Card {...panel} shot={shot} />
  } else body = <div className="modal-overlay tour-blocker" />
  return createPortal(body, document.body)
}

// The first-run guided tour — see docs/TOUR.md.
export default function Tour() {
  const { active } = useTour()
  return active ? <TourRun /> : null
}
