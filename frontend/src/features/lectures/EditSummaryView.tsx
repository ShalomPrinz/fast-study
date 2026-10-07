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
import { openLectureFile } from '@/services/open'
import { useLectureRoute } from '@/features/lectures/hooks/useLectureRoute'
import { useLatestRequest } from '@/shared/hooks/useLatestRequest'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toast, toastInitResult } from '@/services/toaster'
import { isConnectionError } from '@/services/http'
import { failureOf } from '@/shared/utils/failure'
import ServiceError, { serviceErrorNode } from '@/shared/components/ServiceError'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import { lectureNotFound } from '@/shared/utils/notFound'
import { lectureRoute } from '@/shared/utils/url'
import NotFoundPanel from '@/shared/components/NotFoundPanel'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import PdfViewer from '@/features/lectures/components/PdfViewer'
import MarkdownEditor from '@/features/lectures/components/MarkdownEditor'
import { pdfBadge } from '@/features/lectures/utils/pdfBadge'
import {
  canUpdatePdf,
  diskChange,
  pdfGenerating,
  updatePdfDisabled,
} from '@/features/lectures/utils/summaryBuffer'
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
  const { getError, getInFlight, isInFlight } = useRunnerStatus()
  const { courses, loaded: treeLoaded } = useCourseTreeContext()
  const lectureError: ServiceFailure | null = getError(course, lecture, kind)

  const [content, setContent] = useState('')
  // What is on disk, so the toolbar and the editor pane can tell an edited buffer from a clean one.
  const [savedContent, setSavedContent] = useState('')
  const [hasOriginal, setHasOriginal] = useState(false)
  const [loading, setLoading] = useState(true)
  // The save cycle this view started; `generating` below also covers a render still running after a reload.
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<ServiceFailure | null>(null)
  const [showPdf, setShowPdf] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  // summary.md changed on disk under an edited buffer; saving waits until the user picks a version.
  const [diskConflict, setDiskConflict] = useState(false)

  // True only while waiting for the pdf step this view started.
  const pdfFiredRef = useRef(false)
  const latest = useLatestRequest()
  // The buffer as of the last render, for a disk read that resolves after later keystrokes.
  const bufferRef = useRef({ content, savedContent })
  bufferRef.current = { content, savedContent }
  // A re-read during our own save would compare the new disk text against the pre-save one and flag our
  // own write as a conflict, so it waits for the save and runs once after it.
  const savingRef = useRef(false)
  const rereadOwedRef = useRef(false)
  const summaryMtime = files?.['summary.md'].mtime ?? null

  // Runs on every refresh; the ref limits it to the generate this view started, whose missing PDF
  // is our own delete — see docs/EDITOR.md.
  useEffect(() => {
    if (!files) return
    const pdfExists = files['summary.pdf'].exists
    if (!pdfFiredRef.current) {
      setShowPdf(pdfExists)
      return
    }
    if (lectureError) {
      pdfFiredRef.current = false
      setUpdating(false)
      setShowPdf(pdfExists)
      setError(lectureError)
      toast('error', serviceErrorNode(lectureError))
    } else if (pdfExists) {
      pdfFiredRef.current = false
      setUpdating(false)
      setShowPdf(true)
    }
  }, [files, lectureError])

  useEffect(() => {
    if (course && lecture) loadContent()
  }, [course, lecture, kind])

  // Another window's save or a re-summarize reaches us as a new summary.md mtime on the SSE-refreshed tree.
  useEffect(() => {
    if (!loading) syncFromDisk()
  }, [summaryMtime, loading])

  async function loadContent() {
    setLoading(true)
    const data = await latest(fetchSummaryContent(course, lecture, kind))
    if (!data) return
    setContent(data.content)
    setSavedContent(data.content)
    setHasOriginal(data.hasOriginal)
    setDiskConflict(false)
    setLoading(false)
  }

  // Re-reads summary.md: a clean buffer takes the new text, an edited one raises the conflict banner.
  async function syncFromDisk() {
    if (savingRef.current) {
      rereadOwedRef.current = true
      return
    }
    let data
    try {
      data = await latest(fetchSummaryContent(course, lecture, kind))
    } catch {
      // A background re-read; the next notify retries, and connection errors are toasted centrally.
      return
    }
    if (!data) return
    // Started before our save and may have read its text; the owed re-read replaces it.
    if (savingRef.current) {
      rereadOwedRef.current = true
      return
    }
    const { content: current, savedContent: saved } = bufferRef.current
    const change = diskChange(current, saved, data.content)
    setHasOriginal(data.hasOriginal)
    if (change === 'none') return
    setSavedContent(data.content)
    if (change === 'reload') setContent(data.content)
    else setDiskConflict(true)
  }

  // Shows a failed write in the toolbar and as a toast; connection errors are toasted centrally.
  function reportFailure(e: unknown, fallback: string): void {
    const failure = e instanceof Error ? failureOf(e) : { message: fallback }
    if (!isConnectionError(e)) toast('error', serviceErrorNode(failure))
    setError(failure)
  }

  // Writes the editor buffer to summary.md; false means it failed and was already reported.
  async function persist(): Promise<boolean> {
    savingRef.current = true
    try {
      await saveSummaryContent(course, lecture, content, kind)
      // The owed re-read runs before this state commits, so it must already compare against the saved text.
      bufferRef.current.savedContent = content
      setSavedContent(content)
      setHasOriginal(true)
      return true
    } catch (e) {
      reportFailure(e, t`Failed to save summary`)
      return false
    } finally {
      savingRef.current = false
      if (rereadOwedRef.current) {
        rereadOwedRef.current = false
        void syncFromDisk()
      }
    }
  }

  async function handleRestore() {
    setConfirmRestore(false)
    setError(null)
    try {
      await revertSummary(course, lecture, kind)
    } catch (e) {
      reportFailure(e, t`Failed to restore the original summary`)
      return
    }
    await loadContent()
  }

  // One action rather than two: a saved summary whose PDF still shows the old text is never what
  // the editor wanted, so the buffer and the PDF always move together.
  async function handleSaveAndUpdatePdf() {
    setUpdating(true)
    setError(null)
    if (!(await persist())) {
      setUpdating(false)
      return
    }
    // A pdf we cannot delete — a viewer still holding it open — is one the step could not write
    // either, so the failure is reported here rather than pushed into a doomed run.
    try {
      await deleteFile(course, lecture, 'summary.pdf', kind)
    } catch (e) {
      reportFailure(e, t`Failed to generate PDF`)
      setUpdating(false)
      return
    }
    try {
      const initResult = await runStep(course, lecture, 'pdf', kind)
      if (initResult.status !== 'started') {
        toastInitResult(initResult, { busy: t`Step already running` })
        setUpdating(false)
        return
      }
    } catch (e) {
      reportFailure(e, t`Failed to generate PDF`)
      setUpdating(false)
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
  const canUpdate = canUpdatePdf(content, dirty, files)
  const blank = !loading && !content.trim()
  const generating = pdfGenerating(updating, getInFlight(course, lecture, kind))
  // A run answers `busy` while any step holds the lecture, after the PDF was already deleted.
  const inflight = isInFlight(course, lecture, kind)

  return (
    <div className="edit-view">
      <div className="edit-toolbar">
        {/* The lecture, not history: the editor is often reached from a fresh tab or another page. */}
        <button className="edit-back" onClick={() => navigate(lectureRoute(course, lecture, kind))}>
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
            disabled={updatePdfDisabled({ canUpdate, generating, inflight, loading, diskConflict })}
            title={
              inflight
                ? t`Step already running`
                : blank
                  ? t`The summary is empty`
                  : canUpdate
                    ? undefined
                    : t`Already up to date`
            }
          >
            {generating ? t`Updating PDF…` : t`Save & update PDF`}
          </button>
        </div>
      </div>

      {diskConflict && (
        <div className="edit-conflict" role="alert">
          <span>
            <Trans>
              This summary changed in another window or was regenerated. Load the new version, or
              keep your edits and save over it.
            </Trans>
          </span>
          <button
            className="btn btn--ghost"
            onClick={() => {
              setContent(savedContent)
              setDiskConflict(false)
            }}
          >
            <Trans>Load new version</Trans>
          </button>
          <button className="btn btn--ghost" onClick={() => setDiskConflict(false)}>
            <Trans>Keep my edits</Trans>
          </button>
        </div>
      )}

      {error && (
        <p className="edit-error">
          <ServiceError failure={error} />
        </p>
      )}

      <div className="edit-panels">
        <div className="edit-panel edit-panel--pdf">
          <PdfViewer
            url={pdfUrl}
            show={showPdf}
            generating={generating}
            onPopOut={() => openLectureFile(course, lecture, 'summary.pdf', kind)}
          />
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
