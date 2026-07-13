import { useMemo, useState } from 'react'
import type { Kind } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import type { Item } from './services/autoDownloader'
import { downloadItem, isReconnectError } from './services/autoDownloader'
import { suggestItemName } from './utils/nameSuggestion'

type Result = 'ok' | 'fail' | null

interface Props {
  item: Item
  course: string
  onReconnect: () => void
}

// One discovered recording. Downloadable rows carry the full name/kind/download
// controls; expandable rows render collapsed with a no-op caret (TODO)
export default function RecordingRow({ item, course, onReconnect }: Props) {
  const { courses } = useCourseTreeContext()
  const [kind, setKind] = useState<Kind>(item.kind)
  const [name, setName] = useState(() => suggestItemName(item.title, item.kind, courses, course))
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [confirming, setConfirming] = useState(false)

  // Read the live course node so a completed download's SSE tree refresh updates state
  const courseNode = courses.find((c) => c.name === course)
  const suggestion = useMemo(
    () => suggestItemName(item.title, kind, courses, course),
    [item.title, kind, courses, course],
  )
  const effectiveName = name.trim() || suggestion
  const existing = kind === 'recitation' ? courseNode?.recitations : courseNode?.lectures
  const alreadyDownloaded = existing?.some((l) => l.name === effectiveName) ?? false

  // Kind toggle recomputes the suggested name — but only until the user edits it.
  function changeKind(next: Kind) {
    setKind(next)
    if (!touched) setName(suggestItemName(item.title, next, courses, course))
  }

  if (item.expandable) {
    // Collapsed, controls hidden. TODO wire this caret to POST /list/expand.
    return (
      <div className="recording-row recording-row--expandable">
        <button className="recording-caret" aria-label="Expand" title="Coming soon">▸</button>
        <span className="recording-title" dir="auto" title={item.title}>{item.title}</span>
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
      else setResult('fail')
    } finally {
      setPending(false)
    }
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
          onClick={() => changeKind('lecture')}
        >
          Lecture
        </button>
        <button
          className={kind === 'recitation' ? 'kind-toggle-btn kind-toggle-btn--active' : 'kind-toggle-btn'}
          onClick={() => changeKind('recitation')}
        >
          Recitation
        </button>
      </div>

      <input
        className="source-row-input recording-name-input"
        value={name}
        onChange={(e) => { setName(e.target.value); setTouched(true) }}
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
    </div>
  )
}
