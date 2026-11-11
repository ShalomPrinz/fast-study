import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { isRtl } from '@/services/i18n'
import { useTour } from '@/shared/contexts/TourContext'
import { rememberFocus, tabTarget } from './tourFocus'
import { arrowDelta, moveSlide } from './tourMachine'
import { TOUR_SLIDES } from './tourSteps'
import '@/styles/button.css'
import './Tour.css'

// The captured screenshots by language and slide id (assets/tour/{he,en}/<id>.jpg); a missing one just hides the image.
const SHOTS = import.meta.glob<string>('../../assets/tour/*/*.jpg', {
  eager: true,
  import: 'default',
})

const total = TOUR_SLIDES.length

// One run of the tour, mounted when it starts and gone when it ends, so every run opens at slide one.
function TourRun() {
  const { stop } = useTour()
  const { t, i18n } = useLingui()
  const rtl = isRtl(i18n.locale)
  const [index, setIndex] = useState(0)
  const dialog = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const last = index === total - 1
  const go = (delta: number) => setIndex((i) => moveSlide(i, delta, total))
  const advance = () => (last ? stop() : go(1))

  useEffect(() => next.current?.focus(), [index])

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

  // The track lays slides out along the reading direction, so RTL slides it the other way.
  const shift = `translateX(${(rtl ? 1 : -1) * index * 100}%)`
  return createPortal(
    <div className="tour-overlay">
      <div
        ref={dialog}
        className="tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-title-${TOUR_SLIDES[index].id}`}
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
            {TOUR_SLIDES.map((slide, i) => {
              const shot = SHOTS[`../../assets/tour/${i18n.locale}/${slide.id}.jpg`]
              const off = i === index ? {} : { inert: '', 'aria-hidden': true }
              return (
                <section key={slide.id} className="tour-slide" {...off}>
                  <div className="tour-frame">
                    {shot && <img className="tour-shot" src={shot} alt={t(slide.alt)} />}
                  </div>
                  <h2 className="tour-title" id={`tour-title-${slide.id}`}>
                    {t(slide.title)}
                  </h2>
                  <p className="tour-body">{t(slide.body)}</p>
                </section>
              )
            })}
          </div>
        </div>
        <div className="tour-footer">
          <div className="tour-side">
            {!last && (
              <button className="btn btn--ghost tour-skip" onClick={stop}>
                <Trans>Skip</Trans>
              </button>
            )}
          </div>
          <div className="tour-dots">
            {TOUR_SLIDES.map((slide, i) => {
              const position = i + 1
              return (
                <button
                  key={slide.id}
                  className={`tour-dot${i === index ? ' active' : ''}`}
                  aria-label={t`Slide ${position} of ${total}`}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                />
              )
            })}
          </div>
          <div className="tour-side tour-side--end">
            <button
              className="btn btn--ghost tour-back"
              disabled={index === 0}
              onClick={() => go(-1)}
            >
              <Trans>Back</Trans>
            </button>
            <button ref={next} className="btn btn--primary tour-next" onClick={advance}>
              {last ? <Trans>Done</Trans> : <Trans>Next</Trans>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// The first-launch tour carousel — see docs/TOUR.md.
export default function Tour() {
  const { active } = useTour()
  return active ? <TourRun /> : null
}
