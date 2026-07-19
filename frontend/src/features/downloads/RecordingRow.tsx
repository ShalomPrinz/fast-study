import { useState } from 'react'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import type { Item, PasscodeError } from './services/autoDownloader'
import {
  downloadItem,
  isPasscodeError,
  isReconnectError,
  saveZoomPasscode,
} from './services/autoDownloader'
import PasscodePrompt from './PasscodePrompt'
import { useRowEdit } from './contexts/RowEditsContext'
import { isDownloaded } from './utils/nameSuggestion'

type Result = 'ok' | 'fail' | null

// Expandable rows are driven by SectionGroup, which owns the fetch + children cache so it
// can tell whether the whole section is expanded (and build the bulk queue from the children).
export interface ExpandControl {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
  onToggle: () => void
}

interface Props {
  item: Item
  course: string
  onReconnect: () => void
  expand?: ExpandControl
}

// One discovered recording. Downloadable rows carry the full name/kind/download
// controls; expandable rows render the caret against the parent-owned ExpandControl
// and render each fetched child as its own (recursive) RecordingRow.
export default function RecordingRow({ item, course, onReconnect, expand }: Props) {
  const { courses } = useCourseTreeContext()
  // Name/kind live in SectionGroup (keyed by ref) so this row and the bulk queue agree.
  const { kind, suggestion, value, name: effectiveName, setName, setKind } = useRowEdit(item, course)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [confirming, setConfirming] = useState(false)

  // Zoom passcode prompt: opened when /download-item answers 409 { status:'passcode' }.
  // Distinct from the pre-download overwrite ConfirmModal — they fire at different moments
  // (confirming is already false once download() runs), so the two never co-render.
  const [passcodePrompt, setPasscodePrompt] = useState(false)
  const [passcodeReason, setPasscodeReason] = useState<PasscodeError['reason']>('missing')

  // Read the live tree so a completed download's SSE refresh updates the row
  const alreadyDownloaded = isDownloaded(effectiveName, kind, courses, course)

  if (item.expandable && expand) {
    return (
      <div className="recording-expandable">
        <div className="recording-row recording-row--expandable">
          <button
            className="recording-caret"
            aria-label={expand.expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expand.expanded}
            onClick={expand.onToggle}
            disabled={expand.expanding}
          >
            {expand.expanding ? (
              <span className="recording-spinner recording-spinner--dark" />
            ) : expand.expanded ? '▾' : '▸'}
          </button>
          <span className="recording-title" dir="auto" title={item.title}>{item.title}</span>
        </div>
        {expand.error && (
          <div className="recordings-status recordings-status--error">{expand.error}</div>
        )}
        {expand.expanded && expand.children && (
          <div className="recording-children">
            {expand.children.map((child) => (
              <RecordingRow key={child.ref} item={child} course={course} onReconnect={onReconnect} />
            ))}
          </div>
        )}
      </div>
    )
  }

  async function download() {
    setConfirming(false)
    setPending(true)
    setResult(null)
    try {
      const { ok } = await downloadItem({ ref: item.ref, course, name: effectiveName, kind })
      setResult(ok ? 'ok' : 'fail')
    } catch (err) {
      if (isReconnectError(err)) onReconnect()
      else if (isPasscodeError(err)) {
        // Row is mid-flow — prompt for the passcode instead of failing. The finally clears
        // the spinner while the user types; submitting re-enters pending and re-runs download().
        setPasscodeReason(err.reason)
        setPasscodePrompt(true)
      } else setResult('fail')
    } finally {
      setPending(false)
    }
  }

  // Save the entered passcode, then re-run download() so it re-hits /download-item with the
  // stored passcode. pending stays true across save→retry so the spinner never flashes off; a
  // still-wrong passcode re-opens this prompt with the 'incorrect' copy.
  async function submitPasscode(passcode: string, scope: 'course' | 'lecture') {
    if (!passcode) return
    setPending(true)
    try {
      await saveZoomPasscode({ course, name: effectiveName, passcode, scope })
    } catch {
      setResult('fail')
      setPasscodePrompt(false)
      setPending(false)
      return
    }
    setPasscodePrompt(false)
    await download()
  }

  function cancelPasscode() {
    setPasscodePrompt(false)
    setResult('fail')
  }

  // Re-downloading an existing recording overwrites it, so confirm first.
  function onDownloadClick() {
    if (alreadyDownloaded) setConfirming(true)
    else download()
  }

  return (
    <div className={alreadyDownloaded ? 'recording-row recording-row--downloaded' : 'recording-row'}>
      <span className="recording-title" dir="auto" title={item.title}>{item.title}</span>

      <div className="kind-toggle">
        <button
          className={kind === 'lecture' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'}
          onClick={() => setKind('lecture')}
        >
          Lecture
        </button>
        <button
          className={kind === 'recitation' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'}
          onClick={() => setKind('recitation')}
        >
          Recitation
        </button>
      </div>

      <input
        className="source-row-input recording-name-input"
        value={value}
        onChange={(e) => setName(e.target.value)}
        placeholder={suggestion}
        dir="auto"
      />

      <button className="source-row-btn recording-download-btn" onClick={onDownloadClick} disabled={pending}>
        {pending ? (
          <span className="recording-spinner" />
        ) : result === 'ok' ? (
          'Downloaded ✓'
        ) : result === 'fail' ? (
          'Retry ✗'
        ) : (
          'Download'
        )}
      </button>

      {confirming && (
        <ConfirmModal
          message={`${effectiveName} already exists in ${course}. Download again and overwrite?`}
          onConfirm={download}
          onCancel={() => setConfirming(false)}
        />
      )}

      {passcodePrompt && (
        <PasscodePrompt
          reason={passcodeReason}
          busy={pending}
          onSubmit={submitPasscode}
          onCancel={cancelPasscode}
        />
      )}
    </div>
  )
}
