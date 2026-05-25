import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { fetchSummaryContent, saveSummaryContent, revertSummary, deleteFile, fileUrl } from '../services/database'
import { runStep } from '../services/backend'
import { useLectureRoute } from '../hooks/useLectureRoute'
import { useRunnerStatus } from '../contexts/RunnerStatusContext'
import PdfViewer from './PdfViewer'

export default function EditSummaryView() {
  const { course, lecture, kind, files } = useLectureRoute()
  const navigate = useNavigate()
  const { getError } = useRunnerStatus()
  const lectureError = getError(course, lecture, kind)

  // Internal state management
  const [content, setContent] = useState('')
  const [hasOriginal, setHasOriginal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [pdfKey, setPdfKey] = useState(0)
  const [showPdf, setShowPdf] = useState(false)

  // Gates the completion-detection logic: true only while we're waiting for our own pdf step.
  const pdfFiredRef = useRef(false)

  useEffect(() => {
    if (!files) return
    const pdfExists = files['summary.pdf'].exists
    setShowPdf(pdfExists)
    if (!pdfFiredRef.current) return
    if (lectureError) {
      pdfFiredRef.current = false
      setGenerating(false)
      setError(lectureError)
      toast.error(lectureError)
    } else if (pdfExists) {
      pdfFiredRef.current = false
      setGenerating(false)
      setPdfKey((k) => k + 1)
    }
  }, [files, lectureError])

  useEffect(() => {
    if (course && lecture) loadContent()
  }, [course, lecture, kind])

  async function loadContent() {
    setLoading(true)
    const data = await fetchSummaryContent(course, lecture, kind)
    setContent(data.content)
    setHasOriginal(data.hasOriginal)
    setLoading(false)
  }

  async function handleRevert() {
    setError('')
    await revertSummary(course, lecture, kind)
    await loadContent()
  }

  async function handleGeneratePdf() {
    setGenerating(true)
    setError('')
    try {
      await saveSummaryContent(course, lecture, content, kind)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save summary'
      toast.error(message)
      setError(message)
      setGenerating(false)
      return
    }
    setHasOriginal(true)
    await deleteFile(course, lecture, 'summary.pdf', kind)
    const result = await runStep(course, lecture, 'pdf', kind)
    if (result.status === 'busy') {
      toast.error('Step already running')
      setGenerating(false)
      return
    }
    if (result.status === 'error') {
      const message = result.message ?? 'Failed to generate PDF'
      toast.error(message)
      setError(message)
      setGenerating(false)
      return
    }
    // status === 'started': wait for SSE-driven files update to confirm completion
    pdfFiredRef.current = true
  }

  if (!course || !lecture) return null

  const baseUrl = fileUrl(course, lecture, 'summary.pdf', kind)
  const pdfUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${pdfKey}`

  return (
    <div className="edit-view">
      <div className="edit-toolbar">
        <button className="edit-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <h2 className="edit-title" dir="auto">{lecture}</h2>
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
          <PdfViewer url={pdfUrl} show={showPdf} />
        </div>

        <div className="edit-panel edit-panel--text">
          {loading ? (
            <div className="edit-loading"><div className="spinner" /></div>
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
