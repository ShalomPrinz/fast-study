import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Trans } from '@lingui/react/macro'
import { placeCallout, type Rect, type Size } from './tourPlacement'

interface Props {
  titleId: string
  title: string
  body: string
  rtl: boolean
  // The step's element in the frame (fractions); absent, the box just docks.
  rect: Rect | undefined
  alignTop?: boolean
  frame: RefObject<HTMLElement>
  nav: { last: boolean; canBack: boolean; onBack: () => void; onNext: () => void }
  nextRef: RefObject<HTMLButtonElement>
}

// The step's floating box: beside its element inside the screenshot frame with an arrow at it, or docked
// under the frame when no side has room. Stays mounted across the steps of one screenshot so it glides.
export default function TourCallout({
  titleId,
  title,
  body,
  rtl,
  rect,
  alignTop,
  frame,
  nav,
  nextRef,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [frameSize, setFrameSize] = useState<Size | null>(null)
  const [boxSize, setBoxSize] = useState<Size | null>(null)

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const read = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frame])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setBoxSize((prev) =>
      prev && prev.w === el.offsetWidth && prev.h === el.offsetHeight
        ? prev
        : { w: el.offsetWidth, h: el.offsetHeight },
    )
  }, [titleId, title, body, frameSize])

  const placed =
    rect && frameSize && boxSize
      ? placeCallout(rect, boxSize, frameSize, undefined, undefined, undefined, alignTop)
      : null
  const style = placed
    ? ({
        left: placed.x,
        top: placed.y,
        '--tour-arrow': `${placed.arrow}px`,
      } as React.CSSProperties)
    : undefined
  return (
    <div
      ref={box}
      className={`tour-callout${boxSize && !placed ? ' tour-callout--docked' : ''}`}
      data-side={placed?.side}
      dir={rtl ? 'rtl' : 'ltr'}
      style={boxSize ? style : { opacity: 0 }}
    >
      <h2 className="tour-callout-title" id={titleId}>
        {title}
      </h2>
      <p className="tour-callout-body">{body}</p>
      <div className="tour-callout-actions">
        {nav.canBack && (
          <button className="btn btn--ghost tour-back" onClick={nav.onBack}>
            <Trans>Back</Trans>
          </button>
        )}
        <button ref={nextRef} className="btn btn--primary tour-next" onClick={nav.onNext}>
          {nav.last ? <Trans>Done</Trans> : <Trans>Next</Trans>}
        </button>
      </div>
    </div>
  )
}
