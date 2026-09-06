import { useState, useRef, useMemo } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Document, Page, pdfjs } from 'react-pdf'
import Icon from '@/shared/components/Icon'
import { secretHeaders } from '@/services/runtime'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import '@/styles/spinner.css'
import '@/styles/pane-header.css'
import './PdfViewer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface Props {
  url: string
  show: boolean
  generating: boolean
}

export default function PdfViewer({ url, show, generating }: Props) {
  const { t } = useLingui()
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.2)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const capturedScrollRef = useRef({ top: 0, left: 0 })
  const prevUrlRef = useRef(url)

  // pdf.js fetches the document over XHR, so the secret rides its own headers. Memoized because
  // react-pdf compares `file` by identity — a fresh literal would re-fetch the PDF every render.
  const file = useMemo(() => ({ url, httpHeaders: secretHeaders() }), [url])

  // Capture in the render phase, before React commits the new url: the old pages are still
  // mounted here, so scrollTop is the real user position.
  if (prevUrlRef.current !== url) {
    const container = scrollContainerRef.current
    if (container) {
      capturedScrollRef.current = { top: container.scrollTop, left: container.scrollLeft }
    }
    prevUrlRef.current = url
  }

  // Fires per page once its canvas is laid out at real size; idempotent across pages.
  // Restore the captured scroll, or snap to the right edge (RTL) on first load.
  const handlePageRendered = () => {
    const container = scrollContainerRef.current
    if (!container) return
    const { top, left } = capturedScrollRef.current
    if (top || left) {
      container.scrollTop = top
      container.scrollLeft = left
    } else {
      container.scrollLeft = container.scrollWidth
    }
  }

  // The indicator names the page under the middle of the viewport. react-pdf owns the page class,
  // so the rendered pages are read off the DOM rather than tracked in state.
  const handleScroll = () => {
    const container = scrollContainerRef.current
    if (!container) return
    const middle = container.getBoundingClientRect().top + container.clientHeight / 2
    const pages = Array.from(container.querySelectorAll<HTMLElement>('.react-pdf__Page'))
    const idx = pages.findIndex((p) => p.getBoundingClientRect().bottom > middle)
    setPage(idx === -1 ? Math.max(pages.length, 1) : idx + 1)
  }

  return (
    <div className="pdf-viewer">
      <div className="pane-header">
        <span className="pane-label">
          <Trans>Current PDF</Trans>
        </span>
        {show && !generating && (
          <div className="pdf-tools">
            <button
              className="pdf-zoom-btn"
              title={t`Zoom out`}
              onClick={() => setScale((s) => Math.max(s - 0.2, 0.4))}
            >
              −
            </button>
            <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
            <button
              className="pdf-zoom-btn"
              title={t`Zoom in`}
              onClick={() => setScale((s) => Math.min(s + 0.2, 4))}
            >
              +
            </button>
            {numPages > 0 && (
              <span className="pdf-page-indicator">
                {page} / {numPages}
              </span>
            )}
            <button
              className="pdf-zoom-btn"
              title={t`Open PDF in new tab`}
              onClick={() => window.open(url, '_blank')}
            >
              <Icon icon="external-link" />
            </button>
          </div>
        )}
      </div>

      {/* Wins over the placeholder so a first-ever generate spins too, instead of flashing "no PDF yet". */}
      {generating ? (
        <div className="pdf-doc-loading">
          <div className="spinner" />
        </div>
      ) : !show ? (
        <div className="pdf-placeholder">
          <p>
            <Trans>No PDF yet — use "Save & update PDF" to create one.</Trans>
          </p>
        </div>
      ) : (
        <div className="pdf-scroll-container" ref={scrollContainerRef} onScroll={handleScroll}>
          <Document
            file={file}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={
              <div className="pdf-doc-loading">
                <div className="spinner" />
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <Page
                key={i}
                pageNumber={i + 1}
                scale={scale}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                onRenderSuccess={handlePageRendered}
              />
            ))}
          </Document>
        </div>
      )}
    </div>
  )
}
