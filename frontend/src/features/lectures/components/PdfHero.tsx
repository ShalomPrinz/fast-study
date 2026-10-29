import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Document, Page, pdfjs } from 'react-pdf'
import Icon from '@/shared/components/Icon'
import { secretHeaders } from '@/services/runtime'
import { canOpenWith, openLectureFile, openLectureFileWith } from '@/services/open'
import { fileUrl } from '@/services/database'
import { cacheBustedUrl } from '@/features/lectures/utils/pdfUrl'
import { snapTransform, snapWidth } from '@/features/lectures/utils/pdfSnap'
import type { Kind } from '@/types'
import '@/styles/button.css'
import './PdfHero.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Below this the page scrolls instead of cropping further.
const MIN_VISIBLE = 160

interface Props {
  course: string
  lecture: string
  kind?: Kind
  pdfMtime: number | null
}

// A finished lecture's lead: page 1 of the summary PDF as a still, and the ways to open the whole.
export default function PdfHero({ course, lecture, kind, pdfMtime }: Props) {
  const { t } = useLingui()
  const url = cacheBustedUrl(fileUrl(course, lecture, 'summary.pdf', kind), pdfMtime)
  // A failed load belongs to one url; a new lecture or regenerated PDF gets a fresh try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = failedUrl === url
  // react-pdf compares `file` by identity, so a fresh literal would re-fetch on every render.
  const file = useMemo(() => ({ url, httpHeaders: secretHeaders() }), [url])
  const open = () => openLectureFile(course, lecture, 'summary.pdf', kind)
  // The page renders at the column's measured width so it stays crisp; height follows the aspect ratio.
  const thumbRef = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = thumbRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el)
      const border = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
      setWidth(el.getBoundingClientRect().width - border)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Re-render the page when the display scale changes with no width change (monitor move, zoom).
  // The resolution query catches a monitor move; zoom also resizes the window.
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const sync = () => setDpr(window.devicePixelRatio || 1)
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [dpr])
  const snapped = width > 0 ? snapWidth(width, dpr) : null

  // Lay the canvas out at its buffer size, absolute in the Page box, and show it 1:1 on the device grid.
  const snapCanvas = () => {
    const canvas = thumbRef.current?.querySelector('canvas')
    const page = canvas?.parentElement
    if (!canvas || !page) return
    const d = window.devicePixelRatio || 1
    page.style.width = `${canvas.width / d}px`
    page.style.height = `${canvas.height / d}px`
    const r = page.getBoundingClientRect()
    const scroller = thumbRef.current?.closest<HTMLElement>('.page-body')
    const sc = scroller?.getBoundingClientRect()
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${canvas.width}px`,
      height: `${canvas.height}px`,
      transformOrigin: '0 0',
      transform: snapTransform(
        r.left + (scroller?.scrollLeft ?? 0),
        r.top + (scroller?.scrollTop ?? 0),
        d,
        sc && scroller ? sc.left + scroller.clientLeft : 0,
        sc && scroller ? sc.top + scroller.clientTop : 0,
      ),
    })
  }

  // Cap = room below the thumbnail's top, less what renders under it (left-track rest, Materials) and one gap.
  // The side-by-side AI card is left out of "under it", so it never shrinks the cap; if it alone overflows, the page scrolls.
  const [cap, setCap] = useState<number | null>(null)
  const [cropped, setCropped] = useState(false)
  const measureRef = useRef<() => void>(() => {})
  useEffect(() => {
    const thumb = thumbRef.current
    const scroller = thumb?.closest<HTMLElement>('.page-body')
    const column = thumb?.closest<HTMLElement>('.page-column')
    const split = thumb?.closest<HTMLElement>('.lecture-split')
    if (!thumb || !scroller || !column || !split) return
    const measure = () => {
      const cs = getComputedStyle(scroller)
      const t = thumb.getBoundingClientRect()
      const sc = scroller.getBoundingClientRect()
      const topInContent = t.top - sc.top - scroller.clientTop + scroller.scrollTop
      let leftBottom = t.bottom
      for (const child of Array.from(split.children)) {
        const r = child.getBoundingClientRect()
        if (child.classList.contains('ai-split-card') && r.top < t.top) continue
        const mb = parseFloat(getComputedStyle(child).marginBottom) || 0
        leftBottom = Math.max(leftBottom, r.bottom + mb)
      }
      const trailing =
        leftBottom -
        t.bottom +
        (column.getBoundingClientRect().bottom - split.getBoundingClientRect().bottom)
      const margin = parseFloat(cs.getPropertyValue('--space-4')) || 16
      const next = Math.max(
        MIN_VISIBLE,
        Math.floor(
          scroller.clientHeight - parseFloat(cs.paddingBottom) - topInContent - trailing - margin,
        ),
      )
      setCap((prev) => (prev === next ? prev : next))
      setCropped(thumb.scrollHeight > next + 1)
      snapCanvas() // layout moved, so the grid correction is stale
    }
    measureRef.current = measure
    const ro = new ResizeObserver(measure)
    ro.observe(scroller)
    ro.observe(column)
    measure()
    return () => ro.disconnect()
  }, [width, failed])

  return (
    <section className="pdf-hero" data-testid="pdf-hero">
      <div className="pdf-hero-actions">
        <button className="btn btn--primary pdf-hero-open" onClick={open}>
          <Trans>Open in full screen</Trans>
          <Icon icon="external-link" />
        </button>
        {canOpenWith() && (
          <button
            className="btn btn--ghost"
            onClick={() => openLectureFileWith(course, lecture, 'summary.pdf', kind)}
          >
            <Trans>Choose app</Trans>
          </button>
        )}
      </div>
      <button
        ref={thumbRef}
        className="pdf-thumbnail"
        data-cropped={cropped || undefined}
        style={cap ? { maxHeight: cap } : undefined}
        data-testid="pdf-thumbnail"
        onClick={open}
        aria-label={t`Open PDF`}
      >
        {failed ? (
          <Icon icon="document" />
        ) : snapped ? (
          <Document file={file} loading="" error="" onLoadError={() => setFailedUrl(url)}>
            <Page
              pageNumber={1}
              width={snapped.pageWidth}
              devicePixelRatio={dpr}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              loading=""
              onRenderSuccess={() => measureRef.current()}
            />
          </Document>
        ) : null}
      </button>
    </section>
  )
}
