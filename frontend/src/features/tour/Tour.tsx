import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { isRtl } from '@/services/i18n'
import { useTour } from '@/shared/contexts/TourContext'
import { rememberFocus, tabTarget } from './tourFocus'
import { arrowDelta, moveSlide } from './tourMachine'
import RECTS from '@/assets/tour/rects.json'
import TourCallout from './TourCallout'
import { TOUR_SHOTS, TOUR_STEPS, stepOnShot } from './tourSteps'
import type { Rect } from './tourPlacement'
import '@/styles/button.css'
import './Tour.css'

// The captured screenshots by language and slide id (assets/tour/{he,en}/<shot>.jpg); a missing one just hides the image.
const SHOTS = import.meta.glob<string>('../../assets/tour/*/*.jpg', {
  eager: true,
  import: 'default',
})

const total = TOUR_STEPS.length

// Each step's element in its screenshot, per language (written by scripts/capture-tour.mjs).
const rectOf = (lang: string, id: string): Rect | undefined =>
  (RECTS as Record<string, Record<string, Rect>>)[lang]?.[id]

// One run of the tour, mounted when it starts and gone when it ends, so every run opens at slide one.
function TourRun() {
  const { stop } = useTour()
  const { t, i18n } = useLingui()
  const rtl = isRtl(i18n.locale)
  const [index, setIndex] = useState(0)
  const dialog = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const last = index === total - 1
  const go = (delta: number) => setIndex((i) => moveSlide(i, delta, total))
  const advance = () => (last ? stop() : go(1))

  // Focus returns to where it was when the tour ends; Tab stays inside the dialog, Esc closes, arrows move.
  const keys = useRef({ go, stop, rtl })
  keys.current = { go, stop, rtl }
  useEffect(() => {
    const restore = rememberFocus(document as { activeElement: HTMLElement | null })
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if (e.key === 'Escape') return k.stop()
      const delta = arrowDelta(e.key, k.rtl)
      if (delta) return k.go(delta)
      if (e.key !== 'Tab') return
      const items = [
        ...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
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

  // After the remember effect above: it must read the prior element before Next takes focus.
  useEffect(() => next.current?.focus({ preventScroll: true }), [index])

  // The track lays slides out along the reading direction, so RTL slides it the other way.
  const shotIndex = TOUR_SHOTS.findIndex((s) => s.id === TOUR_STEPS[index].shot)
  const shift = `translateX(${(rtl ? 1 : -1) * shotIndex * 100}%)`
  return createPortal(
    <div className="tour-overlay">
      <div
        ref={dialog}
        className="tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-title-${TOUR_STEPS[index].id}`}
      >
        <button className="tour-close" aria-label={t`Close`} onClick={stop}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="tour-viewport">
          <div className="tour-track" style={{ transform: shift }}>
            {TOUR_SHOTS.map((shot) => {
              const src = SHOTS[`../../assets/tour/${i18n.locale}/${shot.id}.jpg`]
              const shown = stepOnShot(TOUR_STEPS, shot.id, index)
              const live = TOUR_STEPS[index].shot === shot.id
              const rect = rectOf(i18n.locale, TOUR_STEPS[shown].id)
              const step = TOUR_STEPS[index]
              const off = live ? {} : { inert: '', 'aria-hidden': true }
              return (
                <section key={shot.id} className={`tour-slide${live ? ' active' : ''}`} {...off}>
                  <div className="tour-stage">
                    <div className="tour-frame" ref={live ? frame : undefined}>
                      {src && <img className="tour-shot" src={src} alt={t(shot.alt)} />}
                      {rect && (
                        <div
                          className="tour-highlight"
                          aria-hidden="true"
                          style={{
                            left: `calc(${rect.x * 100}% - 5px)`,
                            top: `calc(${rect.y * 100}% - 5px)`,
                            width: `calc(${rect.w * 100}% + 10px)`,
                            height: `calc(${rect.h * 100}% + 10px)`,
                          }}
                        />
                      )}
                    </div>
                    {live && (
                      <TourCallout
                        titleId={`tour-title-${step.id}`}
                        title={t(step.title)}
                        body={t(step.body)}
                        rtl={rtl}
                        rect={rectOf(i18n.locale, step.id)}
                        alignTop={step.alignTop}
                        frame={frame}
                        nav={{ last, canBack: index > 0, onBack: () => go(-1), onNext: advance }}
                        nextRef={next}
                      />
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
        <div className="tour-footer">
          <div className="tour-side">
            {last ? (
              // Skip is gone on the last step; an invisible twin keeps the footer, and so the dialog, the same height.
              <span className="btn btn--ghost tour-skip-spacer" aria-hidden="true">
                <Trans>Skip</Trans>
              </span>
            ) : (
              <button className="btn btn--ghost tour-skip" onClick={stop}>
                <Trans>Skip</Trans>
              </button>
            )}
          </div>
          <div className="tour-dots">
            {TOUR_STEPS.map((step, i) => {
              const position = i + 1
              return (
                <button
                  key={step.id}
                  className={`tour-dot${i === index ? ' active' : ''}`}
                  aria-label={t`Slide ${position} of ${total}`}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                />
              )
            })}
          </div>
          <div className="tour-side tour-side--end" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// The first-launch guided tour — see docs/TOUR.md.
export default function Tour() {
  const { active } = useTour()
  return active ? <TourRun /> : null
}
