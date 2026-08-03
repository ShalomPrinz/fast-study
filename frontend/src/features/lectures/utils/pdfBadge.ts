import type { FileStatus } from '@/types'

export type PdfBadge = { kind: 'warning' | 'stale'; title: string }

export const STALE_PDF_TITLE = 'summary.pdf is older than summary.md. Re-generate it.'

// summary.pdf is stale once summary.md is written after it: a revert, an abandoned edit, or a
// re-run summarize. Every re-render path deletes summary.pdf first, so a missing PDF is never
// stale — which is also what keeps a mid-pipeline run (summary.md written, pdf pending) quiet.
function isStale(files: FileStatus): boolean {
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
  if (isStale(files)) return { kind: 'stale', title: STALE_PDF_TITLE }
  return null
}
