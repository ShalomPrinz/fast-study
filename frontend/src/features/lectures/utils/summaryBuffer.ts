import type { FileInfo, FileStatus, InFlightEntry } from '@/types'
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

// Whether the `Save & update PDF` button is disabled. Any step in flight blocks it: the run would only
// answer `busy`.
export function updatePdfDisabled(s: {
  canUpdate: boolean
  generating: boolean
  inflight: boolean
  loading: boolean
  diskConflict: boolean
}): boolean {
  return !s.canUpdate || s.generating || s.inflight || s.loading || s.diskConflict
}

export type UpdatePdfReason = 'busy' | 'blank' | 'current' | null

// Why `Save & update PDF` cannot be pressed, for its tooltip. None while generating, whose label says it,
// so `busy` is only ever another run holding the lecture.
export function updatePdfReason(s: {
  inflight: boolean
  generating: boolean
  blank: boolean
  canUpdate: boolean
}): UpdatePdfReason {
  if (s.generating) return null
  if (s.inflight) return 'busy'
  if (s.blank) return 'blank'
  return s.canUpdate ? null : 'current'
}

// Whether the render this view started has written its PDF. The backend deletes the old one only once
// the run holds the lecture, so a refresh can still show it; a changed mtime is the new file.
export function freshPdfLanded(pdf: FileInfo, firedMtime: number | null): boolean {
  return pdf.exists && pdf.mtime !== firedMtime
}
