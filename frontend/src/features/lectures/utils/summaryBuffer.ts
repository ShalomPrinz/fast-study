import type { FileStatus, InFlightEntry } from '@/types'
import { pdfNeedsUpdate } from './pdfBadge'

export type DiskChange = 'none' | 'reload' | 'conflict'

// What a fresh read of summary.md means for the open buffer, `saved` being what it was last read from
// or written to. Only an edited buffer that disagrees with disk is a conflict — see docs/EDITOR.md.
export function diskChange(content: string, saved: string, disk: string): DiskChange {
  if (disk === saved) return 'none'
  if (content === saved || content === disk) return 'reload'
  return 'conflict'
}

// Whether "Save & update PDF" has work to do. Never for a blank buffer: the save would leave an empty
// summary.md, whose render can only fail.
export function canUpdatePdf(content: string, dirty: boolean, files: FileStatus | null): boolean {
  if (!content.trim()) return false
  return dirty || pdfNeedsUpdate(files)
}

// The editor is generating while its own save cycle runs or the runner reports this lecture's `pdf` step,
// so a reload mid-render keeps the spinner; other steps in flight do not count.
export function pdfGenerating(localCycle: boolean, inFlight: InFlightEntry | null): boolean {
  return localCycle || inFlight?.step === 'pdf'
}

// Whether the `Save & update PDF` button is disabled. Any step in flight blocks it: the run would answer
// `busy` after the PDF was already deleted, leaving none.
export function updatePdfDisabled(s: {
  canUpdate: boolean
  generating: boolean
  inflight: boolean
  loading: boolean
  diskConflict: boolean
}): boolean {
  return !s.canUpdate || s.generating || s.inflight || s.loading || s.diskConflict
}
