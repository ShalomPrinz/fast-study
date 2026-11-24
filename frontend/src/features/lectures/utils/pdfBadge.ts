import { t } from '@lingui/core/macro'
import { pdfWarningText } from '@/shared/utils/pdfWarningText'
import type { FileStatus, PdfBadge } from '@/types'

// What the stale rule and the badge read of a document and its PDF, whichever kind of document it is.
export interface PdfState {
  mdMtime: number | null
  pdfExists: boolean
  pdfMtime: number | null
  warning: string | null
}

export function lecturePdfState(files: FileStatus): PdfState {
  const pdf = files['summary.pdf']
  const md = files['summary.md']
  return {
    mdMtime: md.exists ? md.mtime : null,
    pdfExists: pdf.exists,
    pdfMtime: pdf.mtime,
    warning: pdf.warning ?? null,
  }
}

// A getter, not a constant: the copy has to resolve against whichever locale is active now.
export const stalePdfTitle = (): string => t`The PDF is older than the summary. Re-generate it.`

// The PDF is stale once its markdown is newer. A missing PDF never is: every re-render deletes it
// first, which keeps a pending render quiet — see docs/LECTURES.md.
export function isStatePdfStale(s: PdfState): boolean {
  if (!s.pdfExists || s.pdfMtime === null || s.mdMtime === null) return false
  return s.mdMtime > s.pdfMtime
}

// One badge per PDF. A render warning describes THIS pdf and outranks staleness,
// which resurfaces on its own once the warning clears.
export function statePdfBadge(s: PdfState): PdfBadge | null {
  if (s.warning) return { kind: 'warning', title: pdfWarningText(s.warning) }
  if (isStatePdfStale(s)) return { kind: 'stale', title: stalePdfTitle() }
  return null
}

// Whether the editor's update has work to do on a clean buffer: rebuild a stale or absent PDF. Reads
// the mtime rule directly, since a warning badge can hide a stale PDF.
export function statePdfNeedsUpdate(s: PdfState | null): boolean {
  return !s?.pdfExists || isStatePdfStale(s)
}

export function isPdfStale(files: FileStatus): boolean {
  return isStatePdfStale(lecturePdfState(files))
}

export function pdfBadge(files: FileStatus): PdfBadge | null {
  return statePdfBadge(lecturePdfState(files))
}

export function pdfNeedsUpdate(files: FileStatus | null): boolean {
  return statePdfNeedsUpdate(files && lecturePdfState(files))
}

export const staleDriveTitle = (): string =>
  t`The Drive copy is older than the PDF. Upload it again.`

// Drive is stale once summary.pdf is newer than drive_url.txt. A missing file on either side never is.
export function driveBadge(files: FileStatus): PdfBadge | null {
  const pdf = files['summary.pdf']
  const drive = files['drive_url.txt']
  if (!pdf.exists || !drive.exists || pdf.mtime === null || drive.mtime === null) return null
  return pdf.mtime > drive.mtime ? { kind: 'stale', title: staleDriveTitle() } : null
}
