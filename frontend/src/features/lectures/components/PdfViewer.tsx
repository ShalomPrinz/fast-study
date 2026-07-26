import { useState, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface Props {
  url: string
  show: boolean
}

export default function PdfViewer({ url, show }: Props) {
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const capturedScrollRef = useRef({ top: 0, left: 0 })
  const prevUrlRef = useRef(url)

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

  if (!show) {
    return (
      <div className="pdf-placeholder">
        <p>No PDF yet — click "Generate PDF" to create one.</p>
      </div>
    )
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-zoom-bar">
        <button className="pdf-zoom-btn" onClick={() => setScale((s) => Math.max(s - 0.2, 0.4))}>
          −
        </button>
        <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
        <button className="pdf-zoom-btn" onClick={() => setScale((s) => Math.min(s + 0.2, 4))}>
          +
        </button>
      </div>
      <div className="pdf-scroll-container" ref={scrollContainerRef}>
        <Document
          file={url}
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
    </div>
  )
}
