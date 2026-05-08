import { useState, useEffect } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import { toast } from 'react-toastify'
import { fetchSummaryContent, saveSummaryContent, revertSummary, runStep, deleteFile, fileUrl } from '../api'
import type { LectureContext } from '../types'
import PdfViewer from './PdfViewer'

export default function EditSummaryView() {
  const { course, lecture } = useParams<{ course: string; lecture: string }>()
  const { files, refreshCourses } = useOutletContext<LectureContext>()
  const navigate = useNavigate()

  const [content, setContent] = useState('')
  const [hasOriginal, setHasOriginal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [pdfKey, setPdfKey] = useState(0)
  const [showPdf, setShowPdf] = useState(false)

  useEffect(() => {
    if (files) setShowPdf(files['summary.pdf'].exists)
  }, [files])

  useEffect(() => {
    if (course && lecture) loadContent()
  }, [course, lecture])

  async function loadContent() {
    setLoading(true)
    const data = await fetchSummaryContent(course!, lecture!)
    setContent(data.content)
    setHasOriginal(data.hasOriginal)
    setLoading(false)
  }

  async function handleRevert() {
    setError('')
    await revertSummary(course!, lecture!)
    await loadContent()
  }

  async function handleGeneratePdf() {
    setGenerating(true)
    setError('')
    const saved = await saveSummaryContent(course!, lecture!, content)
    if (!saved) {
      toast.error('Failed to save summary')
      setError('Failed to save summary')
      setGenerating(false)
      return
    }
    setHasOriginal(true)
    await deleteFile(course!, lecture!, 'summary.pdf')
    const result = await runStep(course!, lecture!, 'pdf')
    if (result.status === 'done') {
      refreshCourses()
      setShowPdf(true)
      setPdfKey((k) => k + 1)
    } else {
      toast.error('Failed to generate PDF')
      setError('Failed to generate PDF')
    }
    setGenerating(false)
  }

  if (!course || !lecture) return null

  const pdfUrl = `${fileUrl(course, lecture, 'summary.pdf')}?t=${pdfKey}`

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
