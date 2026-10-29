import { useState, useEffect, useRef } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import { useLatestRequest } from '@/shared/hooks/useLatestRequest'
import { toast, toastInitResult } from '@/services/toaster'
import { isConnectionError } from '@/services/http'
import { failureOf } from '@/shared/utils/failure'
import ServiceError, { serviceErrorNode } from '@/shared/components/ServiceError'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import PdfViewer from '@/features/lectures/components/PdfViewer'
import MarkdownEditor from '@/features/lectures/components/MarkdownEditor'
import { statePdfBadge } from '@/features/lectures/utils/pdfBadge'
import type { DocSource } from '@/features/lectures/utils/docSource'
import {
  canUpdateDocPdf,
  diskChange,
  freshPdfLanded,
  updatePdfDisabled,
  updatePdfReason,
} from '@/features/lectures/utils/summaryBuffer'
import { cacheBustedUrl } from '@/features/lectures/utils/pdfUrl'
import '@/styles/spinner.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/pane-header.css'
import './DocEditor.css'

// The editor of one markdown document and its PDF, over whichever `DocSource` the route supplies.
export default function DocEditor({ source }: { source: DocSource }) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { pdf: pdfState, error: runError } = source

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
  // the md changed on disk under an edited buffer; saving waits until the user picks a version.
  const [diskConflict, setDiskConflict] = useState(false)

  // True only while waiting for the pdf step this view started.
  const pdfFiredRef = useRef(false)
  // The PDF's mtime when that step was asked for, so the old file is not taken for the new one.
  const firedMtimeRef = useRef<number | null>(null)
  const latest = useLatestRequest()
  // The buffer as of the last render, for a disk read that resolves after later keystrokes.
  const bufferRef = useRef({ content, savedContent })
  bufferRef.current = { content, savedContent }
  // A re-read during our own save would compare the new disk text against the pre-save one and flag our
  // own write as a conflict, so it waits for the save and runs once after it.
  const savingRef = useRef(false)
  const rereadOwedRef = useRef(false)
  const mdMtime = pdfState?.mdMtime ?? null

  // Runs on every refresh; the ref limits it to the generate this view started, whose missing PDF
  // is the run's own delete — see docs/EDITOR.md.
  useEffect(() => {
    if (!pdfState) return
    const pdfExists = pdfState.pdfExists
    if (!pdfFiredRef.current) {
      setShowPdf(pdfExists)
      return
    }
    if (runError) {
      pdfFiredRef.current = false
      setUpdating(false)
      setShowPdf(pdfExists)
      // The runner status toasts every step error itself; the toolbar keeps it beside the button.
      setError(runError)
    } else if (
      freshPdfLanded({ exists: pdfExists, mtime: pdfState.pdfMtime }, firedMtimeRef.current)
    ) {
      pdfFiredRef.current = false
      setUpdating(false)
      setShowPdf(true)
    }
  }, [pdfState, runError])

  useEffect(() => {
    loadContent()
  }, [source.id])

  // Another window's save or a re-summarize reaches us as a new summary.md mtime on the SSE-refreshed tree.
  useEffect(() => {
    if (!loading) syncFromDisk()
  }, [mdMtime, loading])

  async function loadContent() {
    setLoading(true)
    const data = await latest(source.fetch())
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
      data = await latest(source.fetch())
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
      await source.save(content)
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
      await source.restore()
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
    firedMtimeRef.current = pdfState?.pdfMtime ?? null
    if (!(await persist())) {
      setUpdating(false)
      return
    }
    // `fresh` has the backend delete the old PDF inside the lecture lock, so a `busy` answer leaves it
    // in place; a delete it cannot make (a viewer holding the file) arrives as the step's error.
    try {
      const initResult = await source.runPdf()
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
    source.markStarted()
    pdfFiredRef.current = true
  }

  const pdfUrl = cacheBustedUrl(source.pdfUrl, pdfState?.pdfMtime ?? null)
  const badge = pdfState && statePdfBadge(pdfState)
  const dirty = !loading && content !== savedContent
  // A stale or absent PDF is work to do even on a clean buffer: the press rebuilds it from disk.
  const canUpdate = canUpdateDocPdf(content, dirty, pdfState)
  const blank = !loading && !content.trim()
  const generating = updating || source.rendering
  // A run answers `busy` while any step holds the document.
  const inflight = source.busy
  const updateReason = updatePdfReason({ inflight, generating, blank, canUpdate })

  return (
    <div className="edit-view">
      <div className="edit-toolbar">
        <button className="edit-back" onClick={() => navigate(source.backRoute)}>
          <Icon icon="chevron-start" />
          <Trans>Back</Trans>
        </button>
        <span className="edit-toolbar-divider" />
        <h2 className="edit-title" dir="auto">
          {source.title}
        </h2>
        {badge && (
          <Tooltip content={badge.title} placement="bottom">
            <span className="chip chip--warn edit-pdf-chip" role="status">
              <Icon icon="warning" />
              {badge.kind === 'stale'
                ? t`PDF is older than this summary`
                : t`PDF rendered with warnings`}
            </span>
          </Tooltip>
        )}
        <div className="edit-toolbar-actions">
          <Tooltip content={hasOriginal ? t`Discard all edits` : t`No original saved`}>
            <button
              className="btn btn--ghost edit-restore"
              onClick={() => setConfirmRestore(true)}
              disabled={!hasOriginal || generating || loading}
            >
              <Trans>Restore original</Trans>
            </button>
          </Tooltip>
          <Tooltip
            placement="bottom"
            content={
              updateReason === 'busy'
                ? t`Step already running`
                : updateReason === 'blank'
                  ? t`The summary is empty`
                  : updateReason === 'current'
                    ? t`Already up to date`
                    : undefined
            }
          >
            <button
              className="btn btn--primary"
              onClick={handleSaveAndUpdatePdf}
              disabled={updatePdfDisabled({
                canUpdate,
                generating,
                inflight,
                loading,
                diskConflict,
              })}
            >
              {generating ? t`Updating PDF…` : t`Save & update PDF`}
            </button>
          </Tooltip>
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
            onPopOut={source.openPdf}
          />
        </div>

        <div className="edit-panel edit-panel--text" data-tour="summary-editor">
          <div className="pane-header">
            <span className="pane-label">{source.mdName}</span>
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
