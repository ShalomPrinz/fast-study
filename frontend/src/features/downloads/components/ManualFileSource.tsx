import { useRef } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import Tooltip from '@/shared/components/Tooltip'
import { toast } from '@/services/toaster'
import { classifyDrop, formatBytes } from '@/features/downloads/utils/fileImport'
import type { DropVerdict } from '@/features/downloads/utils/fileImport'
import '@/styles/button.css'
import './ManualDownload.css'

// Toasts why a drop or a chosen file was not taken; a taken file or an empty drop says nothing.
export function useRejectedDrop() {
  const { t } = useLingui()
  return (verdict: DropVerdict) => {
    if (verdict.kind === 'not-mp4') toast('error', t`Only .mp4 files are allowed`)
    else if (verdict.kind === 'many') toast('error', t`Drop one file at a time`)
  }
}

// The File-mode source row: a drop zone while empty, one line naming the file once chosen.
// Choosing never starts anything; the Copy and Move buttons do.
export default function ManualFileSource({
  file,
  onPick,
}: {
  file: File | null
  onPick: (file: File | null) => void
}) {
  const { t } = useLingui()
  const rejected = useRejectedDrop()
  const input = useRef<HTMLInputElement>(null)

  function onChosen(files: FileList | null) {
    const verdict = classifyDrop(Array.from(files ?? []))
    if (verdict.kind === 'file') onPick(verdict.file)
    else rejected(verdict)
    // Lets the same file be chosen again after Remove.
    if (input.current) input.current.value = ''
  }

  const choose = () => input.current?.click()

  return (
    <div className="manual-download-field manual-download-url">
      <span className="manual-download-label">
        <Trans>Video file</Trans>
      </span>
      <input
        ref={input}
        type="file"
        accept=".mp4,video/mp4"
        hidden
        onChange={(e) => onChosen(e.target.files)}
      />
      {file ? (
        <div className="manual-download-file">
          <span className="manual-download-file-name" dir="auto">
            {file.name}
          </span>
          <span className="manual-download-file-size" dir="ltr">
            · {formatBytes(file.size)}
          </span>
          <button className="btn btn--ghost" onClick={choose}>
            <Trans>Change</Trans>
          </button>
          <Tooltip content={t`Remove file`}>
            <button
              className="btn btn--ghost"
              aria-label={t`Remove file`}
              onClick={() => onPick(null)}
            >
              ✕
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="manual-download-dropzone">
          <Trans>
            Drop an .mp4 here, or{' '}
            <button className="btn btn--secondary" onClick={choose}>
              Choose file
            </button>
          </Trans>
        </div>
      )}
    </div>
  )
}
