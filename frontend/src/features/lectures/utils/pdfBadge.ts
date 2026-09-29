import { t } from '@lingui/core/macro'
import type { FileStatus, PdfBadge } from '@/types'

// A getter, not a constant: the copy has to resolve against whichever locale is active now.
export const stalePdfTitle = (): string => t`The PDF is older than the summary. Re-generate it.`

// summary.pdf is stale once summary.md is newer. A missing PDF never is: every re-render deletes it
// first, which keeps a pending render quiet — see docs/LECTURES.md.
export function isPdfStale(files: FileStatus): boolean {
  const pdf = files['summary.pdf']
  const md = files['summary.md']
  if (!pdf.exists || !md.exists || pdf.mtime === null || md.mtime === null) return false
  return md.mtime > pdf.mtime
}

// One badge per summary.pdf row. A render warning describes THIS pdf and outranks staleness,
// which resurfaces on its own once the warning clears.
export function pdfBadge(files: FileStatus): PdfBadge | null {
  const warning = files['summary.pdf'].warning
  if (warning) return { kind: 'warning', title: warning }
  if (isPdfStale(files)) return { kind: 'stale', title: stalePdfTitle() }
  return null
}

// Whether the editor's update has work to do on a clean buffer: rebuild a stale or absent PDF. Reads
// the mtime rule directly, since a warning badge can hide a stale PDF.
export function pdfNeedsUpdate(files: FileStatus | null): boolean {
  if (!files?.['summary.pdf'].exists) return true
  return isPdfStale(files)
}
