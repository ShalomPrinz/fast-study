import { useState, useEffect, useRef } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
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
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import PdfViewer from '@/features/lectures/components/PdfViewer'
import MarkdownEditor from '@/features/lectures/components/MarkdownEditor'
import { pdfBadge } from '@/features/lectures/utils/pdfBadge'
import { cacheBustedUrl } from '@/features/lectures/utils/pdfUrl'
import '@/styles/spinner.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/pane-header.css'
import './EditSummaryView.css'

export default function EditSummaryView() {
  const { t } = useLingui()
  const { course, lecture, kind, files } = useLectureRoute()
  const navigate = useNavigate()
  const { getError } = useRunnerStatus()
  const { courses, loaded: treeLoaded, refreshCourses } = useCourseTreeContext()
  const lectureError = getError(course, lecture, kind)

  const [content, setContent] = useState('')
  // What is on disk, so the toolbar and the editor pane can tell an edited buffer from a clean one.
  const [savedContent, setSavedContent] = useState('')
  const [hasOriginal, setHasOriginal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [showPdf, setShowPdf] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

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
    setSavedContent(data.content)
    setHasOriginal(data.hasOriginal)
    setLoading(false)
  }

  // Writes the editor buffer to summary.md; false means it failed and was already reported.
  async function persist(): Promise<boolean> {
    try {
      await saveSummaryContent(course, lecture, content, kind)
    } catch (e) {
      const message = e instanceof Error ? e.message : t`Failed to save summary`
      if (!isConnectionError(e)) toast('error', message) // connection errors are toasted centrally
      setError(message)
      return false
    }
    setSavedContent(content)
    setHasOriginal(true)
    return true
  }

  async function handleRestore() {
    setConfirmRestore(false)
    setError('')
    await revertSummary(course, lecture, kind)
    await loadContent()
    // Restore rewrites summary.md with no SSE notify behind it, so the tree's mtimes — and the
    // stale-PDF badge that reads them — only update if we ask for them.
    refreshCourses()
  }

  // One action rather than two: a saved summary whose PDF still shows the old text is never what
  // the editor wanted, so the buffer and the PDF always move together.
  async function handleSaveAndUpdatePdf() {
    setGenerating(true)
    setError('')
    if (!(await persist())) {
      setGenerating(false)
      return
    }
    // The write lands before the PDF does, and the chip comparing their mtimes reads the tree.
    refreshCourses()
    await deleteFile(course, lecture, 'summary.pdf', kind)
    const initResult = await runStep(course, lecture, 'pdf', kind)
    if (initResult.status !== 'started') {
      toastInitResult(initResult, {
        busy: t`Step already running`,
        error: t`Failed to generate PDF`,
      })
      if (initResult.status === 'error') setError(initResult.message ?? t`Failed to generate PDF`)
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
  const badge = files && pdfBadge(files)
  const dirty = !loading && content !== savedContent
  // A stale or absent PDF is work to do even on a clean buffer: the press rebuilds it from disk.
  const canUpdate = dirty || badge?.kind === 'stale' || !files?.['summary.pdf'].exists

  return (
    <div className="edit-view">
      <div className="edit-toolbar">
        <button className="edit-back" onClick={() => navigate(-1)}>
          <Icon icon="chevron-start" />
          <Trans>Back</Trans>
        </button>
        <span className="edit-toolbar-divider" />
        <h2 className="edit-title" dir="auto">
          {lecture}
        </h2>
        {badge && (
          <span className="chip chip--warn edit-pdf-chip" title={badge.title} role="status">
            <Icon icon="warning" />
            {badge.kind === 'stale'
              ? t`PDF is older than this summary`
              : t`PDF rendered with warnings`}
          </span>
        )}
        <div className="edit-toolbar-actions">
          <button
            className="btn btn--ghost edit-restore"
            onClick={() => setConfirmRestore(true)}
            disabled={!hasOriginal || generating || loading}
            title={hasOriginal ? t`Discard all edits` : t`No original saved`}
          >
            <Trans>Restore original</Trans>
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSaveAndUpdatePdf}
            disabled={!canUpdate || generating || loading}
            title={canUpdate ? undefined : t`Already up to date`}
          >
            {generating ? t`Updating PDF…` : t`Save & update PDF`}
          </button>
        </div>
      </div>

      {error && <p className="edit-error">{error}</p>}

      <div className="edit-panels">
        <div className="edit-panel edit-panel--pdf">
          <PdfViewer url={pdfUrl} show={showPdf} generating={generating} />
        </div>

        <div className="edit-panel edit-panel--text">
          <div className="pane-header">
            <span className="pane-label">summary.md</span>
            {dirty && (
              <span className="edit-unsaved" role="status">
                <span className="edit-unsaved-dot" />
                <Trans>Unsaved changes</Trans>
              </span>
            )}
          </div>
          {loading ? (
            <div className="edit-loading">
              <div className="spinner" />
            </div>
          ) : (
            <MarkdownEditor value={content} onChange={setContent} />
          )}
        </div>
      </div>

      {confirmRestore && (
        <ConfirmModal
          message={t`All edits will be discarded and the original AI summary restored.`}
          warning={t`This cannot be undone.`}
          onConfirm={handleRestore}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
    </div>
  )
}
