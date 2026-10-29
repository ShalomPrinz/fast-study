import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Document, Page, pdfjs } from 'react-pdf'
import Icon from '@/shared/components/Icon'
import { secretHeaders } from '@/services/runtime'
import { canOpenWith, openLectureFile, openLectureFileWith } from '@/services/open'
import { fileUrl } from '@/services/database'
import { cacheBustedUrl } from '@/features/lectures/utils/pdfUrl'
import type { Kind } from '@/types'
import '@/styles/button.css'
import './PdfHero.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

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
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <section className="pdf-hero" data-testid="pdf-hero">
      <div className="pdf-hero-actions">
        <button className="btn btn--primary pdf-hero-open" onClick={open}>
          <Trans>Open in your own viewer</Trans>
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
        data-testid="pdf-thumbnail"
        onClick={open}
        aria-label={t`Open PDF`}
      >
        {failed ? (
          <Icon icon="document" />
        ) : width > 0 ? (
          <Document file={file} loading="" error="" onLoadError={() => setFailedUrl(url)}>
            <Page
              pageNumber={1}
              width={width}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              loading=""
            />
          </Document>
        ) : null}
      </button>
    </section>
  )
}
