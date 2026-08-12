import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchSummaryContent,
  saveSummaryContent,
  revertSummary,
  deleteFile,
  fileUrl,
} from '@/services/database'
import { runStep } from '@/services/backend'
import { useLectureRoute } from '@/features/lectures/hooks/useLectureRoute'
import { useLatestRequest } from '@/shared/hooks/useLatestRequest'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toast, toastInitResult } from '@/services/toaster'
import { isConnectionError } from '@/services/http'
import { lectureNotFound } from '@/shared/utils/notFound'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import PdfViewer from '@/features/lectures/components/PdfViewer'
import PdfWarningBadge from '@/shared/components/PdfWarningBadge'
import { pdfBadge } from '@/features/lectures/utils/pdfBadge'
import { cacheBustedUrl } from '@/features/lectures/utils/pdfUrl'

export default function EditSummaryView() {
  const { course, lecture, kind, files } = useLectureRoute()
  const navigate = useNavigate()
  const { getError } = useRunnerStatus()
  const { courses, loaded: treeLoaded, refreshCourses } = useCourseTreeContext()
  const lectureError = getError(course, lecture, kind)

  const [content, setContent] = useState('')
  const [hasOriginal, setHasOriginal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [showPdf, setShowPdf] = useState(false)

  // True only while waiting for the pdf step this view started.
  const pdfFiredRef = useRef(false)
  const latest = useLatestRequest()

  // Runs on every SSE refresh; the ref gates both branches so a sibling file change or another
  // lecture's error can't disturb a generate in flight — the missing PDF mid-generate is our own
  // delete, not a real "no PDF" state.
  useEffect(() => {
    if (!files) return
    const pdfExists = files['summary.pdf'].exists
    if (!pdfFiredRef.current) {
      setShowPdf(pdfExists)
      return
    }
    if (lectureError) {
      pdfFiredRef.current = false
      setGenerating(false)
      setShowPdf(pdfExists)
      setError(lectureError)
      toast('error', lectureError)
    } else if (pdfExists) {
      pdfFiredRef.current = false
      setGenerating(false)
      setShowPdf(true)
    }
  }, [files, lectureError])

  useEffect(() => {
    if (course && lecture) loadContent()
  }, [course, lecture, kind])

  async function loadContent() {
    setLoading(true)
    const data = await latest(fetchSummaryContent(course, lecture, kind))
    if (!data) return
    setContent(data.content)
    setHasOriginal(data.hasOriginal)
    setLoading(false)
  }

  async function handleRevert() {
    setError('')
    await revertSummary(course, lecture, kind)
    await loadContent()
    // Revert rewrites summary.md with no SSE notify behind it, so the tree's mtimes — and the
    // stale-PDF badge that reads them — only update if we ask for them.
    refreshCourses()
  }

  async function handleGeneratePdf() {
    setGenerating(true)
    setError('')
    try {
      await saveSummaryContent(course, lecture, content, kind)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save summary'
      if (!isConnectionError(e)) toast('error', message) // connection errors are toasted centrally
      setError(message)
      setGenerating(false)
      return
    }
    setHasOriginal(true)
    await deleteFile(course, lecture, 'summary.pdf', kind)
    const initResult = await runStep(course, lecture, 'pdf', kind)
    if (initResult.status !== 'started') {
      toastInitResult(initResult, { busy: 'Step already running', error: 'Failed to generate PDF' })
      if (initResult.status === 'error') setError(initResult.message ?? 'Failed to generate PDF')
      setGenerating(false)
      return
    }
    pdfFiredRef.current = true
  }

  if (!course || !lecture) return null

  if (treeLoaded) {
    const missing = lectureNotFound(courses, course, lecture, kind)
    if (missing) return <NotFoundPanel message={missing} />
  }

  const pdfUrl = cacheBustedUrl(
    fileUrl(course, lecture, 'summary.pdf', kind),
    files?.['summary.pdf'].mtime ?? null,
  )

  return (
    <div className="edit-view">
      <div className="edit-toolbar">
        <button className="edit-back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h2 className="edit-title" dir="auto">
          {lecture}
        </h2>
        <PdfWarningBadge badge={files && pdfBadge(files)} />
        <div className="edit-toolbar-actions">
          <button
            className="edit-action-btn"
            onClick={handleRevert}
            disabled={!hasOriginal || generating || loading}
            title={hasOriginal ? 'Restore the original summary' : 'No original to revert to'}
          >
            Revert to Original
          </button>
          <button
            className="edit-action-btn edit-action-btn--primary"
            onClick={handleGeneratePdf}
            disabled={generating || loading}
          >
            {generating ? 'Generating…' : 'Generate PDF'}
          </button>
        </div>
      </div>

      {error && <p className="edit-error">{error}</p>}

      <div className="edit-panels">
        <div className="edit-panel edit-panel--pdf">
          <PdfViewer url={pdfUrl} show={showPdf} generating={generating} />
        </div>

        <div className="edit-panel edit-panel--text">
          {loading ? (
            <div className="edit-loading">
              <div className="spinner" />
            </div>
          ) : (
            <textarea
              className="summary-editor"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              dir="auto"
            />
          )}
        </div>
      </div>
    </div>
  )
}
