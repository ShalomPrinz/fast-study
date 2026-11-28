import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  useImportEntries,
  type ImportEntry,
} from '@/features/downloads/contexts/ManualImportsContext'
import { importAnnouncement, seenAtMount } from '@/features/downloads/utils/fileImport'

// A polite live region for imports: start, done and failure only, never progress.
export default function ManualImportAnnouncer() {
  const { t } = useLingui()
  const entries = useImportEntries()
  // Seeded at mount so entries already present aren't re-announced on returning to the tab.
  const seen = useRef<Map<number, ImportEntry['status']>>(null as never)
  if (!seen.current) seen.current = seenAtMount(entries)
  const [text, setText] = useState('')

  useEffect(() => {
    for (const e of entries) {
      const said = importAnnouncement(seen.current.get(e.key), e.status)
      seen.current.set(e.key, e.status)
      const name = e.lecture
      const move = e.mode === 'move'
      if (said === 'start') setText(move ? t`Moving ${name}` : t`Copying ${name}`)
      else if (said === 'done') setText(move ? t`Moved ${name}` : t`Copied ${name}`)
      else if (said === 'error')
        setText(move ? t`Moving ${name} failed` : t`Copying ${name} failed`)
    }
  }, [entries, t])

  return (
    <div className="visually-hidden" aria-live="polite">
      {text}
    </div>
  )
}
